import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { ROOT } from "../config";
import { SessionStores } from "./store";
import { sessionBus } from "./bus";
import { notifySession } from "./notify";
import type { SessionCommand, SessionEvent, SessionEventInput } from "./types";

/** How often to send an SSE heartbeat so proxies/clients keep the stream open. */
const HEARTBEAT_MS = 15000;

/** Event kinds a runner is allowed to publish (guards POST /:id/events). */
const RUNNER_EVENT_KINDS = new Set([
  "activity",
  "delta",
  "message",
  "tool",
  "toolResult",
  "approval",
  "question",
  "diff",
  "state",
  "done",
  "error",
]);

/**
 * The agent-session relay. A *runner* (the editor) publishes events and receives
 * commands; *watchers* (the phone) observe the event log and send commands. The
 * daemon relays only — it neither runs the model nor touches a workspace.
 */
export function sessionRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const stores = new SessionStores(ROOT);

  app.use("*", requireUser);

  /** Append, fan out to watchers, and push to APNs — all best-effort. */
  const publish = (userId: string, sessionId: string, input: SessionEventInput): SessionEvent | undefined => {
    const store = stores.for(userId);
    const event = store.append(sessionId, input);
    if (event) {
      sessionBus.publishEvent(sessionId, event);
      const session = store.get(sessionId);
      if (session) void notifySession(userId, session, event);
    }
    return event;
  };

  // ---- Watcher: session CRUD ------------------------------------------------

  app.post("/", async (c) => {
    const { title, origin, runner } = await c.req.json().catch(() => ({}));
    const session = stores.for(c.get("user").userId).create({
      title,
      origin: origin === "phone" ? "phone" : "editor",
      runner: runner === "server" ? "server" : "editor",
    });
    return c.json({ session });
  });

  app.get("/", (c) => c.json({ sessions: stores.for(c.get("user").userId).list() }));

  app.get("/:id", (c) => {
    const session = stores.for(c.get("user").userId).get(c.req.param("id"));
    if (!session) return c.json({ error: "not found" }, 404);
    return c.json({ session });
  });

  app.delete("/:id", (c) => {
    const ok = stores.for(c.get("user").userId).delete(c.req.param("id"));
    return c.json({ ok });
  });

  // ---- Watcher: live event stream ------------------------------------------

  app.get("/:id/events", (c) => {
    const store = stores.for(c.get("user").userId);
    const session = store.get(c.req.param("id"));
    if (!session) return c.json({ error: "not found" }, 404);
    const cursor = Number(c.req.header("last-event-id") ?? c.req.query("cursor") ?? 0) || 0;

    return streamSSE(c, async (stream) => {
      // Serialize every write (replay, live, heartbeat) through one chain so
      // concurrent producers never interleave frames on the wire.
      let chain: Promise<unknown> = Promise.resolve();
      const serial = (fn: () => Promise<unknown>): Promise<unknown> => (chain = chain.then(fn, fn));
      const writeEvent = async (ev: SessionEvent): Promise<void> => {
        await serial(() => stream.writeSSE({ data: JSON.stringify(ev), id: ev.kind === "truncated" ? undefined : String(ev.seq) }));
      };

      // Snapshot replay and subscribe in the same synchronous tick (see bus).
      const { events, truncatedFrom } = store.replay(session.id, cursor);
      const initial: SessionEvent[] = [];
      if (truncatedFrom !== undefined) {
        initial.push({ kind: "truncated", from: truncatedFrom, seq: 0, at: new Date().toISOString() });
      }
      initial.push(...events);

      let close: () => void = () => {};
      const closed = new Promise<void>((resolve) => (close = resolve));
      const unsub = sessionBus.subscribeWatcher(session.id, writeEvent, close, initial);

      const heartbeat = setInterval(() => {
        void serial(() => stream.writeSSE({ event: "ping", data: "" })).catch(() => close());
      }, HEARTBEAT_MS);

      c.req.raw.signal.addEventListener("abort", () => {
        unsub();
        close();
      });

      await closed;
      clearInterval(heartbeat);
      unsub();
    });
  });

  // ---- Watcher: control -----------------------------------------------------

  app.post("/:id/message", async (c) => {
    const userId = c.get("user").userId;
    const session = stores.for(userId).get(c.req.param("id"));
    if (!session) return c.json({ error: "not found" }, 404);
    const { text } = await c.req.json().catch(() => ({}));
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);
    if (!sessionBus.hasRunner(session.id)) return c.json({ error: "runner offline" }, 409);
    // The daemon is the single source of the user turn in the log.
    publish(userId, session.id, { kind: "message", role: "user", text: text.trim() });
    sessionBus.sendCommand(session.id, { kind: "instruct", text: text.trim() });
    return c.json({ ok: true });
  });

  app.post("/:id/approvals/:requestId", async (c) => {
    const session = stores.for(c.get("user").userId).get(c.req.param("id"));
    if (!session) return c.json({ error: "not found" }, 404);
    const { decision } = await c.req.json().catch(() => ({}));
    const kind = decision === "reject" ? "reject" : "approve";
    return resolve(c, session.id, c.req.param("requestId"), { kind, requestId: c.req.param("requestId") });
  });

  app.post("/:id/answers/:requestId", async (c) => {
    const session = stores.for(c.get("user").userId).get(c.req.param("id"));
    if (!session) return c.json({ error: "not found" }, 404);
    const { text } = await c.req.json().catch(() => ({}));
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);
    return resolve(c, session.id, c.req.param("requestId"), { kind: "answer", requestId: c.req.param("requestId"), text: text.trim() });
  });

  app.post("/:id/cancel", (c) => {
    const session = stores.for(c.get("user").userId).get(c.req.param("id"));
    if (!session) return c.json({ error: "not found" }, 404);
    if (!sessionBus.hasRunner(session.id)) return c.json({ error: "runner offline" }, 409);
    sessionBus.sendCommand(session.id, { kind: "cancel" });
    return c.json({ ok: true });
  });

  // ---- Runner: command channel + event publish -----------------------------

  app.get("/:id/commands", (c) => {
    const userId = c.get("user").userId;
    const store = stores.for(userId);
    const session = store.get(c.req.param("id"));
    if (!session) return c.json({ error: "not found" }, 404);

    return streamSSE(c, async (stream) => {
      let chain: Promise<unknown> = Promise.resolve();
      const serial = (fn: () => Promise<unknown>): Promise<unknown> => (chain = chain.then(fn, fn));

      let close: () => void = () => {};
      const closed = new Promise<void>((resolve) => (close = resolve));
      const send = (command: SessionCommand) => {
        void serial(() => stream.writeSSE({ data: JSON.stringify(command) })).catch(() => close());
      };

      const detach = sessionBus.attachRunner(session.id, send);
      store.setRunnerConnected(session.id, true);

      const heartbeat = setInterval(() => {
        void serial(() => stream.writeSSE({ event: "ping", data: "" })).catch(() => close());
      }, HEARTBEAT_MS);

      c.req.raw.signal.addEventListener("abort", close);

      await closed;
      clearInterval(heartbeat);
      detach();
      store.setRunnerConnected(session.id, false);
      // If the runner vanished mid-run, unstick any watchers.
      const current = store.get(session.id);
      if (current && (current.state === "running" || current.state === "awaiting")) {
        publish(userId, session.id, { kind: "error", message: "The editor disconnected." });
        publish(userId, session.id, { kind: "state", state: "error" });
      }
    });
  });

  app.post("/:id/events", async (c) => {
    const userId = c.get("user").userId;
    const session = stores.for(userId).get(c.req.param("id"));
    if (!session) return c.json({ error: "not found" }, 404);
    const body = await c.req.json().catch(() => null);
    const inputs: unknown[] = Array.isArray(body) ? body : body ? [body] : [];
    if (inputs.length === 0) return c.json({ error: "no events" }, 400);

    let lastSeq = session.lastSeq;
    for (const raw of inputs) {
      const input = raw as SessionEventInput;
      if (!input || typeof input !== "object" || !RUNNER_EVENT_KINDS.has((input as { kind: string }).kind)) {
        return c.json({ error: "bad event" }, 400);
      }
      const event = publish(userId, session.id, input);
      if (event) lastSeq = event.seq;
    }
    return c.json({ ok: true, lastSeq });
  });

  /** Shared approve/reject/answer path: idempotent resolve → relay to runner. */
  function resolve(c: Context<AppEnv>, sessionId: string, requestId: string, command: SessionCommand) {
    if (!sessionBus.hasRunner(sessionId)) return c.json({ error: "runner offline" }, 409);
    if (!sessionBus.resolvePending(sessionId, requestId)) return c.json({ error: "already resolved" }, 409);
    sessionBus.sendCommand(sessionId, command);
    return c.json({ ok: true });
  }

  return app;
}
