import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { costUsd } from "../agent/pricing";
import type { Session, SessionEvent, SessionEventInput, SessionOrigin, SessionRunner, SessionState, SessionUsage } from "./types";

/** Max events retained per session (older ones fall out of the ring). */
const RING = 2000;
/** Sessions older than this (by updatedAt) are reaped on load. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Errored/cancelled runs are debris, not history — they get a much shorter TTL. */
const STALE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Hard cap on sessions kept per user (oldest reaped first). */
const MAX_SESSIONS = 200;
/** Debounce window for disk writes so streaming deltas don't fsync per token. */
const SAVE_DEBOUNCE_MS = 250;
/** Debounce for event-log writes (only dirty sessions are rewritten). */
const LOG_DEBOUNCE_MS = 1000;
/** Session ids are daemon-issued UUIDs; anything else never touches the disk. */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

interface MetaFile {
  sessions: Session[];
}

interface LogFile {
  logs: Record<string, SessionEvent[]>;
}

/**
 * Per-user session store. Durable metadata lives in `meta/<userId>.json`; each
 * session's event log (a bounded ring buffer) lives in `log/<userId>/<id>.json`,
 * so a streaming session only rewrites its own (compact) file — not every
 * session the user has. Structural changes (create/delete/state/runner) persist
 * immediately; plain event appends are debounced. Writes are atomic (tmp+rename).
 * (A legacy single-file `log/<userId>.json` is migrated on first load.)
 */
export class SessionStore {
  private sessions: Session[] = [];
  private logs = new Map<string, SessionEvent[]>();
  private dirtyLogs = new Set<string>();
  private metaTimer: NodeJS.Timeout | null = null;
  private logTimer: NodeJS.Timeout | null = null;

  constructor(private userId: string, private metaFile: string, private logDir: string) {
    this.sessions = readJson<MetaFile>(metaFile)?.sessions ?? [];
    const legacy = `${logDir}.json`;
    const legacyLogs = readJson<LogFile>(legacy)?.logs;
    for (const s of this.sessions) {
      const events = legacyLogs?.[s.id] ?? readJson<SessionEvent[]>(this.logPath(s.id));
      if (Array.isArray(events)) this.logs.set(s.id, events);
      if (legacyLogs) this.dirtyLogs.add(s.id);
    }
    this.reap();
    if (legacyLogs) {
      this.saveLogNow();
      fs.rmSync(legacy, { force: true });
    }
  }

  private logPath(id: string): string {
    return path.join(this.logDir, `${id}.json`);
  }

