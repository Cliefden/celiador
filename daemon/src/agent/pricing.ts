import { AGENT_MODEL } from "../config";

/**
 * What a request costs, in US dollars, at the model's own per-million-token
 * prices. One number feeds everything: a run's cost (Session.usage →
 * Task.usage → the PR footer), the per-user and global daily spend budgets
 * (agent/quota.ts) and the rate card `GET /api/limits` publishes as `prices`.
 *
 * Four token kinds, priced separately, because an agent turn re-reads its whole
 * context every request (on a 45-second run nine out of ten input tokens are
 * prompt-cache reads):
 *   - uncached input                 the model's input price
 *   - cache write, 5-minute TTL      1.25 × input
 *   - cache write, 1-hour TTL        2 × input
 *   - cache read                     the model's cache-read price (≈ 0.1 × input;
 *                                    lower on some models, so it is listed per model)
 *   - output                         the model's output price
 *
 * Prices are Anthropic's first-party list prices (source: the claude-api skill's
 * model table, cached 2026-10-06). A model not in the table is priced at the
 * dearest tier — overstating a run beats under-counting a budget — and logged once.
 *
 * Operator overrides (any model; each replaces only its own rate, USD per Mtok):
 *   CELIADOR_PRICE_INPUT_PER_MTOK, CELIADOR_PRICE_OUTPUT_PER_MTOK,
 *   CELIADOR_PRICE_CACHE_WRITE_PER_MTOK (5-minute), CELIADOR_PRICE_CACHE_WRITE_1H_PER_MTOK,
 *   CELIADOR_PRICE_CACHE_READ_PER_MTOK
 */

interface ModelRate {
  input: number;
  output: number;
  cacheRead: number;
}

/** USD per million tokens. Cache writes derive from `input` (1.25× / 2×). */
const MODEL_RATES: Record<string, ModelRate> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-mythos-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-mythos-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  // Prompts up to 100K tokens; longer prompts are billed higher upstream ($0.50 / $2.50).
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

/** Unknown models are priced like the most expensive tier. */
const FALLBACK_RATE: ModelRate = { input: 10, output: 50, cacheRead: 1 };

const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

const warnedUnknown = new Set<string>();

function rateFor(model: string): ModelRate {
  const id = model.trim().toLowerCase();
  // Exact id, else a dated / suffixed id ("claude-haiku-4-5-20251001", "claude-opus-4-8[1m]").
  const hit = MODEL_RATES[id] ?? Object.entries(MODEL_RATES).sort((a, b) => b[0].length - a[0].length).find(([k]) => id.startsWith(`${k}-`) || id.startsWith(`${k}[`))?.[1];
  if (hit) return hit;
  if (!warnedUnknown.has(id)) {
    warnedUnknown.add(id);
    console.warn(`[pricing] no price for model "${model}"; pricing it at the dearest tier`);
  }
  return FALLBACK_RATE;
}

function override(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export interface Prices {
  readonly currency: "USD";
  /** The model these rates are for. */
  readonly model: string;
  /** USD per million uncached input tokens. */
  readonly inputPerMtok: number;
  /** USD per million prompt-cache creation tokens, 5-minute TTL (the default TTL). */
  readonly cacheWritePerMtok: number;
  /** USD per million prompt-cache creation tokens, 1-hour TTL. */
  readonly cacheWrite1hPerMtok: number;
  /** USD per million prompt-cache read tokens. */
  readonly cacheReadPerMtok: number;
  /** USD per million output tokens. */
  readonly outputPerMtok: number;
}

/** The rates in force for `model` (default: the agent model). Env is read on every call. */
export function prices(model: string = AGENT_MODEL): Prices {
  const r = rateFor(model);
  const input = override("CELIADOR_PRICE_INPUT_PER_MTOK") ?? r.input;
  return {
    currency: "USD",
    model,
    inputPerMtok: input,
    cacheWritePerMtok: override("CELIADOR_PRICE_CACHE_WRITE_PER_MTOK") ?? round6(r.input * CACHE_WRITE_5M),
    cacheWrite1hPerMtok: override("CELIADOR_PRICE_CACHE_WRITE_1H_PER_MTOK") ?? round6(r.input * CACHE_WRITE_1H),
    cacheReadPerMtok: override("CELIADOR_PRICE_CACHE_READ_PER_MTOK") ?? r.cacheRead,
    outputPerMtok: override("CELIADOR_PRICE_OUTPUT_PER_MTOK") ?? r.output,
  };
}

/** Rate cards for every model a client can run here: the agent model plus the gateway allowlist (CELIADOR_AGENT_MODELS). */
export function servedModelPrices(): Record<string, Prices> {
  const extra = (process.env.CELIADOR_AGENT_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return Object.fromEntries([AGENT_MODEL, ...extra].map((m) => [m, prices(m)]));
}

/**
 * One request's (or a whole session's) token counts. `input` is the TOTAL input,
 * cache tokens included; `cacheWrite` is all cache creation, of which
 * `cacheWrite1h` (optional) were written with the 1-hour TTL. `model` is what
 * the request ran on (default: the agent model).
 */
export interface TokenCounts {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cacheWrite1h?: number;
  readonly output: number;
  readonly model?: string;
}

/** Tokens → USD at the model's rates, rounded to a millionth of a dollar (no float noise in JSON). */
export function costUsd(t: TokenCounts): number {
  const p = prices(t.model ?? AGENT_MODEL);
  const cacheRead = Math.max(0, t.cacheRead || 0);
  const cacheWrite = Math.max(0, t.cacheWrite || 0);
  const write1h = Math.min(cacheWrite, Math.max(0, t.cacheWrite1h || 0));
  const write5m = cacheWrite - write1h;
  const uncached = Math.max(0, (t.input || 0) - cacheRead - cacheWrite);
  const raw =
    (uncached * p.inputPerMtok +
      write5m * p.cacheWritePerMtok +
      write1h * p.cacheWrite1hPerMtok +
      cacheRead * p.cacheReadPerMtok +
      Math.max(0, t.output || 0) * p.outputPerMtok) /
    1_000_000;
  return round6(raw);
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
