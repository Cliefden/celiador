import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { git, locationFile, MIRROR_CONFIG, mirrorsRoot, runsRoot, worktreeLocation, writeWorktreeLocation, type IWorktreeLocation } from "./workspace";

export { mirrorsRoot };

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
 * Celiador edit (#80): cloud checkouts are of github.com repositories only — the
 * same `https://github.com/<owner>/<name>(.git)` shape the routes accept (linked
 * repos are always that shape), so the daemon never fetches an arbitrary host.
 */
export function isGitHubRepoUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?(?:\.git)?\/?$/i.test(url.trim());
}

/** Git's temporary pack files in a mirror (what a killed fetch leaves behind). */
async function tmpPackFiles(dir: string): Promise<string[]> {
  const packDir = path.join(dir, "objects", "pack");
  const names = await fs.promises.readdir(packDir).catch(() => [] as string[]);
  return names.filter((n) => /^tmp_(pack|idx|rev)_/.test(n)).map((n) => path.join(packDir, n));
}

/**
 * `git fetch -q <args>` into a mirror (caller holds its lock). A fetch killed at
 * the timeout, or failed mid-transfer, leaves its partial pack behind
 * (`objects/pack/tmp_pack_*`): those it created are removed before the error
 * is passed on. Exported for the smoke test.
 */
