import crypto from "node:crypto";
import type { Context } from "hono";
import type { AppEnv } from "../auth";
import { appRequest, githubApp, reactToComment } from "../github/app";
import { sessionBus } from "../sessions/bus";
import { checksFailed, type CiFailure } from "./ci";
import { dispatchTasks, taskStores } from "./dispatch";
import { publishTaskChange } from "./events";
import { refreshPullRequest } from "./pulls";
import { repoKey, type Task, type TaskRepo } from "./store";

/**
 * GitHub webhook → agent tasks. A repo (or, later, the Celiador GitHub App)
 * sends `issues` and `issue_comment` events here; two of them queue a task for
 * the user the repo is linked to:
 *
 * - an issue gets the `celiador` label (labelling needs triage access already);
 * - a comment containing `@celiador` from an OWNER, MEMBER or COLLABORATOR —
 *   anyone can comment on a public repo, so outsiders are ignored.
 *
 * `pull_request` (opened / new commits / merged) and CI events (`check_suite`,
 * `check_run`, `status`) on a task's branch keep its PR card current; a failed
 * check suite / run becomes a fix follow-up (tasks/ci.ts).
 *
 * With the Celiador GitHub App, the issue is also where the run is answered: a
 * collaborator's comment on an issue whose task is waiting on a question or an
 * approval is relayed to the run (a number picks a choice; approve / deny decide)
 * and acknowledged with a 👍 reaction.
 *
 * Signed with CELIADOR_GITHUB_WEBHOOK_SECRET (X-Hub-Signature-256); without the
 * secret the endpoint refuses everything. No user auth: GitHub sends none.
 */

export const TRIGGER_LABEL = "celiador";
const MENTION = /(^|\s)@celiador\b/i;
const TRUSTED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** Constant-time check of GitHub's `sha256=<hex>` signature over the raw body. */
export function validSignature(secret: string, body: string, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(body).digest("hex"));
  const actual = Buffer.from(header.slice("sha256=".length));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

interface GhRepository { name?: string; owner?: { login?: string }; clone_url?: string }
interface GhIssue { number?: number; title?: string; body?: string | null; html_url?: string; pull_request?: unknown }
interface GhPayload {
  action?: string;
  repository?: GhRepository;
  issue?: GhIssue;
  label?: { name?: string };
  comment?: { id?: number; body?: string; author_association?: string };
  pull_request?: { number?: number; merged?: boolean; html_url?: string; head?: { ref?: string } };
  check_suite?: { id?: number; head_branch?: string | null; head_sha?: string; conclusion?: string | null; pull_requests?: GhPullRef[] };
  check_run?: { name?: string; head_sha?: string; conclusion?: string | null; details_url?: string | null; html_url?: string | null; check_suite?: { head_branch?: string | null }; pull_requests?: GhPullRef[] };
  /** `status` events: the branches whose head is the commit. */
  branches?: Array<{ name?: string }>;
}
interface GhPullRef { number?: number; head?: { ref?: string } }

/** Check conclusions the agent is asked to fix (others — cancelled, skipped, neutral — are not its doing). */
const FIXABLE = new Set(["failure", "timed_out"]);
/** An approval answer from the issue: approve / yes / ok, or deny / no. */
const DECISION = /^\s*(approve|deny|yes|no|ok)\b/i;
/** A bare number picks a choice. */
const CHOICE = /^\s*#?(\d{1,2})\s*[.)]?\s*$/;

/** CI and pull-request events that change what a task's PR card shows. */
const PR_REFRESH_ACTIONS = new Set(["opened", "synchronize", "reopened", "edited", "ready_for_review"]);

