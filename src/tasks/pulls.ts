import { appRequest, commentOnIssue, githubApp, PUBLIC_URL } from "../github/app";
import { dispatchTasks, taskStores } from "./dispatch";
import { publishTaskChange } from "./events";
import { prNumberFromUrl, type Task, type TaskChecks, type TaskPullRequest } from "./store";

/**
 * A task's pull request as GitHub sees it (with the Celiador GitHub App): size,
 * mergeability and CI checks for the queue's "Ready to merge" cards, plus the
 * App's issue comments and its merge. Without the App the daemon keeps what the
 * editor reported (checks "unknown") and merges through the editor instead.
 */

/** How stale a pull request may get before a task listing refreshes it. */
export const PR_REFRESH_MS = 60_000;

const inflight = new Map<string, Promise<Task | undefined>>();
/** Last refresh attempt per task, so a failing lookup isn't retried on every listing. */
const attempted = new Map<string, number>();

/** Check-run conclusions that mean CI failed. */
const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"]);

/**
 * Check runs + legacy commit statuses on `sha` → one badge. A part GitHub
 * refuses (403/404: the installation hasn't approved checks/statuses read)
 * is unknown; unknown wins over "passing"/"none", since what it hides could fail.
 */
async function checksFor(task: Task, sha: string): Promise<TaskChecks> {
  const [runs, status] = await Promise.all([
    appRequest(task.repo, "GET", `/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`).catch(() => null),
    appRequest(task.repo, "GET", `/commits/${encodeURIComponent(sha)}/status`).catch(() => null),
  ]);
  let unknown = false, failing = false, pending = false, any = false;
  if (runs?.status === 200 && Array.isArray(runs.json?.check_runs)) {
    for (const run of runs.json.check_runs as Array<{ status?: string; conclusion?: string | null }>) {
      any = true;
      if (run.status !== "completed") pending = true;
      else if (FAILED.has(String(run.conclusion))) failing = true;
    }
  } else unknown = true;
  if (status?.status === 200 && typeof status.json?.state === "string") {
    const count = Number(status.json.total_count ?? (Array.isArray(status.json.statuses) ? status.json.statuses.length : 0));
    if (count > 0) {
      any = true;
      if (status.json.state === "failure" || status.json.state === "error") failing = true;
      else if (status.json.state === "pending") pending = true;
    }
  } else unknown = true;
  if (failing) return "failing";
  if (pending) return "pending";
  if (unknown) return "unknown";
  return any ? "passing" : "none";
}

/** Everything but the refresh time — what decides whether a refresh is news. */
function sameExceptTime(a: TaskPullRequest | undefined, b: TaskPullRequest): boolean {
  if (!a) return false;
  const { updatedAt: _a, ...x } = a;
  const { updatedAt: _b, ...y } = b;
  return JSON.stringify(x) === JSON.stringify(y);
}

/**
 * Re-read a task's pull request from GitHub with the App's installation token:
 * by number (task.pr, or parsed from prUrl), else by head branch. Updates
 * `pr` (+ prUrl), moves the task to `merged` when GitHub says it is, and
 * publishes when anything visible changed. A no-op without the App or when the
 * App isn't installed on the repo. Concurrent calls for one task share a run.
 */
