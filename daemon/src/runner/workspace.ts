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

/** Per-run workspace directory: data/runs/<userId>/<runId>/repo. Throws on an id that isn't one path segment. */
export function workspaceDir(userId: string, runId: string): string {
  return path.join(runDir(userId, runId), "repo");
}

/**
 * One git command in a workspace. `secret` (a token that rides in a URL argument)
 * is scrubbed from any error, so it can't reach a log or a task's `error`.
 */
export async function git(dir: string, args: string[], opts: { timeout?: number; secret?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", dir, ...args], {
      timeout: opts.timeout ?? 60_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env },
    });
    return stdout;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(opts.secret ? raw.split(opts.secret).join("***") : raw);
  }
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
  await run("git", ["-C", dir, "add", "-A"], { timeout: 30_000 });
  const { stdout: names } = await run("git", ["-C", dir, "diff", "--cached", "--name-only"], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  const files = names.split("\n").map((f) => f.trim()).filter(Boolean);
  const diffs: IFileDiff[] = [];
  for (const file of files) {
    const { stdout: patch } = await run("git", ["-C", dir, "diff", "--cached", "--", file], { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
    if (patch.trim()) diffs.push({ path: file, patch });
  }
  return diffs;
}

/** Remove a run's workspace tree (best-effort; an id that isn't one path segment removes nothing). */
export async function removeWorkspace(userId: string, runId: string): Promise<void> {
  let dir: string;
  try {
    dir = runDir(userId, runId);
  } catch {
    return;
  }
  await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
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
  if (!SAFE_SEGMENT.test(userId)) return;
  await fs.promises.rm(path.join(runsRoot(), userId), { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Celiador edit (path confinement): user and run ids become directory names
 * under data/runs, so each must be exactly one plain segment — a daemon-issued
 * UUID, a Supabase user id, or "default". Anything else never reaches the disk.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** data/runs/<userId>/<runId>, asserted to sit directly inside data/runs/<userId>. Throws otherwise. */
export function runDir(userId: string, runId: string): string {
  if (!SAFE_SEGMENT.test(userId) || !SAFE_SEGMENT.test(runId)) throw new Error("bad run id");
  const userRoot = path.resolve(runsRoot(), userId);
  const dir = path.resolve(userRoot, runId);
  if (path.dirname(userRoot) !== path.resolve(runsRoot()) || path.dirname(dir) !== userRoot) throw new Error("bad run id");
  return dir;
}
