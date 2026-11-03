import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ROOT } from "../config";

const run = promisify(execFile);

/** Root under which each server run gets its own throwaway workspace. */
export function runsRoot(): string {
  return path.join(ROOT, "data", "runs");
}

/** Per-run workspace directory: data/runs/<userId>/<runId>/repo. */
export function workspaceDir(userId: string, runId: string): string {
  return path.join(runsRoot(), userId, runId, "repo");
}

/** Root of the per-user bare mirrors (worktrees.ts keeps the layout; here for the git helper). */
export function mirrorsRoot(): string {
  return path.join(ROOT, "data", "repos");
}

// ---- Host-side git, safe against an agent-written repository (#78) -----------
//
// Celiador edit (#78). Every git command the daemon runs on the host — in a
// run's worktree or in a user's mirror — goes through `git()` below, because
// the sandboxed agent has written into that tree: the work tree is the agent's
// (its `.git` file, `.gitattributes`, nested repos), and the worktree's own
// metadata dir (HEAD, index, `commondir`, `gitdir`) is mounted read-write into
// the container. What the daemon does about it:
//
// 1. It never discovers the repository. A worktree's git dir and common dir come
//    from a location file the daemon wrote when it made the worktree, outside the
//    workspace (`<runDir>/repo.gitloc.json`, never mounted), and are passed as
//    `--git-dir` / `--work-tree` / GIT_COMMON_DIR — so an agent-written `.git`
//    file or `commondir` pointer can't steer git to a repo the agent made. A
//    workspace without a location file is refused.
// 2. Only daemon-owned config is read. No system or global config
//    (GIT_CONFIG_NOSYSTEM, GIT_CONFIG_GLOBAL=/dev/null). The mirror's own config
//    is daemon-owned: the container mounts it read-only, and before each command
//    it's checked byte-for-byte against the canonical text the daemon writes and
//    rewritten if it differs (a mirror planted before #78, or a mount that wasn't
//    read-only after all). Repo config is the dangerous one — include.path,
//    core.fsmonitor, core.sshCommand, credential.helper, url.*.insteadOf,
//    filter/diff/merge drivers, gpg.program … — and git can't be told to skip it,
//    so the daemon owns it outright rather than blocklisting keys.
// 3. Belt and braces on the command line (`-c`, highest precedence, inherited by
//    any child git): hooks off (core.hooksPath=/dev/null), fsmonitor off, never
//    recurse into submodules (a gitlink's own `.git/config` is the agent's), no
//    signing programs, no `ext::` transport.
// 4. `objects/info/alternates` (which would make host git read objects from any
//    path the agent names) is removed before each command; the daemon never uses it.
// 5. Nested repos: status / diff pass --ignore-submodules=all, and `git add`
//    (which no flag or -c stops from running `git status` inside a gitlink) is
//    kept off gitlink paths with exclude pathspecs (gitAddAll).

const SAFE_CONFIG_ARGS = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "core.untrackedCache=false",
  "-c", "submodule.recurse=false",
  "-c", "diff.ignoreSubmodules=all",
  "-c", "status.submoduleSummary=false",
  "-c", "commit.gpgSign=false",
  "-c", "tag.gpgSign=false",
  "-c", "push.gpgSign=false",
  "-c", "push.recurseSubmodules=no",
  "-c", "fetch.recurseSubmodules=false",
  "-c", "protocol.ext.allow=never",
];

/** Location / config variables a caller's environment must not smuggle in. */
const STRIPPED_ENV = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|CONFIG|CONFIG_.*|EXEC_PATH|EXTERNAL_DIFF|DIFF_OPTS|SSH|SSH_COMMAND|ASKPASS|PROXY_COMMAND|ATTR_SOURCE)$/;

/** The environment every host-side git runs with. */
export function safeGitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!STRIPPED_ENV.test(k)) env[k] = v;
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    ...extra,
  };
}

/**
 * The only config a mirror has: what `git init --bare` needs plus reflogs (the
 * worktrees get them as a normal clone would). Nothing in it can run a program.
 */
export const MIRROR_CONFIG = [
  "[core]",
  "\trepositoryformatversion = 0",
  "\tfilemode = true",
  "\tbare = true",
  "\tlogallrefupdates = true",
  ...(process.platform === "darwin" ? ["\tignorecase = true", "\tprecomposeunicode = true"] : []),
  "",
].join("\n");

/**
 * Put a mirror (common dir) back in the state only the daemon may give it:
 * canonical config, no object alternates. Cheap (a small read; writes only on a
 * mismatch), so it runs before every host-side git command that touches it.
 */
