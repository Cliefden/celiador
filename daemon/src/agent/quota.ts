import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config";
import { costUsd, round6, type TokenCounts } from "./pricing";

/**
 * Per-user limits for the Anthropic proxy (the daemon's shared, paid key).
 * The budget is in DOLLARS (agent/pricing.ts: each request priced at its model's
 * input / cache-write / cache-read / output rates), so a cache-heavy agent turn
 * counts what it really costs instead of as millions of "input tokens".
 * Signup is open, so every account gets:
 *   - a per-minute request rate      CELIADOR_AGENT_RPM                 (default 30)
 *   - a concurrent-stream cap        CELIADOR_AGENT_CONCURRENCY         (default 2)
 *   - a daily request budget         CELIADOR_AGENT_DAILY_REQUESTS      (default 500)
 *   - a daily spend budget, USD      CELIADOR_AGENT_DAILY_USD           (default 10)
 * and, across ALL accounts together (so scripted signups can't run the key dry):
 *   - a daily request cap            CELIADOR_AGENT_GLOBAL_DAILY_REQUESTS (default 3,000)
 *   - a daily spend cap, USD         CELIADOR_AGENT_GLOBAL_DAILY_USD      (default 100)
 * The token budgets are still honoured as optional hard caps, OFF by default
 * (they count every input token alike, cache reads included):
 *   CELIADOR_AGENT_DAILY_INPUT_TOKENS, CELIADOR_AGENT_DAILY_OUTPUT_TOKENS,
 *   CELIADOR_AGENT_GLOBAL_DAILY_INPUT_TOKENS, CELIADOR_AGENT_GLOBAL_DAILY_OUTPUT_TOKENS
 * Set any of them to 0 to disable that limit. Days are UTC. Budgets are checked
 * before a request and charged after it (a request's cost is only known once it
 * has run), so the last request of the day can overshoot by one turn. Daily usage
 * persists to <CELIADOR_HOME>/data/quota/usage.json so a restart doesn't reset
 * budgets; the per-minute window and concurrency are in-memory only. Finished days
 * are kept (HISTORY_DAYS) in data/quota/history.json for GET /api/admin/usage.
 */

export interface DayUsage {
  requests: number;
  /** All input tokens, cache reads and writes included. */
  inputTokens: number;
  outputTokens: number;
  /** Of `inputTokens`: prompt-cache reads / writes (absent on days recorded before the dollar budget). */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** What those tokens cost, USD, at each request's model rates. */
  costUsd: number;
}

interface UsageFile {
  day: string;
  users: Record<string, Partial<DayUsage>>;
}

/** Finished days kept for the admin usage view. */
const HISTORY_DAYS = 90;

function limit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const limits = () => ({
  rpm: limit("CELIADOR_AGENT_RPM", 30),
  concurrency: limit("CELIADOR_AGENT_CONCURRENCY", 2),
  dailyRequests: limit("CELIADOR_AGENT_DAILY_REQUESTS", 500),
  dailyUsd: limit("CELIADOR_AGENT_DAILY_USD", 10),
  dailyInput: limit("CELIADOR_AGENT_DAILY_INPUT_TOKENS", 0),
  dailyOutput: limit("CELIADOR_AGENT_DAILY_OUTPUT_TOKENS", 0),
  globalDailyRequests: limit("CELIADOR_AGENT_GLOBAL_DAILY_REQUESTS", 3_000),
  globalDailyUsd: limit("CELIADOR_AGENT_GLOBAL_DAILY_USD", 100),
  globalDailyInput: limit("CELIADOR_AGENT_GLOBAL_DAILY_INPUT_TOKENS", 0),
  globalDailyOutput: limit("CELIADOR_AGENT_GLOBAL_DAILY_OUTPUT_TOKENS", 0),
});

const empty = (): DayUsage => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });

/** Fill the fields a record written by an older daemon lacks. */
function normalize(u: Partial<DayUsage> | undefined): DayUsage {
  return { ...empty(), ...(u ?? {}) };
}

