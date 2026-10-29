import fs from "node:fs";
import path from "node:path";
import { installationToken, openPullRequest, updatePullRequestBody, type PullRequestInfo } from "../github/app";
import { cloudRunnerAvailable, cloudRunsEnabled, hasActiveServerRun, runServerRun } from "../runner/manager";
import type { IServerRunOutcome } from "../runner/run";
import { cloneRepo, git, workspaceDir } from "../runner/workspace";
import { sessionStores } from "../sessions/instance";
import { publishSessionEvent } from "../sessions/publish";
import { postFailedComment } from "./comments";
import { dispatchTasks, taskStores } from "./dispatch";
import { publishTaskChange } from "./events";
import { composePrBody } from "./prBody";
import { defaultBranch, postTaskComments, refreshPullRequest } from "./pulls";
import { ACTIVE_STATES, repoKey, type Task, type TaskRepo, type TaskStore } from "./store";

/**
 * Cloud fallback ("always-on"): a queued task whose repo no online editor has
 * open runs on the daemon instead — in the sandboxed runner (runner/sandbox.ts),
 * which has no network at all. Everything that needs the network therefore
 * happens here, outside the container, before and after the agent runs:
 *
 *   dispatch → relay session (origin "phone", runner "server") linked to the task
 *   → clone the default branch, `git switch -c <task.branch>` (fetching the branch
 *     first if an earlier attempt already pushed it)
 *   → the agent works in the checkout
 *   → commit what it left uncommitted (author Celiador <noreply@celiador.ai>)
 *   → push with the GitHub App's installation token in the URL, --force-with-lease
 *     against the sha the branch had when the turn started
 *   → open the pull request as the App, body per tasks/prBody.ts → pr-open.
 *
 * A follow-up re-runs the agent in the same retained workspace and finishes the
 * same way (the PR body is refreshed). The App is a hard requirement: without an
 * installation on the repo there is nothing to push with, so the task stays
 * queued with a readable `error` until an editor takes it.
 */

export const WAITING_FOR_APP = "waiting for an editor: cloud runs need the Celiador GitHub App on this repo";
const COMMIT_NAME = "Celiador";
const COMMIT_EMAIL = "noreply@celiador.ai";
/** How long a repo without the App isn't asked about again (every dispatch would otherwise hit GitHub). */
const NO_APP_TTL_MS = 10 * 60_000;
/** How long a missing sandbox (Docker/image) isn't probed again. */
const UNAVAILABLE_TTL_MS = 60_000;
const NETWORK_TIMEOUT_MS = 120_000;

const noAppUntil = new Map<string, number>();
let unavailableUntil = 0;
/** Cloud tasks between their dispatch mark and the end of their turn (so a restart sweep leaves them alone). */
const inFlight = new Set<string>();

/**
 * Where to clone from / push to: the App's token rides in the URL for this one
 * command (never in .git/config — the workspace is browsable from the phone).
 * Overridable for the smoke test, which pushes to a local bare repo.
 */
let remoteFor = (repo: TaskRepo, token: string): string => `https://x-access-token:${token}@github.com/${repo.owner}/${repo.name}.git`;
export function overrideCloudRemoteForTests(fn?: (repo: TaskRepo) => string): void {
  remoteFor = fn ? (repo) => fn(repo) : (repo, token) => `https://x-access-token:${token}@github.com/${repo.owner}/${repo.name}.git`;
  noAppUntil.clear();
  unavailableUntil = 0;
}

/** Whether dispatch may send this queued task to the cloud right now (sync; the real checks run in {@link startCloudRun}). */
export function cloudEligible(task: Task): boolean {
  if (!cloudRunsEnabled()) return false;
  const now = Date.now();
  if (unavailableUntil > now) return false;
  return (noAppUntil.get(repoKey(task.repo.url)) ?? 0) <= now;
}

