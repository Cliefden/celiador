import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { sessionStores } from "./instance";
import { sessionBus } from "./bus";
import { notifySession } from "./notify";
import { persistSession } from "./persist";
import type { SessionCommand, SessionEvent, SessionEventInput, SessionState } from "./types";

/** How often to send an SSE heartbeat so proxies/clients keep the stream open. */
const HEARTBEAT_MS = 15000;

/**
 * How long a dropped runner has to reconnect before watchers are told it's gone.
 * The editor reconnects after ~1.5s, so a network blip doesn't turn into a false
 * "Task failed" push.
 */
const RUNNER_GRACE_MS = 10000;

/** Max events per POST /:id/events batch, and max text length per field. */
const MAX_BATCH = 500;
const MAX_TEXT = 200_000;

const STATES = new Set<SessionState>(["idle", "running", "awaiting", "done", "error", "cancelled"]);

const str = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max;
const optStr = (v: unknown, max = MAX_TEXT): boolean => v === undefined || str(v, max);

/**
 * Validate one runner-published event (guards POST /:id/events). Checks the kind
 * AND its payload, so a bad value (e.g. an unknown `state`) can't be stored and
 * later break a strict client decoder (iOS decodes `Session.state` as an enum).
 */
function validRunnerEvent(raw: unknown): raw is SessionEventInput {
  if (!raw || typeof raw !== "object") return false;
  const e = raw as Record<string, unknown>;
  switch (e.kind) {
    case "activity":
    case "delta":
      return str(e.text);
    case "message":
      return (e.role === "user" || e.role === "assistant") && str(e.text);
    case "tool":
      return str(e.callId, 200) && str(e.name, 200);
    case "toolResult":
      return str(e.callId, 200) && typeof e.ok === "boolean";
    case "approval":
      // approvalKind is the tool kind/name (write_file, edit, create, bash, fetch, …).
      // path/title/preview are optional context (bash has no path, say).
      return str(e.requestId, 200) && str(e.approvalKind, 200) && optStr(e.title, 400) && optStr(e.path, 4096) && optStr(e.preview);
    case "question":
      return (
        str(e.requestId, 200) &&
        str(e.prompt) &&
        (e.choices === undefined || (Array.isArray(e.choices) && e.choices.length <= 20 && e.choices.every((c) => str(c, 1000))))
      );
    case "diff":
      return str(e.path, 4096) && str(e.patch);
    case "state":
      return typeof e.state === "string" && STATES.has(e.state as SessionState);
    case "done":
      return true;
    case "error":
      return str(e.message, 10_000);
    default:
      return false;
  }
}

/**
 * The agent-session relay. A *runner* (the editor) publishes events and receives
 * commands; *watchers* (the phone) observe the event log and send commands. The
 * daemon relays only — it neither runs the model nor touches a workspace.
 */
export function sessionRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const stores = sessionStores;

  app.use("*", requireUser);

  /** Append, fan out to watchers, and push to APNs — all best-effort. */
  const publish = (userId: string, sessionId: string, input: SessionEventInput): SessionEvent | undefined => {
    const store = stores.for(userId);
    const event = store.append(sessionId, input);
    if (event) {
      sessionBus.publishEvent(sessionId, event);
      const session = store.get(sessionId);
      if (session) {
        notifySession(userId, session, event).catch((err) =>
          console.error("[notify] push failed:", err instanceof Error ? err.message : err)
        );
        persistSession(userId, session, event); // durable mirror → Supabase (no-op if unconfigured; serialized, never throws)
      }
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
    if (typeof text !== "string" || !text.trim()) return c.json({ error: "text is required" }, 400);
    if (text.length > 50_000) return c.json({ error: "text too long" }, 413);
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
    if (typeof text !== "string" || !text.trim()) return c.json({ error: "text is required" }, 400);
    if (text.length > 50_000) return c.json({ error: "text too long" }, 413);
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

      const detach = sessionBus.attachRunner(session.id, send, () => close());
      store.setRunnerConnected(session.id, true);

      const heartbeat = setInterval(() => {
        void serial(() => stream.writeSSE({ event: "ping", data: "" })).catch(() => close());
      }, HEARTBEAT_MS);

      c.req.raw.signal.addEventListener("abort", close);

      await closed;
      clearInterval(heartbeat);
      // Replaced by a newer runner stream → that one owns the session now; stay quiet.
      if (!detach()) return;
      // Give the runner a moment to reconnect before declaring it gone.
      setTimeout(() => {
        if (sessionBus.hasRunner(session.id)) return;
        store.setRunnerConnected(session.id, false);
        // If the runner vanished mid-run, unstick any watchers.
        const current = store.get(session.id);
        if (current && (current.state === "running" || current.state === "awaiting")) {
          publish(userId, session.id, { kind: "error", message: "The editor disconnected." });
          publish(userId, session.id, { kind: "state", state: "error" });
        }
      }, RUNNER_GRACE_MS).unref?.();
    });
  });

  app.post("/:id/events", async (c) => {
    const userId = c.get("user").userId;
    const session = stores.for(userId).get(c.req.param("id"));
    if (!session) return c.json({ error: "not found" }, 404);
    const body = await c.req.json().catch(() => null);
    const inputs: unknown[] = Array.isArray(body) ? body : body ? [body] : [];
    if (inputs.length === 0) return c.json({ error: "no events" }, 400);
    if (inputs.length > MAX_BATCH) return c.json({ error: "too many events" }, 413);
    // Validate the whole batch first so a bad event can't leave it half-applied.
    if (!inputs.every(validRunnerEvent)) return c.json({ error: "bad event" }, 400);

    let lastSeq = session.lastSeq;
    for (const input of inputs as SessionEventInput[]) {
      const event = publish(userId, session.id, input);
      if (event) lastSeq = event.seq;
    }
    return c.json({ ok: true, lastSeq });
  });

  /**
   * Shared approve/reject/answer path: idempotent resolve → relay to runner.
   * `pending` is in-memory, so after a daemon restart a still-"awaiting" session
   * is accepted too (the runner ignores requestIds it isn't waiting on).
   */
  function resolve(c: Context<AppEnv>, sessionId: string, requestId: string, command: SessionCommand) {
    if (!sessionBus.hasRunner(sessionId)) return c.json({ error: "runner offline" }, 409);
    const awaiting = stores.for(c.get("user").userId).get(sessionId)?.state === "awaiting";
    if (!sessionBus.resolvePending(sessionId, requestId) && !awaiting) {
      return c.json({ error: "already resolved" }, 409);
    }
    sessionBus.sendCommand(sessionId, command);
    return c.json({ ok: true });
  }

  return app;
}