function sum(users: Record<string, Partial<DayUsage>>): DayUsage {
  const total = empty();
  for (const raw of Object.values(users)) {
    const u = normalize(raw);
    total.requests += u.requests;
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.cacheReadTokens += u.cacheReadTokens;
    total.cacheWriteTokens += u.cacheWriteTokens;
    total.costUsd += u.costUsd;
  }
  total.costUsd = round6(total.costUsd);
  return total;
}

/**
 * The limits currently in force, for the public `/api/limits` endpoint the
 * pricing page reads — the same object `/api/me` returns to a signed-in
 * client, so the site and the app show the same figures (0 = unlimited).
 */
export function activeLimits(): UserLimits {
  return userLimits();
}

/** The per-account limits only; the global caps stay private (no point telling anyone the headroom). */
export type UserLimits = Pick<ReturnType<typeof limits>, "rpm" | "concurrency" | "dailyRequests" | "dailyUsd" | "dailyInput" | "dailyOutput">;
function userLimits(): UserLimits {
  const { rpm, concurrency, dailyRequests, dailyUsd, dailyInput, dailyOutput } = limits();
  return { rpm, concurrency, dailyRequests, dailyUsd, dailyInput, dailyOutput };
}

/** One day of usage as the admin view reports it. */
export interface DayReport {
  day: string;
  total: DayUsage;
  accounts: number;
  users: Record<string, DayUsage>;
}

const SAVE_DEBOUNCE_MS = 2000;

