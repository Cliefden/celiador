import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export const VERSION = (
  JSON.parse(fs.readFileSync(path.join(dir, "..", "package.json"), "utf8")) as { version: string }
).version;

// NOTE: evaluated at import time — main.ts imports ./env first so .env is applied.
export const PORT = Number(process.env.PORT || 4661);
export const HOST = process.env.HOST ?? "127.0.0.1";

/** Where the daemon keeps its state (data/…). Defaults to the process cwd. */
export const ROOT = process.env.CELIADOR_HOME ?? process.cwd();

/** The model the agent proxy runs; the client never picks it. */
export const AGENT_MODEL = process.env.CELIADOR_AGENT_MODEL ?? "claude-opus-4-8";
export const AGENT_MAX_TOKENS = Number(process.env.CELIADOR_AGENT_MAX_TOKENS || 32000);
