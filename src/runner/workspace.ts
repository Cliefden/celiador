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

/**
 * Shallow-clone a public repo into `dir`. Phase 3a is public-repo only (no
 * credentials); private repos + auth come with 3b. Times out so a hanging clone
 * can't wedge a run.
 */
export async function cloneRepo(url: string, branch: string | undefined, dir: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(dir), { recursive: true });
  const args = ["clone", "--depth=1", "--single-branch"];
  if (branch) args.push("--branch", branch);
  args.push(url, dir);
  await run("git", args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
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

/** Remove a run's workspace tree (best-effort). */
export async function removeWorkspace(userId: string, runId: string): Promise<void> {
  await fs.promises.rm(path.join(runsRoot(), userId, runId), { recursive: true, force: true }).catch(() => undefined);
}
