import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config";
import { git } from "./workspace";

/**
 * Cloud checkouts as git worktrees. Each user gets one cached bare mirror per
 * repository (data/repos/<userId>/<hash>.git) and every cloud run is a
 * `git worktree add` of it in the run's own directory (data/runs/<userId>/<runId>/repo),
 * on its own branch. So a repo is fetched once and then only incrementally,
 * runs on the same repo share objects, and two runs can't sit on the same
 * branch (git refuses to check a branch out twice).
 *
 * The mirror's remote URL is never stored: like the old clones, the App token
 * rides in the URL for one command only. Remote branches land in
 * refs/remotes/origin/*, with refs/remotes/origin/HEAD pointing at the default
 * branch, so code that asks a checkout for `origin/HEAD` keeps working.
 *
 * All mirror mutations (fetch, worktree add/remove/prune, branch delete) are
 * serialised per mirror; a worktree's own operations (commit, push) aren't.
 */

const NETWORK_TIMEOUT_MS = 180_000;

export function mirrorsRoot(): string {
  return path.join(ROOT, "data", "repos");
}

/** The user's mirror of a repository, keyed by the normalised URL (case-insensitive, no .git / trailing slash). */
export function mirrorDir(userId: string, url: string): string {
  const key = url.trim().toLowerCase().replace(/\/+$/, "").replace(/\.git$/, "");
  return path.join(mirrorsRoot(), userId, `${crypto.createHash("sha256").update(key).digest("hex").slice(0, 24)}.git`);
}

const locks = new Map<string, Promise<unknown>>();

/** Run `fn` with the mirror's lock held (a per-mirror promise chain). */
export function withMirror<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(dir) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.catch(() => undefined);
  locks.set(dir, settled);
  void settled.then(() => { if (locks.get(dir) === settled) locks.delete(dir); });
  return next;
}

/** The remote URL with the token in it (github https only); `url` itself otherwise. */
export function authedUrl(url: string, token?: string): string {
  return token && /^https:\/\/github\.com\//i.test(url) ? url.replace(/^https:\/\//i, `https://x-access-token:${token}@`) : url;
}

/** `ls-remote --symref <remote> HEAD` → the default branch name, if the remote says. */
async function remoteDefaultBranch(dir: string, remote: string, secret?: string): Promise<string | undefined> {
  const out = await git(dir, ["ls-remote", "--symref", remote, "HEAD"], { timeout: NETWORK_TIMEOUT_MS, secret }).catch(() => "");
  const m = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(out);
  return m?.[1];
}

/**
 * Create the mirror if needed and fetch every branch into refs/remotes/origin/*.
 * Caller holds the mirror lock. `remote` may carry a token (`secret` scrubs it).
 */
async function fetchMirror(dir: string, remote: string, secret?: string): Promise<void> {
  if (!fs.existsSync(path.join(dir, "HEAD"))) {
    await fs.promises.mkdir(dir, { recursive: true });
    await git(dir, ["init", "-q", "--bare"]);
    // Reflogs in the worktrees, as a normal clone has (a bare repo turns them off).
    await git(dir, ["config", "core.logAllRefUpdates", "true"]);
  }
  await git(dir, ["fetch", "-q", "--prune", "--no-tags", remote, "+refs/heads/*:refs/remotes/origin/*"], { timeout: NETWORK_TIMEOUT_MS, secret });
  const def = await remoteDefaultBranch(dir, remote, secret);
  if (def) await git(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${def}`]);
  // Worktrees whose run directories are gone (deleted sessions, the boot sweep) release their branches.
  await git(dir, ["worktree", "prune"]).catch(() => undefined);
}

/** The default branch name of a fetched mirror (origin/HEAD), else the first of main/master that exists. */
export async function mirrorDefaultBranch(dir: string): Promise<string | undefined> {
  const sym = (await git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "")).trim();
  if (sym.startsWith("origin/")) return sym.slice("origin/".length);
  for (const b of ["main", "master"]) {
    if (await git(dir, ["rev-parse", "--verify", "-q", `refs/remotes/origin/${b}`]).then(() => true, () => false)) return b;
  }
  return undefined;
}

export interface IWorktreeParams {
  readonly userId: string;
  /** The repository URL (the mirror's key). */
  readonly url: string;
  /** The URL git actually talks to (may differ from `url` in tests); defaults to `url`. */
  readonly remote?: string;
  /** GitHub App installation token for private repos; scrubbed from errors. */
  readonly token?: string;
  /** The worktree directory (the run's workspace). */
  readonly dir: string;
  /** The local branch the worktree is on. */
  readonly branch: string;
  /**
   * Where `branch` starts when it doesn't exist on the remote yet: a remote
   * branch name (default: the remote's default branch).
   */
  readonly base?: string;
}

export interface IWorktree {
  /** The branch's remote sha when the worktree was made ("" = new branch, not on the remote). */
  readonly remoteSha: string;
  /** The base branch it started from (or would have, for an existing branch). */
  readonly base: string;
  /** The sha the worktree's HEAD started at. */
  readonly headSha: string;
}

/**
 * Fetch the mirror and add a worktree at `dir` on `branch`: from the remote
 * branch when it exists (continuing it), else new from `base`. A local branch
 * of that name left by an earlier, finished run is reset; one checked out by a
 * live run is refused by git ("already checked out").
 */
export async function addWorktree(p: IWorktreeParams): Promise<IWorktree> {
  const mirror = mirrorDir(p.userId, p.url);
  const remote = authedUrl(p.remote ?? p.url, p.token);
  return withMirror(mirror, async () => {
    await fetchMirror(mirror, remote, p.token);
    const base = p.base || (await mirrorDefaultBranch(mirror));
    if (!base) throw new Error("the repository has no branches yet");
    const remoteSha = (await git(mirror, ["rev-parse", "--verify", "-q", `refs/remotes/origin/${p.branch}`]).catch(() => "")).trim();
    const start = remoteSha ? `refs/remotes/origin/${p.branch}` : `refs/remotes/origin/${base}`;
    if (!remoteSha && !(await git(mirror, ["rev-parse", "--verify", "-q", start]).then(() => true, () => false))) {
      throw new Error(`branch "${base}" doesn't exist on the remote`);
    }
    await fs.promises.rm(p.dir, { recursive: true, force: true });
    await fs.promises.mkdir(path.dirname(p.dir), { recursive: true });
    try {
      await git(mirror, ["worktree", "add", "-q", "--no-track", "-B", p.branch, p.dir, start]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already (checked out|used by worktree)/i.test(msg)) throw new Error(`branch "${p.branch}" is already in use by another cloud session`);
      throw err;
    }
    const headSha = (await git(p.dir, ["rev-parse", "HEAD"])).trim();
    return { remoteSha, base, headSha };
  });
}

