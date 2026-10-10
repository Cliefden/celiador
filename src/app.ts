import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { VERSION } from "./config";
import { authMode, type AppEnv } from "./auth";
import { agentProxy } from "./anthropic";
import { anthropicGateway, anthropicModels } from "./gateway";
import { pushRoutes } from "./push/routes";
import { sessionRoutes } from "./sessions/routes";
import { presenceRoutes } from "./presence/routes";
import { chatRoutes, profileRoutes } from "./data/routes";
import { meRoutes } from "./me/routes";
import { accountRoutes } from "./account/routes";

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
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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
  // Body capped so one request can't ship an unbounded conversation upstream.
  app.post(
    "/api/agent/messages",
    bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json({ error: "request too large" }, 413) }),
    agentProxy
  );

  // First-party Anthropic-compatible gateway (SSE). Forwards the caller's own
  // system prompt + tool schemas (the Claude Agent SDK's full toolset) while the
  // daemon keeps key custody, model choice, token caps, auth and quota. A larger
  // body cap than the locked proxy: SDK turns carry big tool_result payloads.
  app.post(
    "/api/anthropic/v1/messages",
    bodyLimit({ maxSize: 32 * 1024 * 1024, onError: (c) => c.json({ error: "request too large" }, 413) }),
    anthropicGateway
  );
  app.get("/api/anthropic/v1/models", anthropicModels);

  // Push registration + APNs.
  app.route("/api/push", pushRoutes());

  // Agent-session relay (editor = runner, phone = watcher).
  app.route("/api/sessions", sessionRoutes());

  // Editor presence: repos open in the user's editor(s), for the phone's
  // "from your editor" repo picker.
  app.route("/api/presence", presenceRoutes());

  // Daemon-mediated app data (profiles + durable chat history) for both clients.
  app.route("/api/profile", profileRoutes());
  app.route("/api/chats", chatRoutes());

  // Signed-in account summary: identity, plan, and current agent usage vs. quota.
  app.route("/api/me", meRoutes());

  // Account self-service (in-app account deletion — App Store 5.1.1(v)).
  app.route("/api/account", accountRoutes());

  app.notFound((c) => c.json({ error: "Unknown endpoint" }, 404));
  // Log the detail server-side; never leak raw (e.g. pg) error text to clients.
  app.onError((err, c) => {
    console.error("[http] unhandled:", err instanceof Error ? err.stack ?? err.message : err);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
