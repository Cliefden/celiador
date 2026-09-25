import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Session, SessionEvent, SessionEventInput, SessionOrigin, SessionRunner, SessionState } from "./types";

/** Max events retained per session (older ones fall out of the ring). */
const RING = 2000;
/** Sessions older than this (by updatedAt) are reaped on load. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard cap on sessions kept per user (oldest reaped first). */
const MAX_SESSIONS = 200;
/** Debounce window for disk writes so streaming deltas don't fsync per token. */
const SAVE_DEBOUNCE_MS = 250;

interface MetaFile {
  sessions: Session[];
}

interface LogFile {
  logs: Record<string, SessionEvent[]>;
}

/**
 * Per-user session store. Durable metadata lives in `meta/<userId>.json`; the
 * event log (a bounded ring buffer per session) lives in `log/<userId>.json`.
 * Structural changes (create/delete/state/runner) persist immediately; plain
 * event appends are debounced. Mirrors the disk/cache shape of push/store.ts.
 */
export class SessionStore {
  private sessions: Session[] = [];
  private logs = new Map<string, SessionEvent[]>();
  private metaTimer: NodeJS.Timeout | null = null;
  private logTimer: NodeJS.Timeout | null = null;

  constructor(private userId: string, private metaFile: string, private logFile: string) {
    this.sessions = readJson<MetaFile>(metaFile)?.sessions ?? [];
    const loadedLogs = readJson<LogFile>(logFile)?.logs ?? {};
    for (const [id, events] of Object.entries(loadedLogs)) this.logs.set(id, events);
    this.reap();
  }

  list(): Session[] {
    return [...this.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Session | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  create(input: { title?: string; origin: SessionOrigin; runner: SessionRunner }): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: crypto.randomUUID(),
      userId: this.userId,
      title: input.title?.trim() || "Untitled task",
      origin: input.origin,
      runner: input.runner,
      state: "idle",
      runnerConnected: false,
      lastSeq: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.push(session);
    this.logs.set(session.id, []);
    this.reap();
    this.saveMetaNow();
    return session;
  }

  delete(id: string): boolean {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.logs.delete(id);
    if (this.sessions.length === before) return false;
    this.saveMetaNow();
    this.saveLogNow();
    return true;
  }

  /** Append a runner event; assigns seq/at, updates session state, returns the stored event. */
  append(id: string, input: SessionEventInput): SessionEvent | undefined {
    const session = this.get(id);
    if (!session) return undefined;
    const seq = ++session.lastSeq;
    const event = { ...input, seq, at: new Date().toISOString() } as SessionEvent;

    const ring = this.logs.get(id) ?? [];
    ring.push(event);
    if (ring.length > RING) ring.splice(0, ring.length - RING);
    this.logs.set(id, ring);

    session.updatedAt = event.at;
    // A `state` event is the runner's authoritative state transition.
    if (event.kind === "state") session.state = event.state;

    if (event.kind === "state") this.saveMetaNow();
    else this.scheduleMetaSave();
    this.scheduleLogSave();
    return event;
  }

  /**
   * Events after `cursor` (exclusive). If `cursor` predates the ring (events were
   * dropped), `truncatedFrom` is the oldest seq still available so the caller can
   * warn the watcher that history is incomplete.
   */
  replay(id: string, cursor: number): { events: SessionEvent[]; truncatedFrom?: number } {
    const ring = this.logs.get(id) ?? [];
    if (ring.length === 0) return { events: [] };
    const oldest = ring[0]!.seq;
    const events = ring.filter((e) => e.seq > cursor);
    if (cursor + 1 < oldest) return { events, truncatedFrom: oldest };
    return { events };
  }

  setRunnerConnected(id: string, connected: boolean): void {
    const session = this.get(id);
    if (!session || session.runnerConnected === connected) return;
    session.runnerConnected = connected;
    session.updatedAt = new Date().toISOString();
    this.saveMetaNow();
  }

  /** Force-set state without an event (used when a runner drops mid-run). */
  setState(id: string, state: SessionState): void {
    const session = this.get(id);
    if (!session || session.state === state) return;
    session.state = state;
    session.updatedAt = new Date().toISOString();
    this.saveMetaNow();
  }

  private reap(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    let changed = false;
    const fresh = this.sessions.filter((s) => Date.parse(s.updatedAt) >= cutoff);
    if (fresh.length !== this.sessions.length) changed = true;
    fresh.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (fresh.length > MAX_SESSIONS) {
      fresh.splice(MAX_SESSIONS);
      changed = true;
    }
    if (changed) {
      const keep = new Set(fresh.map((s) => s.id));
      this.sessions = fresh;
      for (const id of [...this.logs.keys()]) if (!keep.has(id)) this.logs.delete(id);
      this.saveMetaNow();
      this.saveLogNow();
    }
  }

  private scheduleMetaSave(): void {
    if (this.metaTimer) return;
    this.metaTimer = setTimeout(() => this.saveMetaNow(), SAVE_DEBOUNCE_MS);
  }

  private scheduleLogSave(): void {
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => this.saveLogNow(), SAVE_DEBOUNCE_MS);
  }

  private saveMetaNow(): void {
    if (this.metaTimer) {
      clearTimeout(this.metaTimer);
      this.metaTimer = null;
    }
    writeJson<MetaFile>(this.metaFile, { sessions: this.sessions });
  }

  private saveLogNow(): void {
    if (this.logTimer) {
      clearTimeout(this.logTimer);
      this.logTimer = null;
    }
    writeJson<LogFile>(this.logFile, { logs: Object.fromEntries(this.logs) });
  }
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null; // corrupt — start clean; rewritten on next mutation
  }
}

function writeJson<T>(file: string, data: T): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/** Per-user SessionStore cache, rooted under <root>/data/sessions. */
export class SessionStores {
  private stores = new Map<string, SessionStore>();
  constructor(private root: string) {}

  for(userId: string): SessionStore {
    let store = this.stores.get(userId);
    if (!store) {
      const base = path.join(this.root, "data", "sessions");
      store = new SessionStore(userId, path.join(base, "meta", `${userId}.json`), path.join(base, "log", `${userId}.json`));
      this.stores.set(userId, store);
    }
    return store;
  }
}