/**
 * Fetch one remote branch into the mirror (for a follow-up: has someone pushed
 * to the run's branch meanwhile?). Returns its remote sha, "" when it doesn't exist.
 */
export async function fetchBranch(p: { userId: string; url: string; remote?: string; token?: string; branch: string }): Promise<string> {
  const mirror = mirrorDir(p.userId, p.url);
  const remote = authedUrl(p.remote ?? p.url, p.token);
  return withMirror(mirror, async () => {
    const ref = `refs/heads/${p.branch}`;
    // ls-remote patterns match on a tail (`refs/heads/x` also matches `refs/heads/a/refs/heads/x`): take the exact ref.
    const out = await git(mirror, ["ls-remote", remote, ref], { timeout: NETWORK_TIMEOUT_MS, secret: p.token });
    const sha = out.split("\n").map((l) => l.split(/\s+/)).find((cols) => cols[1] === ref)?.[0] ?? "";
    if (sha) await git(mirror, ["fetch", "-q", "--no-tags", remote, `+${ref}:refs/remotes/origin/${p.branch}`], { timeout: NETWORK_TIMEOUT_MS, secret: p.token });
    else await git(mirror, ["update-ref", "-d", `refs/remotes/origin/${p.branch}`]).catch(() => undefined);
    return sha;
  });
}

/** Whether commit `a` is an ancestor of (or equal to) `b` in `dir`. Any git failure counts as "no". */
export async function isAncestor(dir: string, a: string, b: string): Promise<boolean> {
  return git(dir, ["merge-base", "--is-ancestor", a, b]).then(() => true, () => false);
}

/** Whether `dir` holds a live worktree (or any checkout). */
export function hasCheckout(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

/**
 * The absolute git dir shared by a worktree (its mirror), or undefined when
 * `dir` is a plain clone. The sandbox mounts it at the same path, or git inside
 * the container couldn't find the worktree's objects.
 */
export async function worktreeCommonDir(dir: string): Promise<string | undefined> {
  const dotGit = path.join(dir, ".git");
  const stat = await fs.promises.stat(dotGit).catch(() => undefined);
  if (!stat?.isFile()) return undefined;
  const out = (await git(dir, ["rev-parse", "--git-common-dir"])).trim();
  return out ? path.resolve(dir, out) : undefined;
}

/**
 * Detach a run's worktree from its mirror and drop the run's local branch.
 * Best-effort; used when a session is deleted (the directory itself goes with
 * removeWorkspace, and `worktree prune` would catch it later anyway).
 */
export async function removeWorktree(userId: string, url: string, dir: string, branch?: string): Promise<void> {
  const mirror = mirrorDir(userId, url);
  if (!fs.existsSync(mirror)) return;
  await withMirror(mirror, async () => {
    await git(mirror, ["worktree", "remove", "--force", dir]).catch(() => undefined);
    await git(mirror, ["worktree", "prune"]).catch(() => undefined);
    if (branch) await git(mirror, ["branch", "-q", "-D", branch]).catch(() => undefined);
  }).catch(() => undefined);
}

/** Remove all of a user's mirrors (account deletion). Best-effort. */
export async function purgeUserMirrors(userId: string): Promise<void> {
  await fs.promises.rm(path.join(mirrorsRoot(), userId), { recursive: true, force: true }).catch(() => undefined);
}