export async function gitFetch(dir: string, args: string[], secret?: string, timeout = NETWORK_TIMEOUT_MS): Promise<void> {
  const before = new Set(await tmpPackFiles(dir));
  try {
    await git(dir, ["fetch", "-q", ...args], { timeout, secret });
  } catch (err) {
    for (const f of await tmpPackFiles(dir)) if (!before.has(f)) await fs.promises.rm(f, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Create the mirror if needed and fetch every branch into refs/remotes/origin/*.
 * Caller holds the mirror lock. `remote` may carry a token (`secret` scrubs it).
 *
 * Full objects, not a partial clone (`--filter=blob:none`): a partial clone
 * fetches missing blobs lazily from its remote, but the mirror stores no remote
 * (the token rides in one command's URL) and the sandbox has no network, so any
 * later `git diff` / `log -p` / checkout of an old file would fail there.
 */
async function fetchMirror(dir: string, remote: string, secret?: string): Promise<void> {
  if (!fs.existsSync(path.join(dir, "HEAD"))) {
    await fs.promises.mkdir(dir, { recursive: true });
    await git(dir, ["init", "-q", "--bare"]);
    // The mirror's config is daemon-owned, byte for byte (workspace.ts enforces it
    // before every host git command): reflogs on, as a normal clone has (a bare repo turns them off).
    await fs.promises.writeFile(path.join(dir, "config"), MIRROR_CONFIG);
  }
  await gitFetch(dir, ["--prune", "--no-tags", remote, "+refs/heads/*:refs/remotes/origin/*"], secret);
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
  if (!isGitHubRepoUrl(p.url)) throw new Error("cloud runs check out github.com repositories only");
  const mirror = mirrorDir(p.userId, p.url);
  const remote = authedUrl(p.remote ?? p.url, p.token);
  return withMirror(mirror, async () => {
    await fetchMirror(mirror, remote, p.token);
    await enforceMirrorQuota(p.userId, mirror);
    const base = p.base || (await mirrorDefaultBranch(mirror));
    if (!base) throw new Error("the repository has no branches yet");
    const remoteSha = (await git(mirror, ["rev-parse", "--verify", "-q", `refs/remotes/origin/${p.branch}`]).catch(() => "")).trim();
    const start = remoteSha ? `refs/remotes/origin/${p.branch}` : `refs/remotes/origin/${base}`;
    if (!remoteSha && !(await git(mirror, ["rev-parse", "--verify", "-q", start]).then(() => true, () => false))) {
      throw new Error(`branch "${base}" doesn't exist on the remote`);
    }
    await fs.promises.rm(p.dir, { recursive: true, force: true });
    await fs.promises.rm(locationFile(p.dir), { force: true });
    await fs.promises.mkdir(path.dirname(p.dir), { recursive: true });
    // A previous worktree at this path whose metadata outlived it would make git pick another id.
    await git(mirror, ["worktree", "prune"]).catch(() => undefined);
    try {
      await git(mirror, ["worktree", "add", "-q", "--no-track", "-B", p.branch, p.dir, start]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already (checked out|used by worktree)/i.test(msg)) throw new Error(`branch "${p.branch}" is already in use by another cloud session`);
      throw err;
    }
    // Record where the worktree's git data is, now, before any agent has touched
    // the tree: every later host-side git command uses this record, never the
    // workspace's (agent-writable) `.git` file.
    writeWorktreeLocation(p.dir, freshWorktreeLocation(mirror, p.dir));
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
    if (sha) await gitFetch(mirror, ["--no-tags", remote, `+${ref}:refs/remotes/origin/${p.branch}`], p.token);
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
 * The metadata dir `git worktree add` just made for `dir`, read from the fresh
 * `.git` file (no agent has run yet) and checked against the mirror's layout.
 */
function freshWorktreeLocation(mirror: string, dir: string): IWorktreeLocation {
  const raw = fs.readFileSync(path.join(dir, ".git"), "utf8");
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(raw);
  // Real paths on both sides (git writes the resolved path; /tmp → /private/tmp on macOS).
  const gitDir = m?.[1] ? fs.realpathSync(path.resolve(dir, m[1])) : "";
  const commonDir = fs.realpathSync(mirror);
  if (path.dirname(gitDir) !== path.join(commonDir, "worktrees")) throw new Error(`unexpected worktree layout for ${dir}`);
  return { gitDir, commonDir };
}

/**
 * Where a workspace's git data is (its own metadata dir and the mirror), as the
 * daemon recorded it when it made the worktree; undefined for anything else.
 * The sandbox mounts these, so it must never come from the agent-writable `.git` file.
 */
export function worktreeMounts(dir: string): IWorktreeLocation | undefined {
  return worktreeLocation(dir);
}

/**
 * Detach a run's worktree from its mirror and drop the run's local branch.
 * Best-effort; used when a session is deleted (the directory itself goes with
 * removeWorkspace). The worktree's metadata dir is removed directly, from the
 * daemon's record — not with `git worktree remove`, which would read the
 * agent's tree and `.git` file.
 */
export async function removeWorktree(userId: string, url: string, dir: string, branch?: string): Promise<void> {
  const mirror = mirrorDir(userId, url);
  if (!fs.existsSync(mirror)) return;
  await withMirror(mirror, async () => {
    const loc = worktreeLocation(dir);
    if (loc && loc.commonDir === fs.realpathSync(mirror)) await fs.promises.rm(loc.gitDir, { recursive: true, force: true });
    await git(mirror, ["worktree", "prune"]).catch(() => undefined);
    if (branch) await git(mirror, ["branch", "-q", "-D", branch]).catch(() => undefined);
  }).catch(() => undefined);
}

// ---- Disk use: eviction and a per-user cap (#80) -----------------------------
//
// A mirror is "in use" while any of the user's run workspaces is a worktree of
// it, per the daemon's own location records (workspace.ts; never the agent's
// `.git` file). An unused mirror is removed when the last session on it is
// deleted (releaseMirror), at the boot sweep (sweepMirrors), and least recently
// fetched first when the user's mirrors together pass the cap. A mirror a live
// session or task uses is never removed; one that is evicted is simply fetched
// again by the next run on that repo.

/** The cap on one user's mirrors together: CELIADOR_MIRROR_QUOTA_MB (default 4096; 0 = no cap). */
export function mirrorQuotaBytes(): number {
  const raw = process.env.CELIADOR_MIRROR_QUOTA_MB;
  const mb = raw === undefined || raw.trim() === "" ? 4096 : Number(raw);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : Infinity;
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirBytes(p);
    else total += (await fs.promises.lstat(p).catch(() => undefined))?.size ?? 0;
  }
  return total;
}

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** The user's mirrors (real paths) that one of their run workspaces is a worktree of. */
async function mirrorsInUse(userId: string): Promise<Set<string>> {
  const used = new Set<string>();
  const userRuns = path.join(runsRoot(), userId);
  for (const run of await fs.promises.readdir(userRuns).catch(() => [] as string[])) {
    const loc = worktreeLocation(path.join(userRuns, run, "repo"));
    if (loc) used.add(loc.commonDir);
  }
  return used;
}

/** Remove `mirror` unless a workspace uses it. Caller holds its lock. True when removed. */
async function evictIfUnused(userId: string, mirror: string, used?: Set<string>): Promise<boolean> {
  if (!fs.existsSync(mirror)) return false;
  if ((used ?? (await mirrorsInUse(userId))).has(realpathOr(mirror))) return false;
  await fs.promises.rm(mirror, { recursive: true, force: true });
  return true;
}

/** When the mirror was last fetched (every fetch rewrites FETCH_HEAD), else made. */
function lastFetched(mirror: string): number {
  for (const f of ["FETCH_HEAD", "HEAD"]) {
    try {
      return fs.statSync(path.join(mirror, f)).mtimeMs;
    } catch {
      /* next */
    }
  }
  return 0;
}

function userMirrors(userId: string): string[] {
  const root = path.join(mirrorsRoot(), userId);
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(".git")).map((n) => path.join(root, n));
}

const MB = 1024 * 1024;

/**
 * Keep the user's mirrors under the cap, right after `mirror` was fetched
 * (caller holds its lock): evict the user's other unused, idle mirrors, least
 * recently fetched first. If that isn't enough, the checkout is refused — and
 * `mirror` itself removed when nothing else uses it — with the reason.
 */
async function enforceMirrorQuota(userId: string, mirror: string): Promise<void> {
  const quota = mirrorQuotaBytes();
  if (!Number.isFinite(quota)) return;
  const sizes = new Map<string, number>();
  for (const m of userMirrors(userId)) sizes.set(m, await dirBytes(m));
  let total = [...sizes.values()].reduce((a, b) => a + b, 0);
  if (total <= quota) return;
  const used = await mirrorsInUse(userId);
  const candidates = [...sizes.keys()].filter((m) => m !== mirror && !used.has(realpathOr(m))).sort((a, b) => lastFetched(a) - lastFetched(b));
  for (const m of candidates) {
    if (total <= quota) break;
    // Only a mirror no one is working on right now: taking a free lock can't deadlock.
    if (locks.has(m)) continue;
    if (await withMirror(m, () => evictIfUnused(userId, m)).catch(() => false)) total -= sizes.get(m) ?? 0;
  }
  if (total <= quota) return;
  const own = sizes.get(mirror) ?? 0;
  await evictIfUnused(userId, mirror, used).catch(() => false);
  const limit = Math.round(quota / MB);
  throw new Error(own > quota
    ? `this repository is too large for cloud runs (${Math.round(own / MB)} MB; the limit is ${limit} MB)`
    : `your cached repositories for cloud runs use ${Math.round(total / MB)} MB, over the ${limit} MB limit; delete cloud sessions you've finished with to free space`);
}

/**
 * After a session's workspace is gone (session deleted): remove the user's
 * mirror of `url` if no other workspace uses it. Best-effort.
 */
export async function releaseMirror(userId: string, url: string): Promise<void> {
  const mirror = mirrorDir(userId, url);
  if (!fs.existsSync(mirror)) return;
  await withMirror(mirror, () => evictIfUnused(userId, mirror)).catch(() => undefined);
}

/** Temporary packs older than this are leftovers at the boot sweep (no fetch outlives its 3 min timeout). */
const STALE_TMP_PACK_MS = 60 * 60_000;

/**
 * Boot-sweep step for one user's mirrors (after the run directories were
 * swept): forget worktrees that went away, drop leftover temporary packs, and
 * remove mirrors no workspace uses any more. Returns the removed mirrors.
 */
export async function sweepMirrors(userId: string): Promise<string[]> {
  const removed: string[] = [];
  const used = await mirrorsInUse(userId);
  for (const m of userMirrors(userId)) {
    await withMirror(m, async () => {
      if (await evictIfUnused(userId, m, used)) {
        removed.push(m);
        return;
      }
      await git(m, ["worktree", "prune"]).catch(() => undefined);
      for (const f of await tmpPackFiles(m)) {
        const age = Date.now() - ((await fs.promises.stat(f).catch(() => undefined))?.mtimeMs ?? Date.now());
        if (age > STALE_TMP_PACK_MS) await fs.promises.rm(f, { force: true }).catch(() => undefined);
      }
    }).catch(() => undefined);
  }
  await fs.promises.rmdir(path.join(mirrorsRoot(), userId)).catch(() => undefined);
  return removed;
}

/** Remove all of a user's mirrors (account deletion). Best-effort. */
export async function purgeUserMirrors(userId: string): Promise<void> {
  await fs.promises.rm(path.join(mirrorsRoot(), userId), { recursive: true, force: true }).catch(() => undefined);
}