function repoOf(r: GhRepository | undefined): TaskRepo | undefined {
  if (!r?.name || !r.owner?.login || !r.clone_url || !/^https:\/\//.test(r.clone_url)) return undefined;
  return { owner: r.owner.login, name: r.name, url: r.clone_url };
}

/** What a webhook delivery asks for: a task source, or why it is ignored. Pure; exported for tests. */
export function triggerOf(event: string, p: GhPayload): { source: "issue-label" | "issue-comment" } | { ignore: string } {
  if (event === "issues" && p.action === "labeled") {
    return p.label?.name?.toLowerCase() === TRIGGER_LABEL ? { source: "issue-label" } : { ignore: "another label" };
  }
  if (event === "issue_comment" && p.action === "created") {
    if (p.issue?.pull_request) return { ignore: "comment on a pull request" };
    if (!MENTION.test(p.comment?.body ?? "")) return { ignore: "no @celiador mention" };
    if (!TRUSTED_AUTHORS.has(p.comment?.author_association ?? "")) return { ignore: "commenter is not a collaborator" };
    return { source: "issue-comment" };
  }
  return { ignore: `event ${event}/${p.action ?? "-"}` };
}

export async function githubWebhook(c: Context<AppEnv>): Promise<Response> {
  // Two senders share this endpoint: the per-repo webhooks (CELIADOR_GITHUB_WEBHOOK_SECRET)
  // and the Celiador GitHub App (its own secret, stored at setup). Either signature is good.
  const secrets = [process.env.CELIADOR_GITHUB_WEBHOOK_SECRET, githubApp()?.webhookSecret].filter((s): s is string => !!s);
  if (secrets.length === 0) return c.json({ error: "webhook not configured" }, 503);
  const body = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");
  if (!secrets.some((secret) => validSignature(secret, body, signature))) {
    return c.json({ error: "bad signature" }, 401);
  }
  const event = c.req.header("x-github-event") ?? "";
  if (event === "ping") return c.json({ ok: true, pong: true });

  let payload: GhPayload;
  try {
    payload = JSON.parse(body) as GhPayload;
  } catch {
    return c.json({ error: "bad payload" }, 400);
  }
  if (event === "pull_request") return pullRequestEvent(c, payload);
  if (event === "check_suite" || event === "check_run" || event === "status") return ciEvent(c, event, payload);
  if (event === "issue_comment" && payload.action === "created" && !payload.issue?.pull_request) {
    const answered = answerFromIssue(payload);
    if (answered) return c.json(answered);
  }
  const trigger = triggerOf(event, payload);
  if ("ignore" in trigger) return c.json({ ok: true, ignored: trigger.ignore });

  const repo = repoOf(payload.repository);
  const issue = payload.issue;
  if (!repo || typeof issue?.number !== "number" || !issue.title || !issue.html_url) {
    return c.json({ ok: true, ignored: "incomplete payload" });
  }
  const userId = taskStores.links.owner(repo.url);
  if (!userId) return c.json({ ok: true, ignored: "repo is not linked to a Celiador account" });

  const store = taskStores.for(userId);
  const existing = store.openForIssue(repo, issue.number);
  if (existing) return c.json({ ok: true, ignored: "already queued", taskId: existing.id });

  const task = store.create({
    repo,
    issue: { number: issue.number, title: issue.title, url: issue.html_url },
    title: issue.title,
    body: issue.body ?? "",
    source: trigger.source,
  });
  publishTaskChange(userId, task);
  dispatchTasks(userId);
  return c.json({ ok: true, taskId: task.id, state: store.get(task.id)?.state }, 201);
}

/**
 * A pull request merged on GitHub itself (the web UI, a teammate, anywhere but
 * the phone) still counts: the task whose branch it is moves to `merged`, so the
 * north-star number is right however the PR was merged.
 */
function pullRequestEvent(c: Context<AppEnv>, p: GhPayload): Response {
  // Opened / new commits / reopened: refresh the task's PR card (size, checks, mergeable).
  if (PR_REFRESH_ACTIONS.has(p.action ?? "")) {
    const head = p.pull_request?.head?.ref;
    const refreshed = refreshForBranches(p.repository, head ? [head] : [], p.pull_request?.number ? [p.pull_request.number] : []);
    return c.json({ ok: true, refreshed });
  }
  if (p.action !== "closed" || p.pull_request?.merged !== true) return c.json({ ok: true, ignored: `pull_request/${p.action ?? "-"}` });
  const repo = repoOf(p.repository);
  const head = p.pull_request.head?.ref;
  if (!repo || !head) return c.json({ ok: true, ignored: "incomplete payload" });
  const userId = taskStores.links.owner(repo.url);
  if (!userId) return c.json({ ok: true, ignored: "repo is not linked to a Celiador account" });
  const store = taskStores.for(userId);
  const task = store.list().find((t) => repoKey(t.repo.url) === repoKey(repo.url) && t.branch === head && t.state !== "merged");
  if (!task) return c.json({ ok: true, ignored: "no task for this branch" });
  const updated = store.update(task.id, { state: "merged", ...(p.pull_request.html_url ? { prUrl: p.pull_request.html_url } : {}) })!;
  publishTaskChange(userId, updated);
  dispatchTasks(userId);
  return c.json({ ok: true, taskId: task.id, state: "merged" });
}

/**
 * A collaborator's comment on an issue whose open task is waiting on the user:
 * relayed to the run as the answer / decision. Undefined when this comment is
 * not that (no open awaiting task) — the caller then treats it as a possible
 * `@celiador` mention, unchanged. Everything else is answered inline.
 */
function answerFromIssue(p: GhPayload): Record<string, unknown> | undefined {
  const repo = repoOf(p.repository);
  const number = p.issue?.number;
  if (!repo || typeof number !== "number") return undefined;
  const userId = taskStores.links.owner(repo.url);
  if (!userId) return undefined;
  const task = taskStores.for(userId).openForIssue(repo, number);
  const awaiting = task?.awaiting;
  if (!task || !awaiting || !task.sessionId) return undefined;
  if (!TRUSTED_AUTHORS.has(p.comment?.author_association ?? "")) return { ok: true, ignored: "commenter is not a collaborator" };
  const body = (p.comment?.body ?? "").trim();
  if (!body) return { ok: true, ignored: "empty comment" };
  if (!sessionBus.hasRunner(task.sessionId)) return { ok: true, ignored: "runner offline", taskId: task.id };

  let answer: "approve" | "reject" | "answer";
  if (awaiting.kind === "permission") {
    const m = DECISION.exec(body);
    if (!m) return { ok: true, ignored: "not an approve / deny reply", taskId: task.id };
    answer = /^(approve|yes|ok)$/i.test(m[1]!) ? "approve" : "reject";
    sessionBus.resolvePending(task.sessionId, awaiting.requestId);
    sessionBus.sendCommand(task.sessionId, { kind: answer, requestId: awaiting.requestId });
  } else {
    const pick = CHOICE.exec(body);
    const index = pick ? Number(pick[1]) - 1 : -1;
    const text = awaiting.choices && index >= 0 && index < awaiting.choices.length ? awaiting.choices[index]! : body.slice(0, 50_000);
    answer = "answer";
    sessionBus.resolvePending(task.sessionId, awaiting.requestId);
    sessionBus.sendCommand(task.sessionId, { kind: "answer", requestId: awaiting.requestId, text });
  }
  // The ack is a reaction, not another comment (the run's own state change follows on the queue).
  if (typeof p.comment?.id === "number") void reactToComment(repo, p.comment.id).catch(() => undefined);
  return { ok: true, taskId: task.id, answered: answer, requestId: awaiting.requestId };
}

/** check_suite / check_run completed, or a commit status: CI on a task's branch moved. */
function ciEvent(c: Context<AppEnv>, event: string, p: GhPayload): Response {
  if (event !== "status" && p.action !== "completed") return c.json({ ok: true, ignored: `${event}/${p.action ?? "-"}` });
  const pulls = (event === "check_suite" ? p.check_suite?.pull_requests : event === "check_run" ? p.check_run?.pull_requests : undefined) ?? [];
  const branches = [
    ...(event === "check_suite" ? [p.check_suite?.head_branch] : []),
    ...(event === "check_run" ? [p.check_run?.check_suite?.head_branch] : []),
    ...(event === "status" ? (p.branches ?? []).map((b) => b.name) : []),
    ...pulls.map((pr) => pr.head?.ref),
  ].filter((b): b is string => typeof b === "string" && b.length > 0);
  const numbers = pulls.map((pr) => pr.number).filter((n): n is number => typeof n === "number");
  const { userId, tasks } = tasksForBranches(p.repository, branches, numbers);
  for (const t of tasks) void refreshPullRequest(userId!, t.id);
  // A failed suite / run on a pr-open task's branch: the agent gets to fix it.
  const conclusion = event === "check_suite" ? p.check_suite?.conclusion : event === "check_run" ? p.check_run?.conclusion : undefined;
  const sha = event === "check_suite" ? p.check_suite?.head_sha : p.check_run?.head_sha;
  const fixing: string[] = [];
  if (userId && FIXABLE.has(String(conclusion)) && typeof sha === "string" && sha) {
    for (const t of tasks) {
      if (t.state !== "pr-open") continue;
      fixing.push(t.id);
      void ciFailureDetails(t, event, p, sha).then((f) => checksFailed(userId, t.id, f)).catch((err) => console.error("[tasks] ci fix failed:", err instanceof Error ? err.message : err));
    }
  }
  return c.json({ ok: true, refreshed: tasks.map((t) => t.id), ...(fixing.length ? { fixing } : {}) });
}

/**
 * Which checks failed and where to read about them. A `check_run` says so
 * itself; a `check_suite` only has an id, so its failed runs are listed via the
 * App (best-effort — without it the fix text names "checks" and the PR).
 */
async function ciFailureDetails(task: Task, event: string, p: GhPayload, sha: string): Promise<CiFailure> {
  const prNumber = (event === "check_suite" ? p.check_suite?.pull_requests : p.check_run?.pull_requests)?.find((pr) => typeof pr.number === "number")?.number ?? task.pr?.number;
  if (event === "check_run") {
    const url = p.check_run?.details_url ?? p.check_run?.html_url;
    return { sha, prNumber, names: p.check_run?.name ? [p.check_run.name] : [], urls: url ? [url] : [] };
  }
  const names: string[] = [];
  const urls: string[] = [];
  if (typeof p.check_suite?.id === "number") {
    const res = await appRequest(task.repo, "GET", `/check-suites/${p.check_suite.id}/check-runs?per_page=50`).catch(() => null);
    const runs = res?.status === 200 && Array.isArray(res.json?.check_runs) ? (res.json.check_runs as Array<{ name?: string; conclusion?: string | null; details_url?: string | null; html_url?: string | null }>) : [];
    for (const run of runs) {
      if (!FIXABLE.has(String(run.conclusion))) continue;
      if (run.name) names.push(run.name);
      const url = run.details_url ?? run.html_url;
      if (url) urls.push(url);
    }
  }
  return { sha, prNumber, names, urls };
}

/** The pr-open / running tasks of a linked repo whose branch or PR number matches (and their owner). */
function tasksForBranches(repository: GhRepository | undefined, branches: string[], numbers: number[]): { userId?: string; tasks: Task[] } {
  const repo = repoOf(repository);
  if (!repo || (branches.length === 0 && numbers.length === 0)) return { tasks: [] };
  const userId = taskStores.links.owner(repo.url);
  if (!userId) return { tasks: [] };
  const key = repoKey(repo.url);
  const tasks = taskStores
    .for(userId)
    .list()
    .filter((t) => repoKey(t.repo.url) === key && (t.state === "pr-open" || t.state === "running") && (branches.includes(t.branch) || (t.pr && numbers.includes(t.pr.number))));
  return { userId, tasks };
}

/**
 * Refresh (in the background — GitHub wants a quick answer) the pr-open tasks
 * of a linked repo whose branch or PR number matches. Returns their ids.
 */
function refreshForBranches(repository: GhRepository | undefined, branches: string[], numbers: number[]): string[] {
  const { userId, tasks } = tasksForBranches(repository, branches, numbers);
  for (const t of tasks) void refreshPullRequest(userId!, t.id);
  return tasks.map((t) => t.id);
}