export function refreshPullRequest(userId: string, taskId: string): Promise<Task | undefined> {
  const key = `${userId}:${taskId}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = doRefresh(userId, taskId)
    .catch((err) => {
      console.error("[tasks] PR refresh failed:", err instanceof Error ? err.message : err);
      return undefined;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function doRefresh(userId: string, taskId: string): Promise<Task | undefined> {
  if (!githubApp()) return undefined;
  const store = taskStores.for(userId);
  const task = store.get(taskId);
  if (!task) return undefined;
  attempted.set(`${userId}:${taskId}`, Date.now());
  const number = task.pr?.number ?? prNumberFromUrl(task.prUrl);
  let pull: any;
  if (number) {
    const res = await appRequest(task.repo, "GET", `/pulls/${number}`);
    if (res?.status !== 200) return undefined;
    pull = res.json;
  } else {
    const head = encodeURIComponent(`${task.repo.owner}:${task.branch}`);
    const res = await appRequest(task.repo, "GET", `/pulls?head=${head}&state=all&per_page=5`);
    if (res?.status !== 200 || !Array.isArray(res.json) || res.json.length === 0) return undefined;
    pull = res.json[0];
  }
  if (typeof pull?.number !== "number" || typeof pull.html_url !== "string") return undefined;
  const sha = typeof pull.head?.sha === "string" ? pull.head.sha : undefined;
  const checks = sha ? await checksFor(task, sha) : "unknown";
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);
  const pr: TaskPullRequest = {
    number: pull.number,
    url: pull.html_url,
    additions: int(pull.additions) ?? task.pr?.additions,
    deletions: int(pull.deletions) ?? task.pr?.deletions,
    changedFiles: int(pull.changed_files) ?? task.pr?.changedFiles,
    checks,
    // null = GitHub is still computing it; keep the last answer rather than flapping.
    mergeable: typeof pull.mergeable === "boolean" ? pull.mergeable : task.pr?.mergeable,
    updatedAt: new Date().toISOString(),
  };
  const current = store.get(taskId);
  if (!current) return undefined;
  const merged = pull.merged === true && current.state !== "merged";
  const changed = merged || !sameExceptTime(current.pr, pr) || current.prUrl !== pr.url;
  const updated = store.update(taskId, { pr, prUrl: pr.url, ...(merged ? { state: "merged" as const } : {}) });
  if (updated && changed) publishTaskChange(userId, updated);
  if (merged) dispatchTasks(userId);
  return updated;
}

/** Fire-and-forget refresh of pr-open tasks whose pull request is older than PR_REFRESH_MS. */
export function refreshStalePullRequests(userId: string, tasks: Task[]): void {
  if (!githubApp()) return;
  const now = Date.now();
  for (const t of tasks) {
    if (t.state !== "pr-open") continue;
    const seen = t.pr ? Date.parse(t.pr.updatedAt) : 0;
    const tried = attempted.get(`${userId}:${t.id}`) ?? 0;
    if (now - Math.max(seen || 0, tried) < PR_REFRESH_MS) continue;
    void refreshPullRequest(userId, t.id);
  }
}

/**
 * Merge a task's pull request as the App. `null` = the App can't do it here
 * (not set up / not installed / not permitted) and the caller should try the
 * editor; otherwise the merge result or GitHub's reason it refused.
 */
export async function mergeViaApp(
  userId: string,
  taskId: string,
  method?: "merge" | "squash" | "rebase",
): Promise<{ merged: true; sha?: string; url: string } | { merged: false; error: string } | null> {
  if (!githubApp()) return null;
  let task = taskStores.for(userId).get(taskId);
  if (!task) return null;
  let number = task.pr?.number ?? prNumberFromUrl(task.prUrl);
  if (!number) {
    task = (await refreshPullRequest(userId, taskId)) ?? task;
    number = task.pr?.number;
  }
  if (!number) return null;
  const res = await appRequest(task.repo, "PUT", `/pulls/${number}/merge`, method ? { merge_method: method } : {});
  if (!res || res.status === 401 || res.status === 403 || res.status === 404) return null;
  if (res.status === 200 && res.json?.merged === true) {
    return { merged: true, sha: typeof res.json.sha === "string" ? res.json.sha : undefined, url: task.pr?.url ?? task.prUrl ?? "" };
  }
  return { merged: false, error: String(res.json?.message ?? "the pull request was not merged") };
}

/** The repo's default branch as GitHub says, else "main". */
async function defaultBranch(task: Task): Promise<string> {
  const res = await appRequest(task.repo, "GET", "").catch(() => null);
  return typeof res?.json?.default_branch === "string" ? res.json.default_branch : "main";
}

/** The "Picked up" comment body (the editor posts the same text without the App). */
export function pickedUpComment(task: Pick<Task, "id" | "branch" | "machine">, base: string): string {
  const machine = task.machine?.trim() || "a Mac";
  return [
    `**Picked up.** Running on ${machine} in its own worktree, \`${task.branch}\`.`,
    "",
    `I'll open a pull request against \`${base}\` and link it here. Approvals and questions go to the Celiador queue.`,
    "",
    `[Watch the run](${PUBLIC_URL}/api/open/task/${task.id}) · [Open the queue](${PUBLIC_URL}/api/open/queue)`,
  ].join("\n");
}

/**
 * The App's issue comments, each once per task: "Picked up" when the editor
 * first reports `running`, "Pull request opened" when pr-open first arrives.
 * Only for issue tasks with the App set up — the same condition as the
 * `commented` flag sent at dispatch, so the editor skips its own comment.
 */
export function postTaskComments(userId: string, taskId: string): void {
  if (!githubApp()) return;
  const store = taskStores.for(userId);
  const task = store.get(taskId);
  if (!task?.issue) return;
  const issue = task.issue.number;
  if (task.state === "running" && !task.posted?.pickedUp) {
    store.update(task.id, { posted: { ...task.posted, pickedUp: true } });
    void defaultBranch(task)
      .then((base) => commentOnIssue(task.repo, issue, pickedUpComment(task, base)))
      .catch(() => undefined);
  }
  if (task.state === "pr-open" && task.prUrl && !task.posted?.prOpened) {
    store.update(task.id, { posted: { ...task.posted, prOpened: true } });
    void commentOnIssue(task.repo, issue, `Pull request opened: ${task.prUrl}`).catch(() => undefined);
  }
}
