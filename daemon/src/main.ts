// Must stay the FIRST import: loads .env before config.ts & co. read it at import time.
import "./env";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { HOST, PORT, VERSION } from "./config";
import { assertAuthConfigured } from "./auth";
import { reapOrphanRuns } from "./runner/reap";
import { installShutdown } from "./shutdown";

assertAuthConfigured();

// Clear server-run workspaces whose session is gone (or idle past the TTL). The
// rest are kept: the phone browses their files and follow-ups continue in them.
void reapOrphanRuns().then((removed) => {
  if (removed.length > 0) console.log(`[runs] reaped ${removed.length} orphaned workspace(s)`);
});

const app = createApp();

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`Celiador daemon v${VERSION} → http://${HOST}:${info.port}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Warning: no ANTHROPIC_API_KEY — the agent proxy will fail.");
  }
});

// SIGINT/SIGTERM: stop accepting, drain briefly, flush the debounced stores, exit.
installShutdown(server as Server);