export function enforceMirrorState(commonDir: string): void {
  const config = path.join(commonDir, "config");
  let current: string | undefined;
  try {
    current = fs.readFileSync(config, "utf8");
  } catch {
    current = undefined;
  }
  if (current !== undefined && current !== MIRROR_CONFIG) {
    // Replace, don't edit in place: a symlink planted at `config` is dropped, not followed.
    fs.rmSync(config, { force: true });
    fs.writeFileSync(config, MIRROR_CONFIG, { mode: 0o644 });
  }
  for (const f of ["alternates", "http-alternates"]) fs.rmSync(path.join(commonDir, "objects", "info", f), { force: true });
}

/** Where a worktree's git data really is, as the daemon recorded it. */
export interface IWorktreeLocation {
  /** The worktree's own metadata dir, `<mirror>/worktrees/<id>`. */
  readonly gitDir: string;
  /** The mirror (shared objects, refs, config). */
  readonly commonDir: string;
}

/** The daemon-owned location file of a workspace: a sibling of it, never mounted into the sandbox. */
export function locationFile(dir: string): string {
  return path.join(path.dirname(dir), `${path.basename(dir)}.gitloc.json`);
}

/** Record a worktree's location (worktrees.ts, right after `git worktree add`, before any agent runs). */
export function writeWorktreeLocation(dir: string, loc: IWorktreeLocation): void {
  fs.writeFileSync(locationFile(dir), JSON.stringify({ gitDir: loc.gitDir, commonDir: loc.commonDir }), { mode: 0o600 });
}

/**
 * A workspace's recorded location, validated: the git dir must be a direct
 * child of the common dir's `worktrees/`, and the common dir a mirror under
 * mirrorsRoot(). Undefined when there's no (valid) record.
 */