class AgentQuota {
  private file = path.join(ROOT, "data", "quota", "usage.json");
  private historyFile = path.join(ROOT, "data", "quota", "history.json");
  private usage: UsageFile;
  private minute = new Map<string, number[]>();
  private active = new Map<string, number>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.usage = { day: today(), users: {} };
    try {
      const loaded = JSON.parse(fs.readFileSync(this.file, "utf8")) as UsageFile;
      if (loaded?.users) {
        if (loaded.day === this.usage.day) this.usage = loaded;
        else this.archive(loaded); // the daemon was down over midnight: keep that day
      }
    } catch {
      /* missing or corrupt — start the day fresh */
    }
  }

  /** Roll over to a new UTC day, archiving the finished one. */
  private rollover(): void {
    const d = today();
    if (this.usage.day === d) return;
    this.archive(this.usage);
    this.usage = { day: d, users: {} };
    this.scheduleSave();
  }

  private day(userId: string): DayUsage {
    this.rollover();
    const u = normalize(this.usage.users[userId]);
    this.usage.users[userId] = u;
    return u;
  }

  private readHistory(): UsageFile[] {
    try {
      const h = JSON.parse(fs.readFileSync(this.historyFile, "utf8")) as UsageFile[];
      return Array.isArray(h) ? h : [];
    } catch {
      return [];
    }
  }

  /** Append a finished day to history (one entry per day, newest last, HISTORY_DAYS kept). */
  private archive(day: UsageFile): void {
    if (Object.keys(day.users).length === 0) return;
    try {
      const history = this.readHistory().filter((h) => h.day !== day.day);
      history.push(day);
      history.sort((a, b) => a.day.localeCompare(b.day));
      fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
      const tmp = `${this.historyFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(history.slice(-HISTORY_DAYS)));
      fs.renameSync(tmp, this.historyFile);
    } catch (err) {
      console.error("[quota] history save failed:", err instanceof Error ? err.message : err);
    }
  }

  /** Today (live) plus up to `days - 1` finished days, newest first. */
  report(days: number): DayReport[] {
    this.rollover();
    const all = [...this.readHistory(), this.usage].filter((d, i, arr) => arr.findIndex((x) => x.day === d.day) === i);
    return all
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, Math.max(1, days))
      .map((d) => ({
        day: d.day,
        total: sum(d.users),
        accounts: Object.keys(d.users).length,
        users: Object.fromEntries(Object.entries(d.users).map(([k, v]) => [k, normalize(v)])),
      }));
  }

  /**
   * Try to start a request for `userId`. Returns a release function on success,
   * or `{ error, retryAfter }` when a limit is hit.
   */
  acquire(userId: string): { release: () => void } | { error: string; retryAfter: number } {
    const l = limits();
    const now = Date.now();
    const used = this.day(userId);
    const secondsToMidnight = Math.ceil((Date.parse(`${today()}T00:00:00Z`) + 86_400_000 - now) / 1000);

    if (l.dailyRequests && used.requests >= l.dailyRequests) {
      return { error: "Daily request limit reached.", retryAfter: secondsToMidnight };
    }
    if (l.dailyUsd && used.costUsd >= l.dailyUsd) {
      return { error: "Daily agent budget used up.", retryAfter: secondsToMidnight };
    }
    if (l.dailyInput && used.inputTokens >= l.dailyInput) {
      return { error: "Daily input-token budget used up.", retryAfter: secondsToMidnight };
    }
    if (l.dailyOutput && used.outputTokens >= l.dailyOutput) {
      return { error: "Daily output-token budget used up.", retryAfter: secondsToMidnight };
    }
    const total = sum(this.usage.users);
    if (
      (l.globalDailyRequests && total.requests >= l.globalDailyRequests) ||
      (l.globalDailyUsd && total.costUsd >= l.globalDailyUsd) ||
      (l.globalDailyInput && total.inputTokens >= l.globalDailyInput) ||
      (l.globalDailyOutput && total.outputTokens >= l.globalDailyOutput)
    ) {
      console.warn(`[quota] global daily cap reached (${total.requests} requests, $${total.costUsd.toFixed(2)}, ${total.inputTokens} in, ${total.outputTokens} out)`);
      return { error: "Celiador's agent capacity for today is used up. It resets at midnight UTC.", retryAfter: secondsToMidnight };
    }
    if (l.concurrency && (this.active.get(userId) ?? 0) >= l.concurrency) {
      return { error: "Too many concurrent agent requests.", retryAfter: 5 };
    }
    const window = (this.minute.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (l.rpm && window.length >= l.rpm) {
      this.minute.set(userId, window);
      return { error: "Rate limit: too many agent requests per minute.", retryAfter: Math.ceil((window[0]! + 60_000 - now) / 1000) };
    }

    window.push(now);
    this.minute.set(userId, window);
    this.active.set(userId, (this.active.get(userId) ?? 0) + 1);
    used.requests++;
    this.scheduleSave();

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const n = (this.active.get(userId) ?? 1) - 1;
        if (n <= 0) this.active.delete(userId);
        else this.active.set(userId, n);
      },
    };
  }

  /**
   * Read-only view of a user's current daily usage, the active limits, and when
   * the daily counters reset (next UTC midnight). Pure: unlike {@link acquire},
   * it never mutates counters or inserts a user entry — safe for a `/api/me` poll.
   */
  snapshot(userId: string): { usage: DayUsage; limits: UserLimits; resetsAt: string } {
    this.rollover();
    const d = this.usage.day;
    const used = normalize(this.usage.users[userId]);
    const resetsAt = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString();
    return { usage: used, limits: userLimits(), resetsAt };
  }

  /** Charge one request's tokens (as reported by the upstream stream) to the user's day. Returns the request's cost. */
  record(userId: string, tokens: TokenCounts): number {
    const used = this.day(userId);
    const cost = costUsd(tokens);
    used.inputTokens += Math.max(0, tokens.input || 0);
    used.outputTokens += Math.max(0, tokens.output || 0);
    used.cacheReadTokens += Math.max(0, tokens.cacheRead || 0);
    used.cacheWriteTokens += Math.max(0, tokens.cacheWrite || 0);
    used.costUsd = round6(used.costUsd + cost);
    this.scheduleSave();
    return cost;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.usage));
        fs.renameSync(tmp, this.file);
      } catch (err) {
        console.error("[quota] save failed:", err instanceof Error ? err.message : err);
      }
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const agentQuota = new AgentQuota();
