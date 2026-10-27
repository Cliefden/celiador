/**
 * The daemon's published rate card for agent usage — what a run "cost" in the
 * queue and on a pull request. These are Celiador's own per-million-token prices
 * (CELIADOR_PRICE_INPUT_PER_MTOK / CELIADOR_PRICE_OUTPUT_PER_MTOK, USD; defaults
 * 15 and 75), not Anthropic's list price; `GET /api/limits` publishes them as
 * `prices` so the site and the clients show the same figures. Cache-read tokens
 * count as input (the gateway already folds them in before recording).
 */

function price(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface Prices {
  readonly currency: "USD";
  /** USD per million input tokens (cache reads included). */
  readonly inputPerMtok: number;
  /** USD per million output tokens. */
  readonly outputPerMtok: number;
}

/** The rates in force right now (env is read on every call so a restart isn't needed to re-read them in tests). */
export function prices(): Prices {
  return {
    currency: "USD",
    inputPerMtok: price("CELIADOR_PRICE_INPUT_PER_MTOK", 15),
    outputPerMtok: price("CELIADOR_PRICE_OUTPUT_PER_MTOK", 75),
  };
}

/** Tokens → USD at the published rates, rounded to a millionth of a dollar (no float noise in JSON). */
export function costUsd(inputTokens: number, outputTokens: number): number {
  const p = prices();
  const raw = (Math.max(0, inputTokens) * p.inputPerMtok + Math.max(0, outputTokens) * p.outputPerMtok) / 1_000_000;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
