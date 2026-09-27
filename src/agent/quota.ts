import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config";

/**
 * Per-user limits for the Anthropic proxy (the daemon's shared, paid key).
 * Signup is open, so every account gets:
 *   - a per-minute request rate      CELIADOR_AGENT_RPM                 (default 30)
 *   - a concurrent-stream cap        CELIADOR_AGENT_CONCURRENCY         (default 2)
 *   - a daily request budget         CELIADOR_AGENT_DAILY_REQUESTS      (default 500)
 *   - a daily input-token budget     CELIADOR_AGENT_DAILY_INPUT_TOKENS  (default 5,000,000)
 *   - a daily output-token budget    CELIADOR_AGENT_DAILY_OUTPUT_TOKENS (default 300,000)
 * Set any of them to 0 to disable that limit. Days are UTC. Daily usage persists
 * to <CELIADOR_HOME>/data/quota/usage.json so a restart doesn't reset budgets; the
 * per-minute window and concurrency are in-memory only.
 */

interface DayUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

interface UsageFile {
  day: string;
  users: Record<string, DayUsage>;
}

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
  dailyInput: limit("CELIADOR_AGENT_DAILY_INPUT_TOKENS", 5_000_000),
  dailyOutput: limit("CELIADOR_AGENT_DAILY_OUTPUT_TOKENS", 300_000),
});

const SAVE_DEBOUNCE_MS = 2000;

class AgentQuota {
  private file = path.join(ROOT, "data", "quota", "usage.json");
  private usage: UsageFile;
  private minute = new Map<string, number[]>();
  private active = new Map<string, number>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.usage = { day: today(), users: {} };
    try {
      const loaded = JSON.parse(fs.readFileSync(this.file, "utf8")) as UsageFile;
      if (loaded?.day === this.usage.day && loaded.users) this.usage = loaded;
    } catch {
      /* missing or corrupt — start the day fresh */
    }
  }

  private day(userId: string): DayUsage {
    const d = today();
    if (this.usage.day !== d) this.usage = { day: d, users: {} };
    return (this.usage.users[userId] ??= { requests: 0, inputTokens: 0, outputTokens: 0 });
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
    if (l.dailyInput && used.inputTokens >= l.dailyInput) {
      return { error: "Daily input-token budget used up.", retryAfter: secondsToMidnight };
    }
    if (l.dailyOutput && used.outputTokens >= l.dailyOutput) {
      return { error: "Daily output-token budget used up.", retryAfter: secondsToMidnight };
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

  /** Record token usage reported by the upstream stream. */
  record(userId: string, inputTokens: number, outputTokens: number): void {
    const used = this.day(userId);
    used.inputTokens += Math.max(0, inputTokens || 0);
    used.outputTokens += Math.max(0, outputTokens || 0);
    this.scheduleSave();
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
