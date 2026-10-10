import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { workspacePresence, type WorkspaceEntry } from "./workspaces";

/** Guard the heartbeat payload: cap list size + field lengths, require https remotes. */
const MAX_ITEMS = 50;
const str = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

function validEntry(raw: unknown): raw is WorkspaceEntry {
  if (!raw || typeof raw !== "object") return false;
  const e = raw as Record<string, unknown>;
  return (
    str(e.name, 400) &&
    str(e.remoteUrl, 2048) &&
    /^https:\/\//.test(e.remoteUrl as string) &&
    (e.branch === undefined || str(e.branch, 400))
  );
}

/**
 * Editor presence: which repos are open in the user's editor(s) right now. The
 * editor PUTs a heartbeat; the phone GETs the list for its "from your editor"
 * repo picker. See presence/workspaces.ts.
 */
export function presenceRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  // Editor heartbeat: replace this editor instance's set of open workspaces.
  app.put("/workspaces", async (c) => {
    const userId = c.get("user").userId;
    const body = (await c.req.json().catch(() => null)) as
      | { clientId?: unknown; workspaces?: unknown }
      | null;
    const clientId =
      typeof body?.clientId === "string" && body.clientId.length > 0 && body.clientId.length <= 200
        ? body.clientId
        : null;
    const raw = Array.isArray(body?.workspaces) ? body!.workspaces : null;
    if (!clientId || !raw) {
      return c.json({ error: "clientId and workspaces[] are required" }, 400);
    }
    if (raw.length > MAX_ITEMS) {
      return c.json({ error: "too many workspaces" }, 413);
    }
    const items = raw.filter(validEntry);
    workspacePresence.publish(userId, clientId, items);
    return c.json({ ok: true, count: items.length });
  });

  // Phone: repos currently open in the user's editor(s), de-duped by remote URL.
  app.get("/workspaces", (c) =>
    c.json({ workspaces: workspacePresence.list(c.get("user").userId) })
  );

  return app;
}
