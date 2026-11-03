import fs from "node:fs";
import { installationToken, openPullRequest, appRequest } from "../github/app";
import { hasActiveServerRun, runServerRun } from "../runner/manager";
import { git, removeWorkspace, workspaceDir } from "../runner/workspace";
import { addWorktree, hasCheckout, removeWorktree } from "../runner/worktrees";
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
 * only for a repo linked to this user (the queue's "your repos", RepoLinks).
 * Any other public repo still runs — anonymously, without push.
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
  | { ok: true; gh?: { owner: string; name: string }; linked: boolean }
  | { ok: false; status: 403; error: string };

/** Whether this user may run on `url`, and whether with the App (linked to them). */
export function repoAccess(userId: string, url: string): RepoAccess {
  const gh = parseGitHub(url);
  const owner = gh ? taskStores.links.owner(url) : undefined;
  if (owner && owner !== userId) return { ok: false, status: 403, error: "this repo is linked to another Celiador account" };
  return { ok: true, gh, linked: !!gh && owner === userId };
}

/** The App's token for a session's repo, when it may use one (linked + installed). */
async function tokenFor(userId: string, url: string): Promise<string | undefined> {
  const access = repoAccess(userId, url);
  if (!access.ok || !access.linked || !access.gh) return undefined;
  return (await installationToken(access.gh).catch(() => null)) ?? undefined;
}

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
          : "Couldn't fetch the repo — it looks private. Add it to your repos (with the Celiador GitHub App installed on it) to run on it in the cloud.");
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
    if (!hasCheckout(dir)) {
      // The workspace went with a server restart: pick the branch up again — from
      // GitHub if it was pushed, else from its base (unpushed work is gone).
      try {
        publishSessionEvent(userId, session.id, { kind: "state", state: "running" });
        publishSessionEvent(userId, session.id, { kind: "activity", text: "The workspace was reset by a server restart; checking the branch out again…" });
        const token = repo.pushable ? await tokenFor(userId, repo.url) : undefined;
        const wt = await addWorktree({ userId, url: repo.url, remote: remoteFor(repo.url, token), token, dir, branch: repo.branch, base: repo.base });
        sessionStores.for(userId).setRepo(session.id, { ...repo, remoteSha: wt.remoteSha });
      } catch (err) {
        publishSessionEvent(userId, session.id, { kind: "error", message: `Couldn't check the branch out again: ${err instanceof Error ? err.message : String(err)}` });
        publishSessionEvent(userId, session.id, { kind: "state", state: "error" });
        return;
      }
    }
    await runServerRun({ userId, sessionId: session.id, repo: { url: repo.url }, prompt: text, workspaceReady: true, continueConversation: true });
  })();
  return { ok: true };
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

/** Push the worktree's HEAD to its branch, leasing against the last known remote sha. */
async function push(userId: string, session: Session, repo: SessionRepo, dir: string): Promise<SessionRepo> {
  const token = await tokenFor(userId, repo.url);
  if (!token) throw new Error("pushing needs the Celiador GitHub App on this repo, and the repo in your repos");
  const head = await headSha(dir);
  if (head === repo.remoteSha) return repo;
  try {
    await git(dir, ["push", "-q", `--force-with-lease=refs/heads/${repo.branch}:${repo.remoteSha}`, remoteFor(repo.url, token), `HEAD:refs/heads/${repo.branch}`], { timeout: NETWORK_TIMEOUT_MS, secret: token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/stale info|rejected|fetch first|non-fast-forward/i.test(msg)) throw new Error(`${repo.branch} moved on GitHub since this session last saw it; send a follow-up to bring the session up to date first`);
    throw err;
  }
  return sessionStores.for(userId).setRepo(session.id, { ...repo, remoteSha: head })?.repo ?? { ...repo, remoteSha: head };
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
        if (!gh || !repo.pushable) return { ok: false, error: "pull requests need the Celiador GitHub App on this repo, and the repo in your repos" };
        const base = command.base ?? repo.base;
        if (repo.branch === base) return { ok: false, error: `the session works directly on ${base}; there's nothing to open a pull request against` };
        if (repo.pr) return { ok: true, url: repo.pr.url, created: false };
        const pushed = await push(userId, session, repo, dir);
        const pr = await openPullRequest(gh, { title: command.title, head: repo.branch, base, body: command.body ?? "" });
        if (!pr) return { ok: false, error: "the Celiador GitHub App isn't installed on this repo any more" };
        sessionStores.for(userId).setRepo(session.id, { ...pushed, pr: { number: pr.number, url: pr.url } });
        return { ok: true, url: pr.url, created: true };
      }
      case "git.merge": {
        const gh = parseGitHub(repo.url);
        if (!gh || !repo.pushable) return { ok: false, error: "merging needs the Celiador GitHub App on this repo" };
        if (!repo.pr) return { ok: false, error: "open the pull request first" };
        const res = await appRequest(gh, "PUT", `/pulls/${repo.pr.number}/merge`, command.method ? { merge_method: command.method } : {});
        if (!res) return { ok: false, error: "the Celiador GitHub App isn't installed on this repo any more" };
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

/** The user's repos for the phone's cloud picker: linked repos, with whether the App can act on each. */
export async function cloudRepos(userId: string): Promise<Array<{ url: string; owner: string; name: string; app: boolean; defaultBranch?: string; private?: boolean }>> {
  const urls = taskStores.links.forUser(userId);
  const out = await Promise.all(urls.map(async (url) => {
    const gh = parseGitHub(url);
    if (!gh) return undefined;
    const res = await appRequest(gh, "GET", "").catch(() => null);
    const ok = res?.status === 200;
    return {
      url,
      owner: gh.owner,
      name: gh.name,
      app: ok,
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
  const [repoRes, res] = await Promise.all([
    appRequest(access.gh, "GET", "").catch(() => null),
    appRequest(access.gh, "GET", "/branches?per_page=100").catch(() => null),
  ]);
  if (!res || res.status !== 200 || !Array.isArray(res.json)) return { error: "the Celiador GitHub App isn't installed on this repo", status: 409 };
  const def = typeof repoRes?.json?.default_branch === "string" ? (repoRes.json.default_branch as string) : undefined;
  const names = (res.json as Array<{ name?: unknown }>).map((b) => b.name).filter((n): n is string => typeof n === "string");
  return { branches: def ? [def, ...names.filter((n) => n !== def)] : names, defaultBranch: def };
}

