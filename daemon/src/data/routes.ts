import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { dbEnabled } from "../db/pool";
import { deleteChat, getChat, getProfile, listChats, renameChat, updateProfile } from "../db/repo";

/**
 * Daemon-mediated app data for the editor (macOS) and iOS clients: profiles and
 * durable chat history. Both apps call these with their Supabase Bearer token;
 * the daemon owns the DB connection and scopes every query to the caller.
 *
 * Mounted at specific prefixes (/api/profile, /api/chats) — matching push/sessions
 * — so the per-route auth guard never shadows the public /api/health & /api/config.
 *
 * Live agent interaction stays on the session relay (/api/sessions); these are the
 * durable read/manage endpoints. Chat/message rows are WRITTEN by the relay
 * persister (sessions/persist.ts), so there is deliberately no message-write here.
 */

// Make the "DB not configured" case explicit (503) rather than a null-driven 500.
const requireDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!dbEnabled()) return c.json({ error: "database not configured" }, 503);
  await next();
};

/** Caps on what a profile PATCH may store (settings is a JSONB blob the clients own). */
export const MAX_SETTINGS_BYTES = 16 * 1024;
const MAX_DISPLAY_NAME = 200;
const MAX_AVATAR_URL = 2048;

export function profileRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);
  app.use("*", requireDb);

  app.get("/", async (c) => {
    const profile = await getProfile(c.get("user").userId);
    if (!profile) return c.json({ error: "profile not found" }, 404);
    return c.json({ profile });
  });

  app.patch("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const patch: { display_name?: string; avatar_url?: string; settings?: Record<string, unknown> } = {};
    if (typeof body.display_name === "string") {
      if (body.display_name.length > MAX_DISPLAY_NAME) return c.json({ error: "display_name too long" }, 400);
      patch.display_name = body.display_name;
    }
    if (typeof body.avatar_url === "string") {
      if (body.avatar_url.length > MAX_AVATAR_URL) return c.json({ error: "avatar_url too long" }, 400);
      patch.avatar_url = body.avatar_url;
    }
    if (body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)) {
      if (Buffer.byteLength(JSON.stringify(body.settings), "utf8") > MAX_SETTINGS_BYTES) {
        return c.json({ error: `settings too large (max ${MAX_SETTINGS_BYTES} bytes)` }, 413);
      }
      patch.settings = body.settings;
    }
    const profile = await updateProfile(c.get("user").userId, patch, MAX_SETTINGS_BYTES);
    if (profile === "too-large") return c.json({ error: `settings too large (max ${MAX_SETTINGS_BYTES} bytes)` }, 413);
    if (!profile) return c.json({ error: "profile not found" }, 404);
    return c.json({ profile });
  });

  return app;
}

export function chatRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);
  app.use("*", requireDb);

  app.get("/", async (c) => {
    const limit = Number(c.req.query("limit") ?? 100) || 100;
    const chats = await listChats(c.get("user").userId, limit);
    return c.json({ chats });
  });

  app.get("/:id", async (c) => {
    const result = await getChat(c.get("user").userId, c.req.param("id"));
    if (!result) return c.json({ error: "not found" }, 404);
    return c.json(result);
  });

  app.patch("/:id", async (c) => {
    const { title } = await c.req.json().catch(() => ({}));
    if (typeof title !== "string" || !title.trim()) return c.json({ error: "title is required" }, 400);
    const chat = await renameChat(c.get("user").userId, c.req.param("id"), title.trim());
    if (!chat) return c.json({ error: "not found" }, 404);
    return c.json({ chat });
  });

  app.delete("/:id", async (c) => {
    const ok = await deleteChat(c.get("user").userId, c.req.param("id"));
    return c.json({ ok });
  });

  return app;
}