/**
 * Cloud tasks left `dispatched` / `running` by a daemon that went away (nothing
 * is running them any more) go back to `queued`, so the next dispatch takes them
 * again. Called from dispatchTasks; a no-op while a run is actually in flight.
 */
export function recoverOrphanedCloudTasks(userId: string, store: TaskStore): void {
  for (const task of store.list()) {
    if (task.runner !== "cloud" || !ACTIVE_STATES.has(task.state) || inFlight.has(task.id)) continue;
    if (task.sessionId && hasActiveServerRun(task.sessionId)) continue;
    const updated = store.update(task.id, { state: "queued", runner: undefined, error: "the server restarted; the run will start again" });
    if (updated) publishTaskChange(userId, updated);
  }
}

/** Back to the queue with a reason, published only when the reason is news. */
function requeue(userId: string, store: TaskStore, task: Task, error: string): void {
  const changed = task.error !== error;
  const updated = store.update(task.id, { state: "queued", runner: undefined, error });
  if (updated && changed) publishTaskChange(userId, updated);
}

function fail(userId: string, store: TaskStore, taskId: string, error: string): void {
  const updated = store.update(taskId, { state: "failed", error: error.slice(0, 2000) });
  if (!updated) return;
  publishTaskChange(userId, updated);
  postFailedComment(userId, updated);
  dispatchTasks(userId);
}

/**
 * Take a task dispatch just marked `dispatched` + `runner: "cloud"` through its
 * first turn. The checks that need the network (sandbox present, App installed on
 * the repo) happen here; if either fails the task is re-queued with the reason
 * and the failing condition isn't probed again for a while.
 */
export async function startCloudRun(userId: string, taskId: string): Promise<void> {
  const store = taskStores.for(userId);
  const task = store.get(taskId);
  if (!task || task.state !== "dispatched" || task.runner !== "cloud") return;
  inFlight.add(taskId);
  try {
    const unavailable = await cloudRunnerAvailable();
    if (unavailable) {
      unavailableUntil = Date.now() + UNAVAILABLE_TTL_MS;
      requeue(userId, store, task, unavailable);
      return;
    }
    const token = await installationToken(task.repo).catch(() => null);
    if (!token) {
      noAppUntil.set(repoKey(task.repo.url), Date.now() + NO_APP_TTL_MS);
      requeue(userId, store, task, WAITING_FOR_APP);
      return;
    }
    if (store.get(taskId)?.state !== "dispatched") return; // cancelled while we were asking
    const session = sessionStores.for(userId).create({ title: task.title, origin: "phone", runner: "server" });
    const linked = store.update(taskId, { sessionId: session.id, error: undefined });
    if (linked) publishTaskChange(userId, linked);
    await runTurn(userId, taskId, session.id, task.prompt, token);
  } catch (err) {
    fail(userId, store, taskId, err instanceof Error ? err.message : String(err));
  } finally {
    inFlight.delete(taskId);
  }
}

/**
 * A follow-up on a cloud task (the queue's "Send back…", or a checks-failed
 * fix): another turn of the agent in the retained workspace, with the original
 * task for context. Resolves once the turn is launched, not finished.
 */
export async function cloudFollowUp(userId: string, taskId: string, text: string): Promise<{ ok: true } | { error: string; status: 409 | 503 }> {
  const store = taskStores.for(userId);
  const task = store.get(taskId);
  if (!task?.sessionId) return { error: "the task has no session yet", status: 409 };
  if (hasActiveServerRun(task.sessionId) || inFlight.has(taskId)) return { error: "the cloud run is still working; wait for it to finish", status: 409 };
  const unavailable = await cloudRunnerAvailable();
  if (unavailable) return { error: unavailable, status: 503 };
  const token = await installationToken(task.repo).catch(() => null);
  if (!token) return { error: "cloud runs need the Celiador GitHub App on this repo", status: 409 };
  publishSessionEvent(userId, task.sessionId, { kind: "message", role: "user", text });
  const prompt = `${task.prompt}\n\nThe work so far is already in this checkout, on branch \`${task.branch}\`. Follow-up from the reviewer:\n${text}`;
  inFlight.add(taskId);
  void runTurn(userId, taskId, task.sessionId, prompt, token)
    .catch((err) => fail(userId, store, taskId, err instanceof Error ? err.message : String(err)))
    .finally(() => inFlight.delete(taskId));
  return { ok: true };
}

