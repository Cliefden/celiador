// Must stay the FIRST import: loads .env before config.ts & co. read it at import time.
import "./env";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { HOST, PORT, VERSION } from "./config";
import { assertAuthConfigured } from "./auth";

assertAuthConfigured();

const app = createApp();

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`Celiador daemon v${VERSION} → http://${HOST}:${info.port}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Warning: no ANTHROPIC_API_KEY — the agent proxy will fail.");
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
