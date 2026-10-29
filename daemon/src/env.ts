import fs from "node:fs";
import path from "node:path";

/**
 * Load `.env` BEFORE any other module evaluates. ESM runs every static import of
 * main.ts before main.ts's own body, and config.ts / push/instance.ts /
 * sessions/routes.ts read PORT, HOST, CELIADOR_HOME, CELIADOR_AGENT_* at import
 * time — so main.ts must import this module first for .env values to count.
 *
 * Minimal loader (no dependency): `KEY=value` per line, existing environment
 * wins. A ` #` after the value starts a comment (so `PORT=4661  # note` → 4661);
 * matching surrounding quotes are stripped. The .env lives in CELIADOR_HOME
 * (or cwd). Under systemd, prefer EnvironmentFile — it does NOT strip comments.
 */
export function loadDotEnv(file = path.join(process.env.CELIADOR_HOME ?? process.cwd(), ".env")): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.replace(/\s+#.*$/, "").trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();