/** One turn: running → prepare the checkout → agent → finish (commit / push / PR). */
async function runTurn(userId: string, taskId: string, sessionId: string, prompt: string, token: string): Promise<void> {
  const store = taskStores.for(userId);
  let task = store.update(taskId, { state: "running" });
  if (!task) return;
  publishTaskChange(userId, task);
  postTaskComments(userId, taskId);

  const dir = workspaceDir(userId, sessionId);
  const remote = remoteFor(task.repo, token);
  let prepared: { expected: string; baseSha: string };
  try {
    prepared = await prepareWorkspace(task, remote, token, dir);
  } catch (err) {
    const message = `Couldn't prepare the workspace: ${err instanceof Error ? err.message : String(err)}`;
    publishSessionEvent(userId, sessionId, { kind: "error", message });
    publishSessionEvent(userId, sessionId, { kind: "state", state: "error" });
    fail(userId, store, taskId, message);
    return;
  }

  const outcome = await runServerRun({ userId, sessionId, repo: { url: task.repo.url, branch: task.branch }, prompt, workspaceReady: true });
  task = store.get(taskId);
  if (!task) return;
  if (!outcome.ok) {
    if (outcome.cancelled) {
      if (task.state !== "cancelled") {
        const updated = store.update(taskId, { state: "cancelled" });
        if (updated) publishTaskChange(userId, updated);
        dispatchTasks(userId);
      }
    } else fail(userId, store, taskId, outcome.error);
    return;
  }
  if (task.state === "cancelled") return;
  // A long run may outlive the token (1 h); the cache hands back a fresh one.
  const pushToken = (await installationToken(task.repo).catch(() => null)) ?? token;
  await finishTurn(userId, store, task, dir, remoteFor(task.repo, pushToken), pushToken, prepared, outcome);
}

/**
 * The checkout the agent works in. First turn: clone the default branch (shallow)
 * and start the task branch from it — or from the branch's remote tip when an
 * earlier attempt already pushed one. Follow-up: fast-forward the retained
 * workspace onto whatever landed on the branch meanwhile (a reviewer's commit),
 * if that is possible. Returns the remote sha the push will lease against ("" =
 * the branch must not exist yet) and the base sha (to tell "no changes" later).
 */
async function prepareWorkspace(task: Task, remote: string, token: string, dir: string): Promise<{ expected: string; baseSha: string }> {
  await fs.promises.mkdir(path.dirname(dir), { recursive: true });
  const parent = path.dirname(dir);
  const ref = `refs/heads/${task.branch}`;
  const expected = (await git(parent, ["ls-remote", remote, ref], { timeout: NETWORK_TIMEOUT_MS, secret: token })).split(/\s+/)[0] ?? "";
  if (!fs.existsSync(path.join(dir, ".git"))) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    await cloneRepo(remote, undefined, dir, token);
    if (expected) {
      await git(dir, ["fetch", "--depth=1", remote, ref], { timeout: NETWORK_TIMEOUT_MS, secret: token });
      await git(dir, ["switch", "-c", task.branch, "FETCH_HEAD"]);
    } else {
      await git(dir, ["switch", "-c", task.branch]);
    }
  } else if (expected && expected !== (await git(dir, ["rev-parse", "HEAD"])).trim()) {
    try {
      await git(dir, ["fetch", remote, ref], { timeout: NETWORK_TIMEOUT_MS, secret: token });
      await git(dir, ["merge", "--ff-only", "FETCH_HEAD"]);
    } catch {
      /* diverged: keep the workspace; the lease at push time decides */
    }
  }
  const baseSha = (await git(dir, ["rev-parse", "origin/HEAD"]).catch(() => "")).trim();
  return { expected, baseSha };
}

