import fs from "node:fs";
import path from "node:path";

/**
 * The gate scoreboard (agent-first plan, "Metrics"): the numbers each phase
 * gate is judged on, from data the daemon already keeps — no new collection.
 *
 *   npx tsx scripts/metrics.ts [--days 7] [--insiders id1,id2]
 *
 * Reads <CELIADOR_HOME>/data/tasks/<userId>.json (every user's agent tasks).
 * "Active" = at least one task created in the window. Insiders (us) are
 * listed separately and excluded from the outside figures the gates use;
 * pass their user ids with --insiders or CELIADOR_INSIDERS.
 */

interface Task {
  readonly id: string;
  readonly state: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly prUrl?: string;
  readonly issue?: { number: number };
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const days = Number(flag("days") ?? 7);
const insiders = new Set((flag("insiders") ?? process.env.CELIADOR_INSIDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const root = process.env.CELIADOR_HOME ?? process.cwd();
const dir = path.join(root, "data", "tasks");
const since = Date.now() - days * 86_400_000;

interface UserRow {
  userId: string;
  insider: boolean;
  created: number;
  merged: number;
  prOpen: number;
  failed: number;
  /** Merged with no later task on the same issue (a proxy for "merged without a follow-up"). */
  mergedClean: number;
}

const rows: UserRow[] = [];
if (fs.existsSync(dir)) {
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "repo-links.json") continue;
    const userId = file.slice(0, -".json".length);
    let tasks: Task[];
    try {
      tasks = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Task[];
    } catch {
      continue;
    }
    const inWindow = tasks.filter((t) => Date.parse(t.createdAt) >= since);
    if (inWindow.length === 0) continue;
    const mergedTasks = tasks.filter((t) => t.state === "merged" && Date.parse(t.updatedAt) >= since);
    // How many runs each issue took: one = merged without a follow-up run.
    const issueCounts = new Map<string, number>();
    for (const t of tasks) if (t.issue) issueCounts.set(String(t.issue.number), (issueCounts.get(String(t.issue.number)) ?? 0) + 1);
    rows.push({
      userId,
      insider: insiders.has(userId),
      created: inWindow.length,
      merged: mergedTasks.length,
      prOpen: tasks.filter((t) => t.state === "pr-open").length,
      failed: inWindow.filter((t) => t.state === "failed").length,
      mergedClean: mergedTasks.filter((t) => !t.issue || (issueCounts.get(String(t.issue.number)) ?? 1) === 1).length,
    });
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const outside = rows.filter((r) => !r.insider);
const inside = rows.filter((r) => r.insider);
const mergedOutside = outside.reduce((n, r) => n + r.merged, 0);
const mergedCleanOutside = outside.reduce((n, r) => n + r.mergedClean, 0);

console.log(`Celiador gate scoreboard — last ${days} days (${new Date(since).toISOString().slice(0, 10)} → today)`);
console.log("");
console.log(`Outside weekly active users:              ${outside.length}`);
console.log(`Agent PRs merged per active user (median): ${median(outside.map((r) => r.merged))}`);
console.log(`Agent PRs merged (outside, total):         ${mergedOutside}`);
console.log(`Share merged with no follow-up run:        ${mergedOutside ? Math.round((100 * mergedCleanOutside) / mergedOutside) : 0}%`);
console.log(`Insiders active:                           ${inside.length} (${inside.reduce((n, r) => n + r.merged, 0)} merged)`);
console.log("");
console.log("Gates: 1 = 5 merged/week for Stefan · 2 = 10 outside WAU, median 2, 40% clean · 3 = 20 outside WAU, median 3, 50% clean");
console.log("");
if (rows.length) {
  console.log("user                                  who      created merged pr-open failed clean");
  for (const r of rows.sort((a, b) => b.merged - a.merged)) {
    console.log(`${r.userId.padEnd(37)} ${(r.insider ? "insider" : "outside").padEnd(8)} ${String(r.created).padStart(7)} ${String(r.merged).padStart(6)} ${String(r.prOpen).padStart(7)} ${String(r.failed).padStart(6)} ${String(r.mergedClean).padStart(5)}`);
  }
} else {
  console.log("No task activity in the window.");
}
