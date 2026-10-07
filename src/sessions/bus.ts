import type { FsCommand, FsResult, SessionCommand, SessionEvent } from "./types";

/**
 * In-process pub/sub for session relay, keyed by sessionId. No external broker —
 * a single daemon process serves both the runner and the watchers of a session.
 *
 * Per session: many *watcher* sinks (phones observing the event log) and at most
 * one *runner* sink (the editor receiving commands). Events fan out to every
 * watcher through its own serialized, bounded write queue; a watcher that can't
 * keep up is dropped and left to reconnect + replay rather than blocking others
 * or the runner.
 */

/** Max events buffered for one slow watcher before it's dropped. */
const MAX_QUEUE = 1000;

type WriteFn = (event: SessionEvent) => Promise<void>;
type CommandFn = (command: SessionCommand) => void;

/** A serialized, bounded write pump for one watcher SSE stream. */
class WriteQueue {
  private queue: SessionEvent[] = [];
  private draining = false;
  private closed = false;

  constructor(private write: WriteFn, private onError: () => void) {}

  push(event: SessionEvent): void {
    if (this.closed) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.fail();
      return;
    }
    this.queue.push(event);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.closed) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.closed) {
        await this.write(this.queue.shift()!);
      }
    } catch {
      this.fail();
    } finally {
      this.draining = false;
    }
  }

  fail(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.onError();
  }
}

interface Runner {
  send: CommandFn;
  /** Close this runner's stream (called when a newer runner replaces it). */
  close: () => void;
}

interface Channel {
  watchers: Set<WriteQueue>;
  runner: Runner | null;
  /** Outstanding approval/question requestIds awaiting a watcher decision. */
  pending: Set<string>;
}

/** Default time a phone file request waits for the runner to answer. */
const FS_TIMEOUT_MS = 10_000;

class SessionBus {
  private channels = new Map<string, Channel>();
  /** Outstanding `fs.*` requests awaiting an `fs.result`, keyed by requestId. */
  private fsWaiters = new Map<string, { resolve: (r: FsResult) => void; timer: ReturnType<typeof setTimeout> }>();

  private channel(sessionId: string): Channel {
    let ch = this.channels.get(sessionId);
    if (!ch) {
      ch = { watchers: new Set(), runner: null, pending: new Set() };
      this.channels.set(sessionId, ch);
    }
    return ch;
  }

  private gc(sessionId: string): void {
    const ch = this.channels.get(sessionId);
    if (ch && ch.watchers.size === 0 && !ch.runner && ch.pending.size === 0) {
      this.channels.delete(sessionId);
    }
  }

  /**
   * Register a watcher sink; returns an unsubscribe function. Any `initial`
   * events (replay) are queued before live events. MUST be called synchronously
   * after taking the replay snapshot so no live event slips through the gap.
   */
  subscribeWatcher(sessionId: string, write: WriteFn, onError: () => void, initial: SessionEvent[] = []): () => void {
    const ch = this.channel(sessionId);
    const q = new WriteQueue(write, onError);
    for (const event of initial) q.push(event);
    ch.watchers.add(q);
    return () => {
      ch.watchers.delete(q);
      this.gc(sessionId);
    };
  }

  /**
   * Fan an event out to all watchers; tracks pending approvals/questions. Doesn't
   * create a channel when nobody is listening (avoids leaking empty channels).
   */
  publishEvent(sessionId: string, event: SessionEvent): void {
    const tracked = event.kind === "approval" || event.kind === "question";
    const ch = tracked ? this.channel(sessionId) : this.channels.get(sessionId);
    if (!ch) return;
    if (event.kind === "approval" || event.kind === "question") ch.pending.add(event.requestId);
    // Leaving "awaiting" means any outstanding decision was resolved (possibly on
    // the desktop, which never calls resolvePending) or abandoned.
    if (event.kind === "state" && event.state !== "awaiting") ch.pending.clear();
    for (const q of ch.watchers) q.push(event);
    this.gc(sessionId);
  }

  /**
   * Attach the (single) runner command sink. A new runner replaces — and closes —
   * any prior one, so a stale stream from before a network blip can't linger.
   * The returned detach reports whether this runner was still the current one
   * (false once replaced), so the caller only reports a disconnect for the
   * runner that actually owns the session.
   */
  attachRunner(sessionId: string, send: CommandFn, close: () => void): () => boolean {
    const ch = this.channel(sessionId);
    const previous = ch.runner;
    const runner: Runner = { send, close };
    ch.runner = runner;
    if (previous) previous.close();
    return () => {
      const current = ch.runner === runner;
      if (current) ch.runner = null;
      this.gc(sessionId);
      return current;
    };
  }

  hasRunner(sessionId: string): boolean {
    return !!this.channels.get(sessionId)?.runner;
  }

  /** Relay a command to the runner; false if no runner is attached. */
  sendCommand(sessionId: string, command: SessionCommand): boolean {
    const runner = this.channels.get(sessionId)?.runner;
    if (!runner) return false;
    runner.send(command);
    return true;
  }

  /** Resolve an outstanding approval/question; false if it wasn't pending. */
  resolvePending(sessionId: string, requestId: string): boolean {
    const ch = this.channels.get(sessionId);
    if (!ch || !ch.pending.has(requestId)) return false;
    ch.pending.delete(requestId);
    return true;
  }

  /**
   * Round-trip an `fs.*` command to the runner and resolve with its `fs.result`.
   * Rejects with "runner offline" if no runner is attached, or "timeout" if the
   * runner doesn't answer in time. The requestId on the command correlates the reply.
   */
  requestFs(sessionId: string, command: FsCommand, timeoutMs = FS_TIMEOUT_MS): Promise<FsResult> {
    return new Promise<FsResult>((resolve, reject) => {
      const runner = this.channels.get(sessionId)?.runner;
      if (!runner) {
        reject(new Error("runner offline"));
        return;
      }
      const timer = setTimeout(() => {
        this.fsWaiters.delete(command.requestId);
        reject(new Error("timeout"));
      }, timeoutMs);
      timer.unref?.();
      this.fsWaiters.set(command.requestId, { resolve, timer });
      runner.send(command);
    });
  }

  /** Resolve an awaiting `fs.*` request with the runner's result; false if none. */
  resolveFs(requestId: string, result: FsResult): boolean {
    const waiter = this.fsWaiters.get(requestId);
    if (!waiter) return false;
    clearTimeout(waiter.timer);
    this.fsWaiters.delete(requestId);
    waiter.resolve(result);
    return true;
  }
}

/** Process-wide singleton. */
export const sessionBus = new SessionBus();