  list(): Session[] {
    return [...this.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Session | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  /** The most recent session created for this runner-side key (see Session.mirrorKey). */
  findMirror(mirrorKey: string): Session | undefined {
    return this.list().find((s) => s.mirrorKey === mirrorKey);
  }

  create(input: { title?: string; origin: SessionOrigin; runner: SessionRunner; mirrorKey?: string }): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: crypto.randomUUID(),
      userId: this.userId,
      title: (typeof input.title === "string" ? input.title.trim().slice(0, 200) : "") || "Untitled task",
      origin: input.origin,
      runner: input.runner,
      state: "idle",
      runnerConnected: false,
      lastSeq: 0,
      createdAt: now,
      updatedAt: now,
      ...(input.mirrorKey ? { mirrorKey: input.mirrorKey } : {}),
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
    this.dirtyLogs.delete(id);
    if (this.sessions.length === before) return false;
    this.saveMetaNow();
    if (SAFE_ID.test(id)) fs.rmSync(this.logPath(id), { force: true });
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
    while (ring.length > RING) compactOldest(ring);
    this.logs.set(id, ring);
    this.dirtyLogs.add(id);

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

  /**
   * Add one gateway request's tokens to the session's usage and re-price the
   * total at the published rates. Debounced to disk like event appends — a run
   * makes many requests, and the session's own updatedAt isn't touched (usage is
   * not activity).
   */
  recordUsage(id: string, inputTokens: number, outputTokens: number): SessionUsage | undefined {
    const session = this.get(id);
    if (!session) return undefined;
    const usage = session.usage ?? { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    usage.requests += 1;
    usage.inputTokens += Math.max(0, inputTokens || 0);
    usage.outputTokens += Math.max(0, outputTokens || 0);
    usage.costUsd = costUsd(usage.inputTokens, usage.outputTokens);
    session.usage = usage;
    this.scheduleMetaSave();
    return { ...usage };
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
    const now = Date.now();
    const cutoffFor = (s: Session): number =>
      now - (s.state === "error" || s.state === "cancelled" ? STALE_SESSION_TTL_MS : SESSION_TTL_MS);
    let changed = false;
    const fresh = this.sessions.filter((s) => Date.parse(s.updatedAt) >= cutoffFor(s));
    if (fresh.length !== this.sessions.length) changed = true;
    fresh.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (fresh.length > MAX_SESSIONS) {
      fresh.splice(MAX_SESSIONS);
      changed = true;
    }
    if (changed) {
      const keep = new Set(fresh.map((s) => s.id));
      this.sessions = fresh;
      for (const id of [...this.logs.keys()]) {
        if (keep.has(id)) continue;
        this.logs.delete(id);
        this.dirtyLogs.delete(id);
        if (SAFE_ID.test(id)) fs.rmSync(this.logPath(id), { force: true });
      }
      this.saveMetaNow();
    }
  }

  private scheduleMetaSave(): void {
    if (this.metaTimer) return;
    this.metaTimer = setTimeout(() => this.saveMetaNow(), SAVE_DEBOUNCE_MS);
  }

  private scheduleLogSave(): void {
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => this.saveLogNow(), LOG_DEBOUNCE_MS);
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
    for (const id of this.dirtyLogs) {
      const ring = this.logs.get(id);
      if (ring && SAFE_ID.test(id)) writeJson(this.logPath(id), ring);
    }
    this.dirtyLogs.clear();
  }

  /** Flush pending writes (used before purging / on shutdown). */
  flush(): void {
    if (this.metaTimer) this.saveMetaNow();
    if (this.logTimer) this.saveLogNow();
  }

  /** Stop timers without writing (account deletion). */
  discard(): void {
    if (this.metaTimer) clearTimeout(this.metaTimer);
    if (this.logTimer) clearTimeout(this.logTimer);
    this.metaTimer = this.logTimer = null;
    this.dirtyLogs.clear();
  }
}

/**
 * Shrink a full ring by one entry without losing conversation structure: merge
 * the oldest pair of adjacent `delta` events (text concatenated into the later
 * one, which keeps its seq) so a long streamed reply doesn't evict earlier
 * messages/approvals from replay. Only when no such pair exists is the oldest
 * event dropped.
 */
function compactOldest(ring: SessionEvent[]): void {
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    if (a.kind === "delta" && b.kind === "delta") {
      ring[i + 1] = { ...b, text: a.text + b.text };
      ring.splice(i, 1);
      return;
    }
  }
  ring.shift();
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (err) {
    // Corrupt: keep the bytes for recovery instead of silently overwriting them
    // with an empty store on the next mutation.
    const aside = `${file}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(file, aside);
    } catch {
      /* best-effort */
    }
    console.error(`[sessions] corrupt ${file} moved to ${aside}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Atomic write: a crash mid-write leaves the previous file intact. */
function writeJson<T>(file: string, data: T): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** Per-user SessionStore cache, rooted under <root>/data/sessions. */
export class SessionStores {
  private stores = new Map<string, SessionStore>();
  constructor(private root: string) {}

  private base(): string {
    return path.join(this.root, "data", "sessions");
  }

  for(userId: string): SessionStore {
    let store = this.stores.get(userId);
    if (!store) {
      const base = this.base();
      store = new SessionStore(userId, path.join(base, "meta", `${userId}.json`), path.join(base, "log", userId));
      this.stores.set(userId, store);
    }
    return store;
  }

  /** Forget everything stored for a user (account deletion). */
  purge(userId: string): void {
    this.stores.get(userId)?.discard();
    this.stores.delete(userId);
    const base = this.base();
    fs.rmSync(path.join(base, "meta", `${userId}.json`), { force: true });
    fs.rmSync(path.join(base, "log", `${userId}.json`), { force: true });
    fs.rmSync(path.join(base, "log", userId), { recursive: true, force: true });
  }
}
