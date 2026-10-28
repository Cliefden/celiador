import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export const VERSION = (
  JSON.parse(fs.readFileSync(path.join(dir, "..", "package.json"), "utf8")) as { version: string }
).version;

/**
 * Which environment this process is: `prod` | `test` | `dev` on the box,
 * `local` on a laptop. Set by each env's `.env` (ENVIRONMENTS.md). Reported on
 * /api/health so a deploy can check that the daemon answering on a port is the
 * environment it meant to deploy.
 */
export const ENV = process.env.CELIADOR_ENV ?? "local";

/**
 * The git commit this checkout was deployed from. The deploy writes it to
 * `BUILD_INFO` beside package.json (`commit=<sha>`); `CELIADOR_COMMIT` overrides.
 * Empty for a local checkout that was never deployed.
 */
export const COMMIT = ((): string => {
  if (process.env.CELIADOR_COMMIT) return process.env.CELIADOR_COMMIT;
  try {
    const info = fs.readFileSync(path.join(dir, "..", "BUILD_INFO"), "utf8");
    return info.match(/^commit=([0-9a-f]+)/m)?.[1] ?? "";
  } catch {
    return "";
  }
})();

// NOTE: evaluated at import time — main.ts imports ./env first so .env is applied.
export const PORT = Number(process.env.PORT || 4661);
export const HOST = process.env.HOST ?? "127.0.0.1";

/** Where the daemon keeps its state (data/…). Defaults to the process cwd. */
export const ROOT = process.env.CELIADOR_HOME ?? process.cwd();

/** The model the agent proxy runs; the client never picks it. */
export const AGENT_MODEL = process.env.CELIADOR_AGENT_MODEL ?? "claude-opus-4-8";
export const AGENT_MAX_TOKENS = Number(process.env.CELIADOR_AGENT_MAX_TOKENS || 32000);

/**
 * Inline-completion ("Tab autocomplete") settings. A deliberately small, fast
 * model — Claude is not a fill-in-the-middle model, so completions are kept
 * single-ish-line, cheap, and off by default on the client. The caps here are a
 * server-side backstop independent of the agent proxy's limits.
 */
export const COMPLETE_MODEL = process.env.CELIADOR_COMPLETE_MODEL ?? "claude-haiku-4-5";
export const COMPLETE_MAX_TOKENS = Number(process.env.CELIADOR_COMPLETE_MAX_TOKENS ?? 64);
/** Per-user completion requests allowed per rolling minute. */
export const COMPLETE_RPM = Number(process.env.CELIADOR_COMPLETE_RPM ?? 120);
/** Per-user completion output-token budget per rolling day. */
export const COMPLETE_DAILY_OUTPUT_TOKENS = Number(
  process.env.CELIADOR_COMPLETE_DAILY_OUTPUT_TOKENS ?? 200000
);
