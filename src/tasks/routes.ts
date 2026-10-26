import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { sessionBus } from "../sessions/bus";
import { sessionStores } from "../sessions/instance";
import { publishSessionEvent } from "../sessions/publish";
import type { FsResult } from "../sessions/types";
import { dispatchTasks, taskConcurrency, taskStores } from "./dispatch";
import { onTaskChange, publishTaskChange } from "./events";
import { mergeViaApp, postTaskComments, refreshPullRequest, refreshStalePullRequests } from "./pulls";
import { prNumberFromUrl, publicTask, TERMINAL_STATES, type Task, type TaskIssue, type TaskPullRequest, type TaskRepo, type TaskState } from "./store";

const HEARTBEAT_MS = 25_000;
/** A merge relayed to the editor talks to GitHub — the same leash as the session merge route. */
const MERGE_TIMEOUT_MS = 90_000;

/** `https://github.com/<owner>/<name>(.git)` → a TaskRepo; other hosts are refused in v1. */
function parseRepo(url: unknown): TaskRepo | undefined {
  if (typeof url !== "string" || url.length > 2048) return undefined;
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  const owner = m?.[1], name = m?.[2];
  if (!owner || !name) return undefined;
  return { owner, name, url: `https://github.com/${owner}/${name}.git` };
}

/** `{number, title, url}` where url is `https://github.com/<repo owner>/<repo name>/issues/<number>`. */
function parseIssue(raw: unknown, repo: TaskRepo): TaskIssue | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { number, title, url } = raw as Record<string, unknown>;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0 || number > 1e9) return undefined;
  if (typeof title !== "string" || !title.trim() || title.length > 400) return undefined;
  if (typeof url !== "string" || url.length > 2048) return undefined;
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?$/.exec(url.trim());
  if (!m || m[1]!.toLowerCase() !== repo.owner.toLowerCase() || m[2]!.toLowerCase() !== repo.name.toLowerCase() || Number(m[3]) !== number) {
    return undefined;
  }
  return { number, title: title.trim(), url: url.trim().replace(/\/$/, "") };
}

/** A non-negative integer count, or undefined. */
const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : undefined);

/** The editor's computer name: one line, ≤200 chars; anything else is ignored. */
function parseMachine(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200);
  return s || undefined;
}

/**
 * The pull request after an editor report: its `pr` numbers (each validated;
 * a bad one is dropped, not fatal) over what the daemon already had. A report
 * for a different PR number starts fresh. Checks/mergeable are only GitHub's
 * to say, so they carry over (or start "unknown").
 */
function reportedPr(task: Task, prUrl: string | undefined, raw: unknown): TaskPullRequest | undefined {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const url = prUrl ?? task.prUrl;
  const number = count(r.number) || prNumberFromUrl(url) || task.pr?.number;
  if (!number || !url) return task.pr;
  const prev = task.pr?.number === number ? task.pr : undefined;
  return {
    number,
    url,
    additions: count(r.additions) ?? prev?.additions,
    deletions: count(r.deletions) ?? prev?.deletions,
    changedFiles: count(r.changedFiles) ?? prev?.changedFiles,
    checks: prev?.checks ?? "unknown",
    mergeable: prev?.mergeable,
    updatedAt: new Date().toISOString(),
  };
}

/** What the editor may report about a task it runs. */
const EDITOR_STATES = new Set<TaskState>(["running", "pr-open", "merged", "failed"]);

/**
 * The agent task queue (`/api/tasks`). The phone lists, creates and cancels;
 * the editor reports progress on tasks it was handed; both link the repos
 * whose GitHub issues should become tasks, merge a task's pull request and
 * send a run back with a follow-up.
 */
