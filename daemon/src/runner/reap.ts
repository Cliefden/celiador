import fs from "node:fs";
import path from "node:path";
import { sessionStores } from "../sessions/instance";
import { git, runsRoot } from "./workspace";
import { mirrorsRoot, withMirror } from "./worktrees";

/**
 * How long a run's workspace outlives its session's last activity. Sessions are
 * reaped from their store after 7 days (1 for errored ones), which already
 * drops their workspace here; this bounds a session that stays listed.
 */
const RUN_WORKSPACE_TTL_MS = Number(process.env.CELIADOR_RUN_WORKSPACE_TTL_HOURS || 7 * 24) * 60 * 60 * 1000;

/** Whether a run directory still belongs to a live session (a test seam). */
export type RunLiveness = (userId: string, runId: string) => boolean;

const sessionIsLive: RunLiveness = (userId, runId) => {
  const session = sessionStores.for(userId).get(runId);
  return !!session && Date.now() - Date.parse(session.updatedAt) < RUN_WORKSPACE_TTL_MS;
};

/**
 * Boot-time sweep of data/runs/<userId>/<runId>. A run's workspace is kept after
 * the run on purpose — the phone browses its files, follow-ups continue in it —
 * so only directories whose session is gone (deleted, reaped) or idle past the
 * TTL are removed. A fresh process has no in-flight runs, so nothing here is
 * being written. Afterwards each of the user's mirrors forgets the worktrees
 * that went away (`git worktree prune`). Best-effort; returns what it removed.
 */
export async function reapOrphanRuns(isLive: RunLiveness = sessionIsLive): Promise<string[]> {
  const removed: string[] = [];
  const users = await fs.promises.readdir(runsRoot(), { withFileTypes: true }).catch(() => []);
  for (const user of users) {
    if (!user.isDirectory()) continue;
    const userDir = path.join(runsRoot(), user.name);
    const runs = await fs.promises.readdir(userDir, { withFileTypes: true }).catch(() => []);
    let removedHere = 0;
    for (const run of runs) {
      let live = false;
      try {
        live = run.isDirectory() && isLive(user.name, run.name);
      } catch {
        live = false;
      }
      if (live) continue;
      await fs.promises.rm(path.join(userDir, run.name), { recursive: true, force: true }).catch(() => undefined);
      removed.push(`${user.name}/${run.name}`);
      removedHere++;
    }
    if (removedHere === runs.length) await fs.promises.rmdir(userDir).catch(() => undefined);
    if (removedHere > 0) await pruneMirrors(user.name);
  }
  return removed;
}

async function pruneMirrors(userId: string): Promise<void> {
  const dir = path.join(mirrorsRoot(), userId);
  const mirrors = await fs.promises.readdir(dir).catch(() => [] as string[]);
  for (const m of mirrors) {
    if (!m.endsWith(".git")) continue;
    const mirror = path.join(dir, m);
    await withMirror(mirror, () => git(mirror, ["worktree", "prune"])).catch(() => undefined);
  }
}
