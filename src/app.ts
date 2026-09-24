import { Hono } from "hono";
import { cors } from "hono/cors";
import { VERSION } from "./config";
import { authMode, type AppEnv } from "./auth";
import { agentProxy } from "./anthropic";
import { pushRoutes } from "./push/routes";

/** Build the daemon's HTTP app. Pure — no listening; see main.ts. */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // CORS for API clients. Safe with Bearer-token auth (no cookies → no CSRF
  // surface) and required by the iOS/companion clients calling cross-origin.
  app.use(
    "/api/*",
    cors({
      origin: "*",
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    })
  );

  // Health — clients verify compatibility here. `name` kept for compatibility.
  app.get("/api/health", (c) =>
    c.json({ ok: true, name: "celiador-daemon", version: VERSION, pid: process.pid })
  );

  // What a client needs to boot: auth mode + Supabase client config.
  app.get("/api/config", (c) =>
    c.json({
      authMode: authMode(),
      supabaseUrl: process.env.SUPABASE_URL ?? null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? null,
    })
  );

  // Anthropic agent proxy (SSE). Auth handled inside (user JWT or shared token).
  app.post("/api/agent/messages", agentProxy);

  // Push registration + APNs.
  app.route("/api/push", pushRoutes());

  app.notFound((c) => c.json({ error: "Unknown endpoint" }, 404));
  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500));

  return app;
}
