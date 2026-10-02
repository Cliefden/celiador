import type { SessionCommand, SessionEvent } from "./types";

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

interface Channel {
  watchers: Set<WriteQueue>;
  runner: CommandFn | null;
  runnerClose: (() => void) | null;
  /** Outstanding approval/question requestIds awaiting a watcher decision. */
  pending: Set<string>;
}

class SessionBus {
  private channels = new Map<string, Channel>();

  private channel(sessionId: string): Channel {
    let ch = this.channels.get(sessionId);
    if (!ch) {
      ch = { watchers: new Set(), runner: null, runnerClose: null, pending: new Set() };
      this.channels.set(sessionId, ch);
    }
    return ch;
  }

  private gc(sessionId: string): void {
    const ch = this.channels.get(sessionId);
    if (ch && ch.watchers.size === 0 && !ch.runner && ch.runnerClose === null && ch.pending.size === 0) {
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

  /** Fan an event out to all watchers; tracks pending approvals/questions. */
  publishEvent(sessionId: string, event: SessionEvent): void {
    const ch = this.channel(sessionId);
    if (event.kind === "approval" || event.kind === "question") ch.pending.add(event.requestId);
    for (const q of ch.watchers) q.push(event);
  }

  /** Attach the (single) runner command sink; a new one replaces any prior. */
  attachRunner(sessionId: string, send: CommandFn, close: () => void): () => void {
    const ch = this.channel(sessionId);
    ch.runner = send;
    ch.runnerClose = close;
    return () => {
      if (ch.runner === send) {
        ch.runner = null;
        ch.runnerClose = null;
      }
      this.gc(sessionId);
    };
  }

  hasRunner(sessionId: string): boolean {
    return !!this.channels.get(sessionId)?.runner;
  }

  /** Relay a command to the runner; false if no runner is attached. */
  sendCommand(sessionId: string, command: SessionCommand): boolean {
    const runner = this.channels.get(sessionId)?.runner;
    if (!runner) return false;
    runner(command);
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
   * Close all streams and clear all state for a session. Used during account
   * deletion to force-close any open runner/watcher connections.
   */
  closeSession(sessionId: string): void {
    const ch = this.channels.get(sessionId);
    if (!ch) return;
    // Close all watcher streams
    for (const q of ch.watchers) {
      q.fail();
    }
    ch.watchers.clear();
    // Close runner stream
    if (ch.runnerClose) {
      ch.runnerClose();
    }
    ch.runner = null;
    ch.runnerClose = null;
    ch.pending.clear();
    this.channels.delete(sessionId);
  }

  /**
   * Close all sessions for a given list of session IDs. Used during account
   * deletion to clean up all of a user's active sessions.
   */
  closeSessions(sessionIds: string[]): void {
    for (const id of sessionIds) {
      this.closeSession(id);
    }
  }
}

/** Process-wide singleton. */
export const sessionBus = new SessionBus();