export function taskRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  app.get("/", (c) => {
    const userId = c.get("user").userId;
    const tasks = taskStores.for(userId).list();
    // Ready-to-merge cards show checks and size: refresh stale ones in the background.
    refreshStalePullRequests(userId, tasks);
    return c.json({ tasks: tasks.map(publicTask), concurrency: taskConcurrency(), repos: taskStores.links.forUser(userId) });
  });

  // Live changes for the phone's queue.
  app.get("/stream", (c) => {
    const userId = c.get("user").userId;
    return streamSSE(c, async (stream) => {
      let chain: Promise<unknown> = Promise.resolve();
      let close: () => void = () => {};
      const closed = new Promise<void>((resolve) => (close = resolve));
      const unsubscribe = onTaskChange(userId, (task) => {
        chain = chain.then(() => stream.writeSSE({ event: "task", data: JSON.stringify(task) })).catch(() => close());
      });
      const heartbeat = setInterval(() => {
        chain = chain.then(() => stream.writeSSE({ event: "ping", data: "" })).catch(() => close());
      }, HEARTBEAT_MS);
      c.req.raw.signal.addEventListener("abort", close);
      await closed;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // A task by hand: phone "Run on a repo…" (repo + title + details), or the
  // editor's "Run an issue…" picker (repo + issue; details = the issue body).
  app.post("/", async (c) => {
    const userId = c.get("user").userId;
    const body = (await c.req.json().catch(() => null)) as { remoteUrl?: unknown; title?: unknown; details?: unknown; issue?: unknown } | null;
    const repo = parseRepo(body?.remoteUrl);
    if (!repo) return c.json({ error: "remoteUrl (a github.com https URL) and title are required" }, 400);
    const issue = body?.issue === undefined ? undefined : parseIssue(body.issue, repo);
    if (body?.issue !== undefined && !issue) {
      return c.json({ error: "issue must be {number, title, url} with url https://github.com/<owner>/<repo>/issues/<number> of the same repo" }, 400);
    }
    const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : issue?.title ?? "";
    if (!title || title.length > 400) return c.json({ error: "remoteUrl (a github.com https URL) and title are required" }, 400);
    const details = typeof body?.details === "string" ? body.details.slice(0, 20_000) : "";
    const store = taskStores.for(userId);
    if (issue) {
      const existing = store.openForIssue(repo, issue.number);
      if (existing) return c.json({ task: publicTask(existing), deduped: true });
    }
    const task = store.create({ repo, issue, title, body: details, source: "manual" });
    publishTaskChange(userId, task);
    dispatchTasks(userId);
    return c.json({ task: publicTask(store.get(task.id)!) }, 201);
  });

  app.post("/:id/cancel", (c) => {
    const userId = c.get("user").userId;
    const store = taskStores.for(userId);
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "not found" }, 404);
    if (TERMINAL_STATES.has(task.state)) return c.json({ error: "already finished" }, 409);
    const updated = store.update(task.id, { state: "cancelled" })!;
    publishTaskChange(userId, updated);
    dispatchTasks(userId);
    return c.json({ task: publicTask(updated) });
  });

  // Editor: progress on a task it was handed (running → pr-open | failed; merged
  // later). `running` may follow `pr-open` (a follow-up turn) and `pr-open` may be
  // re-sent after it pushes more commits; both are idempotent.
  app.post("/:id/status", async (c) => {
    const userId = c.get("user").userId;
    const store = taskStores.for(userId);
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as
      | { state?: unknown; sessionId?: unknown; prUrl?: unknown; error?: unknown; machine?: unknown; pr?: unknown }
      | null;
    const state = body?.state as TaskState;
    if (!EDITOR_STATES.has(state)) return c.json({ error: "state must be running, pr-open, merged or failed" }, 400);
    if (task.state === "cancelled") return c.json({ error: "cancelled" }, 409);
    if (task.state === "merged" && state !== "merged") return c.json({ error: "already merged" }, 409);
    const prUrl = typeof body?.prUrl === "string" && /^https:\/\//.test(body.prUrl) ? body.prUrl.slice(0, 2048) : undefined;
    if (state === "pr-open" && !prUrl && !task.prUrl) return c.json({ error: "pr-open needs prUrl" }, 400);
    const machine = parseMachine(body?.machine);
    const pr = state === "pr-open" || prUrl || body?.pr !== undefined ? reportedPr(task, prUrl, body?.pr) : undefined;
    const updated = store.update(task.id, {
      state,
      ...(typeof body?.sessionId === "string" ? { sessionId: body.sessionId.slice(0, 200) } : {}),
      ...(prUrl ? { prUrl } : {}),
      ...(typeof body?.error === "string" ? { error: body.error.slice(0, 2000) } : {}),
      ...(machine ? { machine } : {}),
      ...(pr ? { pr } : {}),
    })!;
    publishTaskChange(userId, updated);
    postTaskComments(userId, updated.id);
    if (state === "pr-open") void refreshPullRequest(userId, updated.id);
    if (TERMINAL_STATES.has(state)) dispatchTasks(userId);
    return c.json({ task: publicTask(updated) });
  });

  // Merge the task's pull request ("Merge" on a Ready-to-merge card): as the
  // GitHub App when it's installed on the repo, else through the editor that
  // ran it (git.merge with the task's branch as head — works after the run).
  app.post("/:id/merge", async (c) => {
    const userId = c.get("user").userId;
    const store = taskStores.for(userId);
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "not found" }, 404);
    const { method } = ((await c.req.json().catch(() => ({}))) ?? {}) as { method?: unknown };
    if (method !== undefined && method !== "merge" && method !== "squash" && method !== "rebase") return c.json({ error: "bad method" }, 400);
    if (task.state === "merged") return c.json({ error: "already merged" }, 409);
    if (task.state !== "pr-open") return c.json({ error: "the task has no open pull request" }, 409);

    let result: { sha?: string; url: string } | undefined;
    const viaApp = await mergeViaApp(userId, task.id, method).catch(() => null);
    if (viaApp && !viaApp.merged) return c.json({ error: viaApp.error }, 409);
    if (viaApp?.merged) result = { sha: viaApp.sha, url: viaApp.url };

    if (!result) {
      const session = task.sessionId ? sessionStores.for(userId).get(task.sessionId) : undefined;
      if (!session || session.runner !== "editor" || !sessionBus.hasRunner(session.id)) {
        return c.json({ error: "editor offline and the GitHub App isn't installed on this repo" }, 409);
      }
      let reply: FsResult;
      try {
        reply = await sessionBus.requestFs(session.id, { kind: "git.merge", requestId: randomUUID(), method, head: task.branch }, MERGE_TIMEOUT_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "timeout") return c.json({ error: "the editor didn't respond" }, 504);
        if (msg === "runner offline") return c.json({ error: "editor offline and the GitHub App isn't installed on this repo" }, 409);
        return c.json({ error: msg }, 502);
      }
      if (!reply.ok || reply.merged !== true) return c.json({ error: reply.error ?? "the pull request was not merged" }, 409);
      result = { sha: reply.sha, url: reply.url ?? task.pr?.url ?? task.prUrl ?? "" };
    }

    const updated = store.update(task.id, { state: "merged" });
    if (updated) publishTaskChange(userId, updated);
    dispatchTasks(userId);
    return c.json({ ok: true, merged: true, sha: result.sha, url: result.url });
  });

  // "Send back…": a follow-up instruction to the run's linked session, the same
  // way the session message route does it (logged as the user turn, then relayed).
  app.post("/:id/followup", async (c) => {
    const userId = c.get("user").userId;
    const task = taskStores.for(userId).get(c.req.param("id"));
    if (!task) return c.json({ error: "not found" }, 404);
    const { text } = ((await c.req.json().catch(() => ({}))) ?? {}) as { text?: unknown };
    if (typeof text !== "string" || !text.trim()) return c.json({ error: "text is required" }, 400);
    if (text.length > 50_000) return c.json({ error: "text too long" }, 413);
    if (task.state === "merged" || task.state === "cancelled") return c.json({ error: `the task is ${task.state}` }, 409);
    const session = task.sessionId ? sessionStores.for(userId).get(task.sessionId) : undefined;
    if (!session) return c.json({ error: "the task has no session yet" }, 409);
    if (!sessionBus.hasRunner(session.id)) return c.json({ error: "editor offline" }, 409);
    publishSessionEvent(userId, session.id, { kind: "message", role: "user", text: text.trim() });
    sessionBus.sendCommand(session.id, { kind: "instruct", text: text.trim() });
    return c.json({ ok: true });
  });

  // Repos whose GitHub issues become tasks for this user.
  app.post("/repos", async (c) => {
    const userId = c.get("user").userId;
    const body = (await c.req.json().catch(() => null)) as { remoteUrl?: unknown } | null;
    const repo = parseRepo(body?.remoteUrl);
    if (!repo) return c.json({ error: "remoteUrl (a github.com https URL) is required" }, 400);
    if (!taskStores.links.link(userId, repo.url)) return c.json({ error: "this repo is linked to another account" }, 409);
    return c.json({ repos: taskStores.links.forUser(userId) });
  });

  app.delete("/repos", async (c) => {
    const userId = c.get("user").userId;
    const body = (await c.req.json().catch(() => null)) as { remoteUrl?: unknown } | null;
    const repo = parseRepo(body?.remoteUrl);
    if (!repo) return c.json({ error: "remoteUrl is required" }, 400);
    taskStores.links.unlink(userId, repo.url);
    return c.json({ repos: taskStores.links.forUser(userId) });
  });

  return app;
}