/** `origin/HEAD` → the default branch name, else what GitHub says, else "main". */
async function baseBranch(task: Task, dir: string): Promise<string> {
  const sym = (await git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "")).trim();
  if (sym.startsWith("origin/")) return sym.slice("origin/".length);
  return defaultBranch(task);
}

/** Commit the agent's leftovers, push the branch, open (or refresh) the pull request, report pr-open. */
async function finishTurn(
  userId: string,
  store: TaskStore,
  task: Task,
  dir: string,
  remote: string,
  token: string,
  prepared: { expected: string; baseSha: string },
  outcome: Extract<IServerRunOutcome, { ok: true }>,
): Promise<void> {
  const publish = (text: string) => task.sessionId && publishSessionEvent(userId, task.sessionId, { kind: "activity", text });
  try {
    await git(dir, ["add", "-A"]);
    if ((await git(dir, ["diff", "--cached", "--name-only"])).trim()) {
      publish("Committing…");
      const message = task.issue ? `${task.title} (#${task.issue.number})` : task.title;
      await git(dir, ["-c", `user.name=${COMMIT_NAME}`, "-c", `user.email=${COMMIT_EMAIL}`, "commit", "-q", "-m", message, "--author", `${COMMIT_NAME} <${COMMIT_EMAIL}>`]);
    }
    const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
    if (head === prepared.baseSha) {
      const said = outcome.finalMessage?.trim();
      fail(userId, store, task.id, `The agent finished without changing anything.${said ? ` It said: ${said.slice(0, 500)}` : ""}`);
      return;
    }
    if (head !== prepared.expected) {
      publish(`Pushing ${task.branch}…`);
      await git(dir, ["push", `--force-with-lease=refs/heads/${task.branch}:${prepared.expected}`, remote, `HEAD:refs/heads/${task.branch}`], { timeout: NETWORK_TIMEOUT_MS, secret: token });
    }

    const current = store.get(task.id);
    if (!current || current.state === "cancelled") return;
    const body = composePrBody({
      issueNumber: task.issue?.number,
      summary: outcome.finalMessage,
      runBy: "the cloud",
      changedFiles: outcome.changedFiles,
      elapsedMs: current.startedAt ? Date.now() - Date.parse(current.startedAt) : undefined,
      usage: current.usage,
    });
    let pr: PullRequestInfo | null;
    if (current.pr) {
      pr = current.pr;
      await updatePullRequestBody(task.repo, pr.number, body).catch(() => false);
    } else {
      publish("Opening the pull request…");
      pr = await openPullRequest(task.repo, { title: task.title, head: task.branch, base: await baseBranch(task, dir), body });
      if (!pr) {
        fail(userId, store, task.id, "The pull request couldn't be opened: the Celiador GitHub App isn't installed on this repo any more.");
        return;
      }
    }
    const updated = store.update(task.id, {
      state: "pr-open",
      prUrl: pr.url,
      error: undefined,
      pr: {
        number: pr.number,
        url: pr.url,
        additions: pr.additions ?? current.pr?.additions,
        deletions: pr.deletions ?? current.pr?.deletions,
        changedFiles: pr.changedFiles ?? outcome.changedFiles,
        checks: current.pr?.checks ?? "unknown",
        mergeable: current.pr?.mergeable,
        updatedAt: new Date().toISOString(),
      },
    });
    if (!updated) return;
    publishTaskChange(userId, updated);
    postTaskComments(userId, task.id);
    void refreshPullRequest(userId, task.id);
    dispatchTasks(userId);
  } catch (err) {
    fail(userId, store, task.id, err instanceof Error ? err.message : String(err));
  }
}
