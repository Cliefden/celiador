/**
 * Agent-session relay types.
 *
 * A "session" is a server-side handle on one agent run. A *runner* (today the
 * VS Code editor; tomorrow possibly a server-side worker) executes the agent and
 * publishes what it does as an ordered event log; *watchers* (the phone) observe
 * that log over SSE and steer the run by sending commands. The daemon itself only
 * relays — it neither runs the model nor touches a workspace here.
 */

/** Who created the session. */
export type SessionOrigin = "editor" | "phone";

/** Where the agent actually executes. "server" is reserved for a future runner. */
export type SessionRunner = "editor" | "server";

/**
 * Session lifecycle. The runner is the single writer of this value; watchers only
 * send commands and observe the resulting `state` event echoed back.
 *  - idle:      created, no turn in flight
 *  - running:   a turn is streaming
 *  - awaiting:  blocked on a watcher decision (approval or answer)
 *  - done:      the last turn finished cleanly
 *  - error:     the run failed (see the accompanying `error` event)
 *  - cancelled: a watcher/runner aborted the run
 */
export type SessionState = "idle" | "running" | "awaiting" | "done" | "error" | "cancelled";

/** Durable session metadata (persisted; the event log lives separately). */
export interface Session {
  id: string;
  userId: string;
  title: string;
  origin: SessionOrigin;
  runner: SessionRunner;
  state: SessionState;
  /** Whether a runner currently holds the command channel. */
  runnerConnected: boolean;
  /** Highest event seq assigned so far (monotonic per session). */
  lastSeq: number;
  createdAt: string;
  updatedAt: string;
}

/** A session summary as returned to list/get callers (identical shape today). */
export type SessionSummary = Session;

/**
 * One entry in a session's event log. `seq` is monotonic per session and is used
 * as the SSE `id:` so watchers can resume with `Last-Event-ID`. `at` is an ISO
 * timestamp. The discriminated `kind` carries the payload.
 */
export type SessionEvent =
  | { seq: number; at: string; kind: "activity"; text: string }
  | { seq: number; at: string; kind: "delta"; text: string }
  | { seq: number; at: string; kind: "message"; role: "user" | "assistant"; text: string }
  | { seq: number; at: string; kind: "tool"; callId: string; name: string; input: unknown }
  | { seq: number; at: string; kind: "toolResult"; callId: string; ok: boolean }
  | { seq: number; at: string; kind: "approval"; requestId: string; approvalKind: string; title?: string; path?: string; preview?: string }
  | { seq: number; at: string; kind: "question"; requestId: string; prompt: string; choices?: string[] }
  | { seq: number; at: string; kind: "diff"; path: string; patch: string }
  | { seq: number; at: string; kind: "state"; state: SessionState }
  | { seq: number; at: string; kind: "done" }
  | { seq: number; at: string; kind: "error"; message: string }
  | { seq: number; at: string; kind: "truncated"; from: number };

/** The event body as published by the runner (the daemon assigns seq/at). */
export type SessionEventInput = DistributiveOmit<SessionEvent, "seq" | "at">;

/**
 * A command sent from a watcher, relayed by the daemon to the runner over the
 * command channel. Transient — never persisted to the log.
 *
 * The `fs.*` kinds are request/response: the daemon sends one on behalf of a phone
 * file-browser request and awaits the matching `fs.result` event (by requestId).
 * They never touch the durable event log.
 */
export type SessionCommand =
  | { kind: "instruct"; text: string }
  | { kind: "approve"; requestId: string }
  | { kind: "reject"; requestId: string }
  | { kind: "answer"; requestId: string; text: string }
  | { kind: "cancel" }
  | { kind: "fs.list"; requestId: string; path: string }
  | { kind: "fs.read"; requestId: string; path: string }
  | { kind: "fs.write"; requestId: string; path: string; content: string };

/** Any `fs.*` command the daemon can round-trip to the runner. */
export type FsCommand = Extract<SessionCommand, { kind: "fs.list" | "fs.read" | "fs.write" }>;

/** One entry in a workspace directory listing. */
export interface FsEntry {
  name: string;
  type: "file" | "dir";
  size?: number;
}

/** The runner's answer to an `fs.*` command. */
export interface FsResult {
  ok: boolean;
  entries?: FsEntry[];
  content?: string;
  encoding?: string;
  truncated?: boolean;
  error?: string;
}

/**
 * How a runner reports an `fs.*` result: posted on the event channel but NEVER
 * appended to the log or fanned to watchers — the daemon intercepts it by
 * requestId and resolves the awaiting HTTP request.
 */
export type FsResultInput = { kind: "fs.result"; requestId: string } & FsResult;

/** Omit that distributes over union members (so the `kind` discriminant survives). */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
