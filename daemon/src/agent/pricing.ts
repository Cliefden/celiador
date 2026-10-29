/**
 * The daemon's published rate card for agent usage — what a run "cost" in the
 * queue and on a pull request. These are Celiador's own per-million-token prices
 * (USD), not Anthropic's list price; `GET /api/limits` publishes them as
 * `prices` so the site and the clients show the same figures.
 *
 * Four rates, because an agent turn re-reads its whole context every request:
 * on a 45-second run nine out of ten input tokens are prompt-cache reads, and
 * pricing those as fresh input made a trivial change look like $7.
 *   CELIADOR_PRICE_INPUT_PER_MTOK        uncached input          (default 15)
 *   CELIADOR_PRICE_CACHE_WRITE_PER_MTOK  cache creation          (default 18.75)
 *   CELIADOR_PRICE_CACHE_READ_PER_MTOK   cache read              (default 1.5)
 *   CELIADOR_PRICE_OUTPUT_PER_MTOK       output                  (default 75)
 */

function price(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface Prices {
  readonly currency: "USD";
  /** USD per million uncached input tokens. */
  readonly inputPerMtok: number;
  /** USD per million prompt-cache creation tokens. */
  readonly cacheWritePerMtok: number;
  /** USD per million prompt-cache read tokens. */
  readonly cacheReadPerMtok: number;
  /** USD per million output tokens. */
  readonly outputPerMtok: number;
}

/** The rates in force right now (env is read on every call so a restart isn't needed to re-read them in tests). */
export function prices(): Prices {
  return {
    currency: "USD",
    inputPerMtok: price("CELIADOR_PRICE_INPUT_PER_MTOK", 15),
    cacheWritePerMtok: price("CELIADOR_PRICE_CACHE_WRITE_PER_MTOK", 18.75),
    cacheReadPerMtok: price("CELIADOR_PRICE_CACHE_READ_PER_MTOK", 1.5),
    outputPerMtok: price("CELIADOR_PRICE_OUTPUT_PER_MTOK", 75),
  };
}

/** One request's (or a whole session's) token counts. `input` is the TOTAL input, cache tokens included. */
export interface TokenCounts {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
}

/** Tokens → USD at the published rates, rounded to a millionth of a dollar (no float noise in JSON). */
export function costUsd(t: TokenCounts): number {
  const p = prices();
  const cacheRead = Math.max(0, t.cacheRead);
  const cacheWrite = Math.max(0, t.cacheWrite);
  const uncached = Math.max(0, t.input - cacheRead - cacheWrite);
  const raw = (uncached * p.inputPerMtok + cacheWrite * p.cacheWritePerMtok + cacheRead * p.cacheReadPerMtok + Math.max(0, t.output) * p.outputPerMtok) / 1_000_000;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
