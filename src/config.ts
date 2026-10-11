import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export const VERSION = (
  JSON.parse(fs.readFileSync(path.join(dir, "..", "package.json"), "utf8")) as { version: string }
).version;

export const PORT = Number(process.env.PORT ?? 4661);
export const HOST = process.env.HOST ?? "127.0.0.1";

/** Where the daemon keeps its state (data/…). Defaults to the process cwd. */
export const ROOT = process.env.CELIADOR_HOME ?? process.cwd();

/** The model the agent proxy runs; the client never picks it. */
export const AGENT_MODEL = process.env.CELIADOR_AGENT_MODEL ?? "claude-opus-4-8";
export const AGENT_MAX_TOKENS = Number(process.env.CELIADOR_AGENT_MAX_TOKENS ?? 32000);

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

/**
 * Minimal .env loader (no dependency): `KEY=value` per line, existing
 * environment wins. Mirrors the old daemon so the same .env drops straight in.
 */
export function loadDotEnv(file = path.join(ROOT, ".env")): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    if (process.env[key] === undefined) process.env[key] = match[2]!;
  }
}
