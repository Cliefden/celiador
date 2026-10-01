import { Hono } from "hono";
import { cors } from "hono/cors";
import { VERSION } from "./config";
import { authMode, requireUser, type AppEnv } from "./auth";
import { agentProxy } from "./anthropic";
import { pushRoutes } from "./push/routes";
import { sessionRoutes } from "./sessions/routes";
import { chatRoutes, profileRoutes } from "./data/routes";
import { deleteAccount } from "./account";

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

  // Agent-session relay (editor = runner, phone = watcher).
  app.route("/api/sessions", sessionRoutes());

  // Daemon-mediated app data (profiles + durable chat history) for both clients.
  app.route("/api/profile", profileRoutes());
  app.route("/api/chats", chatRoutes());

  // Account deletion (Apple App Store requirement)
  app.delete("/api/account", requireUser, async (c) => {
    const userId = c.get("user").userId;
    try {
      await deleteAccount(userId);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("database not configured")) {
        return c.json({ error: "database not configured" }, 503);
      }
      if (message.includes("permission denied") || message.includes("lacks permission")) {
        return c.json({ error: "server misconfigured: cannot delete auth users" }, 500);
      }
      console.error("[account] deletion failed:", err);
      return c.json({ error: "account deletion failed" }, 500);
    }
  });

  app.notFound((c) => c.json({ error: "Unknown endpoint" }, 404));
  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500));

  return app;
}
