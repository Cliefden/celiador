import fs from "node:fs";
import { hasProvenLink } from "../github/access";
import { installationToken, openPullRequest, appRequest } from "../github/app";
import { hasActiveServerRun, runServerRun } from "../runner/manager";
import { git, removeWorkspace, workspaceDir } from "../runner/workspace";
import { addWorktree, fetchBranch, hasCheckout, isAncestor, removeWorktree } from "../runner/worktrees";
import { cloudFollowUp } from "../tasks/cloud";
import { taskStores } from "../tasks/dispatch";
import { sessionStores } from "./instance";
import { publishSessionEvent } from "./publish";
import type { FsResult, GitCommand, GitFileStatus, Session, SessionRepo } from "./types";

/**
 * Cloud sessions: an agent session the phone starts on a GitHub repo, run by
 * the daemon in the sandboxed runner — no editor, no computer. The checkout is
 * a git worktree of the user's mirror of the repo (runner/worktrees.ts), on its
 * own branch (new from a base branch, or an existing branch to continue). The
 * session takes follow-ups (another turn, continuing the agent's conversation)
 * and serves the same review API as an editor run — status, diff, commit,
 * revert, push, pull request, merge — done here with git and the Celiador
 * GitHub App, since the sandbox itself has no network.
 *
 * Access: the App's installation token (private clone, push, PR, merge) is used
 * only for a repo linked to this user (the queue's "your repos", RepoLinks) with
 * a proof that their own GitHub account can write to it (github/access.ts, #79),
 * re-checked on every use. Any other public repo still runs — anonymously,
 * without push.
 */

const COMMIT_NAME = "Celiador";
const COMMIT_EMAIL = "noreply@celiador.ai";
const NETWORK_TIMEOUT_MS = 120_000;

/** `https://github.com/<owner>/<name>(.git)` → owner/name, else undefined. */
export function parseGitHub(url: string): { owner: string; name: string } | undefined {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m?.[1] && m[2] ? { owner: m[1], name: m[2] } : undefined;
}

/** A valid git branch name for our purposes (no spaces, no `..`, no leading `-`, ≤ 200). */
export function validBranch(b: unknown): b is string {
  return typeof b === "string" && b.length > 0 && b.length <= 200 && /^[A-Za-z0-9._/-]+$/.test(b) && !b.startsWith("-") && !b.startsWith("/") && !b.endsWith("/") && !b.endsWith(".lock") && !b.includes("..") && !b.includes("//");
}

/** `celiador/<slug-of-the-prompt>-<4 of the id>`. */
export function sessionBranch(prompt: string, sessionId: string): string {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `celiador/${slug || "session"}-${sessionId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase()}`;
}

export type RepoAccess =
  | { ok: true; gh?: { owner: string; name: string }; linked: boolean; proven: boolean }
  | { ok: false; status: 403; error: string };

/**
 * Whether this user may run on `url`, and whether with the App: `linked` = in
 * their repos, `proven` = that link carries a proof of their GitHub access
 * (github/access.ts) — the only case the App's token is ever used for them.
 */
export function repoAccess(userId: string, url: string): RepoAccess {
  const gh = parseGitHub(url);
  const owner = gh ? taskStores.links.owner(url) : undefined;
  if (owner && owner !== userId) return { ok: false, status: 403, error: "this repo is linked to another Celiador account" };
  const linked = !!gh && owner === userId;
  return { ok: true, gh, linked, proven: linked && hasProvenLink(userId, url) };
}

/** The App's token for a session's repo, when it may use one (proven link + installed; re-checked on every use). */
async function tokenFor(userId: string, url: string): Promise<string | undefined> {
  const access = repoAccess(userId, url);
  if (!access.ok || !access.proven || !access.gh) return undefined;
  return (await installationToken({ userId }, access.gh).catch(() => null)) ?? undefined;
}

const NEEDS_PROOF = "needs the Celiador GitHub App on this repo, and the repo in your repos verified with your GitHub account (connect GitHub in Celiador)";

