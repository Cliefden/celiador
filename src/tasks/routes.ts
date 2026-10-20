import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { dispatchTasks, taskConcurrency, taskStores } from "./dispatch";
import { onTaskChange, publishTaskChange } from "./events";
import { TERMINAL_STATES, type TaskRepo, type TaskState } from "./store";

const HEARTBEAT_MS = 25_000;

/** `https://github.com/<owner>/<name>(.git)` → a TaskRepo; other hosts are refused in v1. */
function parseRepo(url: unknown): TaskRepo | undefined {
  if (typeof url !== "string" || url.length > 2048) return undefined;
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  const owner = m?.[1], name = m?.[2];
  if (!owner || !name) return undefined;
  return { owner, name, url: `https://github.com/${owner}/${name}.git` };
}

/** What the editor may report about a task it runs. */
const EDITOR_STATES = new Set<TaskState>(["running", "pr-open", "merged", "failed"]);

/**
 * The agent task queue (`/api/tasks`). The phone lists, creates and cancels;
 * the editor reports progress on tasks it was handed; both link the repos
 * whose GitHub issues should become tasks.
 */
export function taskRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  app.get("/", (c) => {
    const userId = c.get("user").userId;
    return c.json({ tasks: taskStores.for(userId).list(), concurrency: taskConcurrency(), repos: taskStores.links.forUser(userId) });
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

  // A task by hand (phone "Run on a repo…"): repo + title (+ details).
  app.post("/", async (c) => {
    const userId = c.get("user").userId;
    const body = (await c.req.json().catch(() => null)) as { remoteUrl?: unknown; title?: unknown; details?: unknown } | null;
    const repo = parseRepo(body?.remoteUrl);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!repo || !title || title.length > 400) return c.json({ error: "remoteUrl (a github.com https URL) and title are required" }, 400);
    const details = typeof body?.details === "string" ? body.details.slice(0, 20_000) : "";
    const store = taskStores.for(userId);
    const task = store.create({ repo, title, body: details, source: "manual" });
    publishTaskChange(userId, task);
    dispatchTasks(userId);
    return c.json({ task: store.get(task.id) }, 201);
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
    return c.json({ task: updated });
  });

  // Editor: progress on a task it was handed (running → pr-open | failed; merged later).
  app.post("/:id/status", async (c) => {
    const userId = c.get("user").userId;
    const store = taskStores.for(userId);
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { state?: unknown; sessionId?: unknown; prUrl?: unknown; error?: unknown } | null;
    const state = body?.state as TaskState;
    if (!EDITOR_STATES.has(state)) return c.json({ error: "state must be running, pr-open, merged or failed" }, 400);
    if (task.state === "cancelled") return c.json({ error: "cancelled" }, 409);
    const prUrl = typeof body?.prUrl === "string" && /^https:\/\//.test(body.prUrl) ? body.prUrl.slice(0, 2048) : undefined;
    if (state === "pr-open" && !prUrl) return c.json({ error: "pr-open needs prUrl" }, 400);
    const updated = store.update(task.id, {
      state,
      ...(typeof body?.sessionId === "string" ? { sessionId: body.sessionId.slice(0, 200) } : {}),
      ...(prUrl ? { prUrl } : {}),
      ...(typeof body?.error === "string" ? { error: body.error.slice(0, 2000) } : {}),
    })!;
    publishTaskChange(userId, updated);
    if (TERMINAL_STATES.has(state)) dispatchTasks(userId);
    return c.json({ task: updated });
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
