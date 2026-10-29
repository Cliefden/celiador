import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { pushStores } from "./instance";
import { apnsAvailable, isDeadToken, isValidDeviceToken, sendAlert } from "./apns";

/**
 * Push registration + a self-test. All routes require an authenticated user;
 * tokens are stored per-user. Actual event-driven pushes (Live Activities,
 * alerts on state changes) are wired by whatever feature needs them — this
 * module owns registration and the APNs send path.
 */
export function pushRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const stores = pushStores;

  app.use("*", requireUser);

  // Register (or refresh) an APNs device token.
  app.post("/register", async (c) => {
    const { token, env } = await c.req.json().catch(() => ({}));
    const t = typeof token === "string" ? token.trim() : "";
    if (!isValidDeviceToken(t)) return c.json({ error: "A valid APNs token is required." }, 400);
    stores.for(c.get("user").userId).addDevice(t, env === "production" ? "production" : "sandbox");
    return c.json({ ok: true });
  });

  app.delete("/register", async (c) => {
    const { token } = await c.req.json().catch(() => ({}));
    if (typeof token === "string" && token.trim()) stores.for(c.get("user").userId).removeDevice(token.trim());
    return c.json({ ok: true });
  });

  // Register a Live Activity push token, scoped to an activity id.
  app.post("/activity", async (c) => {
    const { activityId, token, env } = await c.req.json().catch(() => ({}));
    const id = typeof activityId === "string" ? activityId.trim() : "";
    const t = typeof token === "string" ? token.trim() : "";
    if (!id || id.length > 64 || !isValidDeviceToken(t)) {
      return c.json({ error: "activityId and a valid token are required." }, 400);
    }
    stores.for(c.get("user").userId).addActivity(id, t, env === "production" ? "production" : "sandbox");
    return c.json({ ok: true });
  });

  // Send a test alert to all of the caller's registered devices.
  app.post("/test", async (c) => {
    if (!apnsAvailable()) return c.json({ error: "APNs is not configured on this server." }, 503);
    const push = stores.for(c.get("user").userId);
    const devices = push.devices();
    if (devices.length === 0) return c.json({ error: "No registered devices." }, 400);
    let sent = 0;
    for (const d of devices) {
      const result = await sendAlert(
        { token: d.token, env: d.env },
        { title: "Celiador", body: "Push is working. 🎉" }
      );
      if (isDeadToken(result)) push.prune(d.token);
      else if (result.status === 200) sent++;
    }
    return c.json({ ok: true, sent, devices: devices.length });
  });

  return app;
}