export function worktreeLocation(dir: string): IWorktreeLocation | undefined {
  let raw: { gitDir?: unknown; commonDir?: unknown };
  try {
    raw = JSON.parse(fs.readFileSync(locationFile(dir), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof raw.gitDir !== "string" || typeof raw.commonDir !== "string") return undefined;
  const commonDir = path.resolve(raw.commonDir);
  const gitDir = path.resolve(raw.gitDir);
  let root: string;
  try {
    root = fs.realpathSync(mirrorsRoot()) + path.sep;
  } catch {
    return undefined;
  }
  if (!commonDir.startsWith(root) || path.dirname(gitDir) !== path.join(commonDir, "worktrees")) return undefined;
  return { gitDir, commonDir };
}

/**
 * Restore the pointers in a worktree's metadata that the agent could have
 * rewritten (its dir is writable in the sandbox): `commondir` and `gitdir`
 * (which the host's `worktree prune` reads), and the workspace's `.git` file,
 * so git inside the next container finds the right repo too. Host git never
 * reads them for its own commands (it gets explicit paths).
 */
function restoreWorktreePointers(dir: string, loc: IWorktreeLocation): void {
  const want: Array<[string, string]> = [
    [path.join(loc.gitDir, "commondir"), `${path.relative(loc.gitDir, loc.commonDir) || "."}\n`],
    [path.join(loc.gitDir, "gitdir"), `${path.join(fs.realpathSync(dir), ".git")}\n`],
    [path.join(dir, ".git"), `gitdir: ${loc.gitDir}\n`],
  ];
  for (const [file, content] of want) {
    let cur: string | undefined;
    try {
      cur = fs.lstatSync(file).isFile() ? fs.readFileSync(file, "utf8") : undefined;
    } catch {
      cur = undefined;
    }
    if (cur === content) continue;
    fs.rmSync(file, { recursive: true, force: true });
    fs.writeFileSync(file, content);
  }
  // Per-worktree config is honoured only with extensions.worktreeConfig, which the canonical config never sets; drop it anyway.
  fs.rmSync(path.join(loc.gitDir, "config.worktree"), { force: true });
}

/**
 * How to invoke git on `dir` safely: a recorded worktree → explicit git dir /
 * work tree / common dir; a mirror → its git dir; a workspace without a record
 * → refused; anything else (not agent-reachable) → as is.
 */
function resolveTarget(dir: string): { pre: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  const abs = path.resolve(dir);
  const loc = worktreeLocation(abs);
  if (loc) {
    enforceMirrorState(loc.commonDir);
    restoreWorktreePointers(abs, loc);
    return { pre: [`--git-dir=${loc.gitDir}`, `--work-tree=${abs}`], cwd: abs, env: { GIT_COMMON_DIR: loc.commonDir } };
  }
  const runs = path.resolve(runsRoot()) + path.sep;
  if (abs.startsWith(runs)) throw new Error("this workspace's git location isn't known to the daemon (it predates #78, or wasn't made by it); start a new session");
  const mirrors = path.resolve(mirrorsRoot()) + path.sep;
  if (abs.startsWith(mirrors) && fs.existsSync(path.join(abs, "HEAD"))) {
    enforceMirrorState(abs);
    return { pre: [`--git-dir=${abs}`], cwd: abs, env: {} };
  }
  return { pre: ["-C", abs], cwd: process.cwd(), env: {} };
}

/**
 * One host-side git command in a workspace or mirror, hardened as described
 * above. `secret` (a token that rides in a URL argument) is scrubbed from any
 * error, so it can't reach a log or a task's `error`. Callers keep pathspecs
 * after `--`.
 */
export async function git(dir: string, args: string[], opts: { timeout?: number; secret?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number } = {}): Promise<string> {
  try {
    const target = resolveTarget(dir);
    const { stdout } = await run("git", [...SAFE_CONFIG_ARGS, ...target.pre, ...args], {
      cwd: target.cwd,
      timeout: opts.timeout ?? 60_000,
      maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
      env: safeGitEnv({ ...opts.env, ...target.env }),
    });
    return stdout;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(opts.secret ? raw.split(opts.secret).join("***") : raw);
  }
}

/**
 * Exclude pathspecs for every gitlink (submodule) entry in the worktree's index.
 * `git add` checks a gitlink for local changes by running `git status` inside
 * it whenever its directory holds a `.git` — and that nested repo, with its own
 * config and attributes, is the agent's (a filter there runs on the host). No
 * `-c` reaches that check for `add` (diff.ignoreSubmodules is porcelain-only),
 * so the daemon keeps `add` away from gitlink paths instead. Reading the index
 * (`ls-files -s`) doesn't recurse. Submodule changes are never staged by the
 * daemon; cloud runs don't support submodules (there's no network to fetch them).
 */
export async function gitlinkExcludes(dir: string): Promise<string[]> {
  const out = await git(dir, ["ls-files", "-s", "-z"], { maxBuffer: 64 * 1024 * 1024 });
  const excludes: string[] = [];
  for (const entry of out.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab > 0 && entry.startsWith("160000 ")) excludes.push(`:(top,literal,exclude)${entry.slice(tab + 1)}`);
  }
  return excludes;
}

/**
 * `git add -A` (or `-A -N`, intent-to-add) in a worktree, optionally limited to
 * `paths`, never touching gitlinks (see gitlinkExcludes). Pathspecs after `--`.
 */
export async function gitAddAll(dir: string, opts: { paths?: readonly string[]; intentToAdd?: boolean; timeout?: number } = {}): Promise<void> {
  const excludes = await gitlinkExcludes(dir);
  const include = opts.paths?.length ? opts.paths.map((p) => `:(top,literal)${p}`) : [":/"];
  await git(dir, ["add", "-A", ...(opts.intentToAdd ? ["-N"] : []), "--", ...include, ...excludes], { timeout: opts.timeout });
}

/** One changed file's patch. */
export interface IFileDiff {
  readonly path: string;
  readonly patch: string;
}

/**
 * Stage everything and return a unified diff per changed file (new files
 * included). Empty when the agent changed nothing.
 */
export async function computeDiffs(dir: string): Promise<IFileDiff[]> {
  await gitAddAll(dir, { timeout: 30_000 });
  const names = await git(dir, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--ignore-submodules=all", "--name-only"], { timeout: 30_000 });
  const files = names.split("\n").map((f) => f.trim()).filter(Boolean);
  const diffs: IFileDiff[] = [];
  for (const file of files) {
    const patch = await git(dir, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--ignore-submodules=all", "--", file], { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
    if (patch.trim()) diffs.push({ path: file, patch });
  }
  return diffs;
}

/** Remove a run's workspace tree (best-effort). */
export async function removeWorkspace(userId: string, runId: string): Promise<void> {
  await fs.promises.rm(path.join(runsRoot(), userId, runId), { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Remove every run workspace. Safe to call at daemon boot: a fresh process has no
 * in-flight runs, so anything under data/runs is an orphan left by a previous crash
 * (normal completion cleans up in `executeServerRun`'s finally). Best-effort.
 */
export async function reapOrphanRuns(): Promise<void> {
  await fs.promises.rm(runsRoot(), { recursive: true, force: true }).catch(() => undefined);
}

/** Remove all of a user's run workspaces (account deletion). Best-effort. */
export async function purgeUserRuns(userId: string): Promise<void> {
  await fs.promises.rm(path.join(runsRoot(), userId), { recursive: true, force: true }).catch(() => undefined);
}