/** Test seam: the remote git talks to for a repo URL (the smoke test serves a local bare repo). */
let remoteOverride: ((url: string) => string) | undefined;
export function overrideCloudSessionRemoteForTests(fn?: (url: string) => string): void {
  remoteOverride = fn;
}
function remoteFor(url: string, token?: string): string {
  if (remoteOverride) return remoteOverride(url);
  return token ? url.replace(/^https:\/\//i, `https://x-access-token:${token}@`) : url;
}

export interface ICloudSessionStart {
  readonly url: string;
  /** Branch to start from (new branch) or to work on (`existingBranch`). Default: the default branch. */
  readonly branch?: string;
  /** Work directly on `branch` instead of a new branch off it. */
  readonly existingBranch?: boolean;
  readonly prompt: string;
}

/**
 * Prepare the session's worktree and run the first turn. Resolves once the
 * run is launched; progress and failure go to the session's relay log.
 */
export async function startCloudSession(userId: string, session: Session, p: ICloudSessionStart): Promise<void> {
  const publish = (e: Parameters<typeof publishSessionEvent>[2]) => publishSessionEvent(userId, session.id, e);
  try {
    publish({ kind: "state", state: "running" });
    publish({ kind: "activity", text: `Checking out ${parseGitHub(p.url) ? `${parseGitHub(p.url)!.owner}/${parseGitHub(p.url)!.name}` : p.url}…` });
    const token = await tokenFor(userId, p.url);
    const branch = p.existingBranch && p.branch ? p.branch : sessionBranch(p.prompt, session.id);
    const dir = workspaceDir(userId, session.id);
    const wt = await addWorktree({
      userId,
      url: p.url,
      remote: remoteFor(p.url, token),
      token,
      dir,
      branch,
      // Continuing an existing branch: the pull request goes to the default branch.
      base: p.existingBranch ? undefined : p.branch,
    }).catch((err) => {
      const raw = err instanceof Error ? err.message : String(err);
      if (/could not read Username|Authentication failed|Repository not found/i.test(raw)) {
        throw new Error(token || !parseGitHub(p.url)
          ? "Couldn't fetch the repo."
          : "Couldn't fetch the repo — it looks private. Add it to your repos, verified with your GitHub account (connect GitHub in Celiador) and with the Celiador GitHub App installed on it, to run on it in the cloud.");
      }
      throw err;
    });
    if (p.existingBranch && !wt.remoteSha) throw new Error(`branch "${branch}" doesn't exist on the remote`);
    const gh = parseGitHub(p.url);
    sessionStores.for(userId).setRepo(session.id, {
      url: p.url,
      ...(gh ? { owner: gh.owner, name: gh.name } : {}),
      branch,
      base: wt.base,
      existingBranch: !!p.existingBranch,
      pushable: !!token,
      remoteSha: wt.remoteSha,
    });
    publish({ kind: "activity", text: wt.remoteSha ? `On ${branch}` : `New branch ${branch} from ${wt.base}` });
  } catch (err) {
    publish({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    publish({ kind: "state", state: "error" });
    return;
  }
  void runServerRun({ userId, sessionId: session.id, repo: { url: p.url }, prompt: p.prompt, workspaceReady: true });
}

/**
 * A follow-up message on a cloud session: another turn in the same worktree,
 * continuing the agent's conversation. A cloud task's session goes through the
 * task's own follow-up (which pushes and refreshes its pull request).
 */
export async function cloudSessionFollowUp(userId: string, session: Session, text: string): Promise<{ ok: true } | { error: string; status: 409 | 503 }> {
  const task = taskStores.for(userId).forSession(session.id);
  if (task) return cloudFollowUp(userId, task.id, text);
  if (hasActiveServerRun(session.id)) return { error: "the cloud run is still working; wait for it to finish", status: 409 };
  const repo = session.repo;
  if (!repo) return { error: "this cloud run can't take follow-ups (it was started before they existed)", status: 409 };
  publishSessionEvent(userId, session.id, { kind: "message", role: "user", text });
  void (async () => {
    const dir = workspaceDir(userId, session.id);
    const fail = (message: string) => {
      publishSessionEvent(userId, session.id, { kind: "error", message });
      publishSessionEvent(userId, session.id, { kind: "state", state: "error" });
    };
    publishSessionEvent(userId, session.id, { kind: "state", state: "running" });
    if (!hasCheckout(dir)) {
      // The workspace went with a server restart: pick the branch up again — from
      // GitHub if it was pushed, else from its base (unpushed work is gone).
      try {
        publishSessionEvent(userId, session.id, { kind: "activity", text: "The workspace was reset by a server restart; checking the branch out again…" });
        const token = repo.pushable ? await tokenFor(userId, repo.url) : undefined;
        const wt = await addWorktree({ userId, url: repo.url, remote: remoteFor(repo.url, token), token, dir, branch: repo.branch, base: repo.base });
        // A branch the session had on GitHub that is gone now: don't quietly start it over from the base.
        if (repo.remoteSha && !wt.remoteSha) return fail(branchDeletedMessage(repo.branch));
        sessionStores.for(userId).setRepo(session.id, { ...repo, remoteSha: wt.remoteSha });
      } catch (err) {
        return fail(`Couldn't check the branch out again: ${scrub(err)}`);
      }
    } else {
      const synced = await syncWithRemote(userId, session, repo, dir);
      if (!synced.ok) return fail(synced.error);
      if (synced.note) publishSessionEvent(userId, session.id, { kind: "activity", text: synced.note });
    }
    await runServerRun({ userId, sessionId: session.id, repo: { url: repo.url }, prompt: text, workspaceReady: true, continueConversation: true });
  })();
  return { ok: true };
}

function scrub(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@");
}

function branchDeletedMessage(branch: string): string {
  return `${branch} no longer exists on GitHub (was its pull request merged?). Start a new session to keep working.`;
}

/**
 * Before a follow-up turn on a retained worktree: fetch the session's branch
 * from GitHub and fast-forward onto anything that landed there meanwhile (a
 * reviewer's commit, a push from the editor), so the agent works on the
 * current branch and the next push is a fast-forward. Refuses — rather than
 * silently running on a stale copy — when the branch was deleted on GitHub
 * after the session had it there, or when the two sides diverged. A failed
 * fetch (network) is not fatal: the turn runs on the session's copy and the
 * push re-checks against GitHub anyway. Records the fetched sha as the
 * session's `remoteSha`. Exported for the smoke test.
 */
export async function syncWithRemote(userId: string, session: Session, repo: SessionRepo, dir: string): Promise<{ ok: true; repo: SessionRepo; note?: string } | { ok: false; error: string }> {
  const token = repo.pushable ? await tokenFor(userId, repo.url) : undefined;
  let remoteSha: string;
  try {
    remoteSha = await fetchBranch({ userId, url: repo.url, remote: remoteFor(repo.url, token), token, branch: repo.branch });
  } catch (err) {
    return { ok: true, repo, note: `Couldn't check GitHub for new commits on ${repo.branch} (${scrub(err).split("\n")[0]}); continuing on the session's copy.` };
  }
  if (!remoteSha) {
    // Never pushed (a new celiador/ branch): nothing to catch up with.
    if (!repo.remoteSha) return { ok: true, repo };
    return { ok: false, error: branchDeletedMessage(repo.branch) };
  }
  const head = await headSha(dir);
  let note: string | undefined;
  if (remoteSha !== head && !(await isAncestor(dir, remoteSha, head))) {
    if (!(await isAncestor(dir, head, remoteSha))) {
      return {
        ok: false,
        error: `${repo.branch} has commits on GitHub that this session doesn't have, and the session has commits GitHub doesn't, so it can't be brought up to date by a fast-forward. Celiador won't rewrite either side; start a new session on ${repo.branch} to continue from GitHub's version.`,
      };
    }
    try {
      await git(dir, ["merge", "--ff-only", "-q", remoteSha]);
    } catch (err) {
      const raw = scrub(err);
      return {
        ok: false,
        error: /overwritten|uncommitted|untracked working tree/i.test(raw)
          ? `${repo.branch} has new commits on GitHub that touch files with uncommitted changes in this session. Commit or revert them from Changes, then send the follow-up again.`
          : `Couldn't bring ${repo.branch} up to date with GitHub: ${raw.split("\n")[0]}`,
      };
    }
    note = `Brought ${repo.branch} up to date with GitHub (${remoteSha.slice(0, 7)}).`;
  }
  const updated = sessionStores.for(userId).setRepo(session.id, { ...repo, remoteSha })?.repo ?? { ...repo, remoteSha };
  return { ok: true, repo: updated, note };
}

/** Delete-time cleanup: detach the worktree from the mirror and drop the run's directory. */
export async function removeCloudSession(userId: string, session: Session | undefined, sessionId: string): Promise<void> {
  if (session?.repo) {
    // An existing branch the user continued is theirs on the remote — only our local ref goes.
    await removeWorktree(userId, session.repo.url, workspaceDir(userId, sessionId), session.repo.branch);
  }
  await removeWorkspace(userId, sessionId);
}

// ---- Review: the editor's git.* commands, served from the worktree ----------

/** `git status --porcelain -z` → the editor's GitFileStatus list. Pure; exported for tests. */
export function parsePorcelain(out: string): GitFileStatus[] {
  const parts = out.split("\0");
  const files: GitFileStatus[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const file = entry.slice(3);
    if (xy[0] === "R" || xy[0] === "C") i++; // the rename's source path follows
    const code = xy === "??" ? "U" : xy[0] !== " " ? xy[0]! : xy[1]!;
    files.push({ path: file, status: code === "?" ? "U" : code });
  }
  return files;
}

async function headSha(dir: string): Promise<string> {
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

/**
 * Push the worktree's HEAD to its branch.
 *
 * - An existing branch the user chose to work on directly (`existingBranch`,
 *   possibly the default branch): fast-forward only, never forced. The live
 *   remote tip is fetched first and must be an ancestor of HEAD; otherwise the
 *   push would rewrite history someone else owns (an agent's amend / rebase /
 *   reset, or commits GitHub has that the session doesn't), and it's refused
 *   with the reason. The plain push is also refused by git if the branch moves
 *   between the check and the push.
 * - The session's own fresh `celiador/…` branch: `--force-with-lease` against
 *   the last sha the session pushed (or "must not exist yet"). The branch is
 *   the session's scratch branch, so an agent tidying its own unmerged commits
 *   is fine, while the lease still refuses to clobber anything pushed by
 *   someone else since.
 */
async function push(userId: string, session: Session, repo: SessionRepo, dir: string): Promise<SessionRepo> {
  const token = await tokenFor(userId, repo.url);
  if (!token) throw new Error(`pushing ${NEEDS_PROOF}`);
  const head = await headSha(dir);
  const remote = remoteFor(repo.url, token);
  const store = sessionStores.for(userId);
  if (repo.existingBranch) {
    const live = await fetchBranch({ userId, url: repo.url, remote, token, branch: repo.branch });
    if (live === head) return live === repo.remoteSha ? repo : store.setRepo(session.id, { ...repo, remoteSha: live })?.repo ?? { ...repo, remoteSha: live };
    if (!live && repo.remoteSha) throw new Error(branchDeletedMessage(repo.branch));
    if (live && !(await isAncestor(dir, live, head))) throw new Error(nonFastForwardMessage(repo.branch, await isAncestor(dir, head, live)));
    try {
      await git(dir, ["push", "-q", remote, `HEAD:refs/heads/${repo.branch}`], { timeout: NETWORK_TIMEOUT_MS, secret: token });
    } catch (err) {
      if (/rejected|fetch first|non-fast-forward/i.test(scrub(err))) throw new Error(nonFastForwardMessage(repo.branch, false));
      throw err;
    }
  } else {
    // No "already pushed" shortcut on the cached sha: the push (a no-op when GitHub
    // has it) is what notices the branch was deleted or moved there since.
    try {
      await git(dir, ["push", "-q", `--force-with-lease=refs/heads/${repo.branch}:${repo.remoteSha}`, remote, `HEAD:refs/heads/${repo.branch}`], { timeout: NETWORK_TIMEOUT_MS, secret: token });
    } catch (err) {
      if (/stale info|rejected|fetch first|non-fast-forward/i.test(scrub(err))) {
        throw new Error(`${repo.branch} changed on GitHub since this session last saw it. Send a follow-up: it fast-forwards the session onto GitHub's version first (or says why it can't).`);
      }
      throw err;
    }
  }
  return store.setRepo(session.id, { ...repo, remoteSha: head })?.repo ?? { ...repo, remoteSha: head };
}

/** Why a push to an existing branch was refused. `behind`: GitHub only has extra commits (a follow-up fixes it). */
function nonFastForwardMessage(branch: string, behind: boolean): string {
  return behind
    ? `${branch} has new commits on GitHub that this session doesn't have yet. Send a follow-up to bring the session up to date, then push.`
    : `Pushing would rewrite ${branch}'s history on GitHub, and Celiador never force-pushes a branch you chose to work on directly. ` +
      `The session's commits don't sit on top of GitHub's ${branch} (the agent amended, rebased or reset commits that are already there, or both sides have new commits). ` +
      `Ask the agent to redo its change as new commits on top of origin/${branch}, or start a new session.`;
}

/**
 * Run one review command against a cloud session's worktree. Same contract as
 * the editor's `fs.result` reply, so the route shapes both the same way.
 */
export async function cloudGit(userId: string, session: Session, command: GitCommand): Promise<FsResult> {
  const repo = session.repo;
  if (!repo) return { ok: false, error: "review isn't available for this cloud run" };
  const dir = workspaceDir(userId, session.id);
  if (!fs.existsSync(dir) || !hasCheckout(dir)) return { ok: false, error: "the workspace is gone (server restart); send a follow-up to check the branch out again" };
  const busy = hasActiveServerRun(session.id);
  try {
    switch (command.kind) {
      case "git.status": {
        const out = await git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
        return { ok: true, branch: repo.branch, files: parsePorcelain(out) };
      }
      case "git.diff": {
        // Intent-to-add makes new files show up in a diff against HEAD without staging their content.
        await git(dir, ["add", "-A", "-N"]);
        const patch = await git(dir, ["diff", "HEAD", ...(command.path ? ["--", command.path] : [])]);
        return { ok: true, patch };
      }
      case "git.commit": {
        if (busy) return { ok: false, error: "the agent is still working; commit when it's done" };
        await git(dir, ["add", "-A", ...(command.paths?.length ? ["--", ...command.paths] : [])]);
        if (!(await git(dir, ["diff", "--cached", "--name-only"])).trim()) return { ok: false, error: "nothing to commit" };
        await git(dir, ["-c", `user.name=${COMMIT_NAME}`, "-c", `user.email=${COMMIT_EMAIL}`, "commit", "-q", "-m", command.message, ...(command.paths?.length ? ["--", ...command.paths] : [])]);
        return { ok: true, sha: await headSha(dir) };
      }
      case "git.revert": {
        if (busy) return { ok: false, error: "the agent is still working; revert when it's done" };
        for (const p of command.paths) {
          const tracked = await git(dir, ["cat-file", "-e", `HEAD:${p}`]).then(() => true, () => false);
          if (tracked) {
            await git(dir, ["restore", "--source=HEAD", "--staged", "--worktree", "--", p]);
          } else {
            await git(dir, ["rm", "-q", "-f", "--cached", "--ignore-unmatch", "--", p]);
            await git(dir, ["clean", "-q", "-f", "--", p]);
          }
        }
        return { ok: true };
      }
      case "git.push": {
        if (busy) return { ok: false, error: "the agent is still working; push when it's done" };
        await push(userId, session, repo, dir);
        return { ok: true, branch: repo.branch, remote: "origin" };
      }
      case "git.pr": {
        if (busy) return { ok: false, error: "the agent is still working; open the pull request when it's done" };
        const gh = parseGitHub(repo.url);
        if (!gh || !repo.pushable) return { ok: false, error: `a pull request ${NEEDS_PROOF}` };
        const base = command.base ?? repo.base;
        if (repo.branch === base) return { ok: false, error: `the session works directly on ${base}; there's nothing to open a pull request against` };
        if (repo.pr) return { ok: true, url: repo.pr.url, created: false };
        const pushed = await push(userId, session, repo, dir);
        const pr = await openPullRequest({ userId }, gh, { title: command.title, head: repo.branch, base, body: command.body ?? "" });
        if (!pr) return { ok: false, error: "the Celiador GitHub App can't act on this repo for you any more (not installed, or your GitHub access changed)" };
        sessionStores.for(userId).setRepo(session.id, { ...pushed, pr: { number: pr.number, url: pr.url } });
        return { ok: true, url: pr.url, created: true };
      }
      case "git.merge": {
        const gh = parseGitHub(repo.url);
        if (!gh || !repo.pushable) return { ok: false, error: `merging ${NEEDS_PROOF}` };
        if (!repo.pr) return { ok: false, error: "open the pull request first" };
        const res = await appRequest({ userId }, gh, "PUT", `/pulls/${repo.pr.number}/merge`, command.method ? { merge_method: command.method } : {});
        if (!res) return { ok: false, error: "the Celiador GitHub App can't act on this repo for you any more (not installed, or your GitHub access changed)" };
        if (res.status === 200 && res.json?.merged === true) {
          return { ok: true, merged: true, sha: typeof res.json.sha === "string" ? res.json.sha : undefined, url: repo.pr.url };
        }
        return { ok: false, error: String(res.json?.message ?? "the pull request was not merged") };
      }
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, error: raw.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@") };
  }
  return { ok: false, error: "unsupported" };
}

/**
 * The user's repos for the phone's cloud picker: linked repos, with whether the
 * App can act on each for them (`app`: proven link + installed) and whether the
 * link carries a proof at all (`verified`; false → connect GitHub to verify).
 */
export async function cloudRepos(userId: string): Promise<Array<{ url: string; owner: string; name: string; app: boolean; verified: boolean; defaultBranch?: string; private?: boolean }>> {
  const urls = taskStores.links.forUser(userId);
  const out = await Promise.all(urls.map(async (url) => {
    const gh = parseGitHub(url);
    if (!gh) return undefined;
    const res = await appRequest({ userId }, gh, "GET", "").catch(() => null);
    const ok = res?.status === 200;
    return {
      url,
      owner: gh.owner,
      name: gh.name,
      app: ok,
      verified: hasProvenLink(userId, url),
      ...(ok && typeof res.json?.default_branch === "string" ? { defaultBranch: res.json.default_branch as string } : {}),
      ...(ok && typeof res.json?.private === "boolean" ? { private: res.json.private as boolean } : {}),
    };
  }));
  return out.filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
}

/** A linked repo's branches (first 100) via the App, default branch first. */
export async function cloudBranches(userId: string, url: string): Promise<{ branches: string[]; defaultBranch?: string } | { error: string; status: 403 | 404 | 409 }> {
  const access = repoAccess(userId, url);
  if (!access.ok) return { error: access.error, status: access.status };
  if (!access.gh) return { error: "not a github.com repo", status: 404 };
  if (!access.linked) return { error: "add the repo to your repos to list its branches", status: 409 };
  if (!access.proven) return { error: "verify the repo with your GitHub account (connect GitHub in Celiador) to list its branches", status: 409 };
  const [repoRes, res] = await Promise.all([
    appRequest({ userId }, access.gh, "GET", "").catch(() => null),
    appRequest({ userId }, access.gh, "GET", "/branches?per_page=100").catch(() => null),
  ]);
  if (!res || res.status !== 200 || !Array.isArray(res.json)) return { error: "the Celiador GitHub App can't act on this repo for you (not installed, or your GitHub access changed)", status: 409 };
  const def = typeof repoRes?.json?.default_branch === "string" ? (repoRes.json.default_branch as string) : undefined;
  const names = (res.json as Array<{ name?: unknown }>).map((b) => b.name).filter((n): n is string => typeof n === "string");
  return { branches: def ? [def, ...names.filter((n) => n !== def)] : names, defaultBranch: def };
}

