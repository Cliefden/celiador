import http2 from "node:http2";
import crypto from "node:crypto";
import fs from "node:fs";

/**
 * Dependency-free APNs sender. Signs a provider JWT (ES256) with the .p8 key
 * using Node's `crypto`, and delivers over HTTP/2 with the built-in `http2`.
 * Push is a no-op when the APNS_* env isn't configured, so local dev is
 * unaffected. (Ported verbatim from the previous daemon.)
 *
 * Env:
 *   APNS_KEY_ID   — the .p8 key's Key ID
 *   APNS_TEAM_ID  — the Apple Developer team id
 *   APNS_KEY      — the .p8 contents (PEM), OR
 *   APNS_KEY_PATH — a path to the .p8 file
 *   APNS_TOPIC    — bundle id (default ai.celiador.companion)
 */

interface ApnsConfig {
  keyId: string;
  teamId: string;
  key: string;
  topic: string;
}

function loadConfig(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  let key = process.env.APNS_KEY;
  const keyPath = process.env.APNS_KEY_PATH;
  if (!key && keyPath && fs.existsSync(keyPath)) key = fs.readFileSync(keyPath, "utf8");
  const topic = process.env.APNS_TOPIC ?? "ai.celiador.companion";
  if (!keyId || !teamId || !key) return null;
  return { keyId, teamId, key, topic };
}

export function apnsAvailable(): boolean {
  return loadConfig() !== null;
}

function hostFor(env: string | undefined): string {
  return env === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
}

// The provider JWT is valid up to an hour; refresh well within that.
let cached: { jwt: string; at: number } | null = null;

function providerToken(cfg: ApnsConfig): string {
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.at < 3000) return cached.jwt;
  const b64 = (v: string) => Buffer.from(v).toString("base64url");
  const header = b64(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const payload = b64(JSON.stringify({ iss: cfg.teamId, iat: now }));
  const signingInput = `${header}.${payload}`;
  // ieee-p1363 yields the raw r||s form JOSE requires (not DER).
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: cfg.key,
    dsaEncoding: "ieee-p1363",
  });
  const jwt = `${signingInput}.${signature.toString("base64url")}`;
  cached = { jwt, at: now };
  return jwt;
}

const REQUEST_TIMEOUT_MS = 10_000;

/** APNs device / Live Activity push tokens are hex (32 bytes today). */
export function isValidDeviceToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-fA-F]{64,200}$/.test(token);
}

export interface SendResult {
  status: number;
  reason?: string;
}

function post(
  host: string,
  cfg: ApnsConfig,
  deviceToken: string,
  headers: Record<string, string>,
  payload: unknown
): Promise<SendResult> {
  // Defense in depth: routes validate tokens, but never let one rewrite :path.
  if (!isValidDeviceToken(deviceToken)) return Promise.resolve({ status: 0, reason: "BadDeviceToken" });
  let bearer: string;
  try {
    bearer = providerToken(cfg);
  } catch (err) {
    // e.g. a malformed APNS_KEY — report, don't crash the process.
    console.error("[apns] provider token signing failed:", err instanceof Error ? err.message : err);
    return Promise.resolve({ status: 0 });
  }
  return new Promise((resolve) => {
    const clientConn = http2.connect(`https://${host}`);
    clientConn.on("error", () => resolve({ status: 0 }));
    const req = clientConn.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${bearer}`,
      "content-type": "application/json",
      ...headers,
    });
    // A hung APNs request must not stall every later send.
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      clientConn.close();
      resolve({ status: 0 });
    });
    let body = "";
    let status = 0;
    req.setEncoding("utf8");
    req.on("response", (h) => {
      status = Number(h[":status"]) || 0;
    });
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      clientConn.close();
      let reason: string | undefined;
      try {
        reason = body ? JSON.parse(body).reason : undefined;
      } catch {
        /* non-JSON body */
      }
      resolve({ status, reason });
    });
    req.on("error", () => {
      clientConn.close();
      resolve({ status: 0 });
    });
    req.end(JSON.stringify(payload));
  });
}

/** APNs told us this token is dead — the caller should prune it. */
export function isDeadToken(result: SendResult): boolean {
  return result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "Unregistered";
}

/** Alert push (app closed). */
export async function sendAlert(
  device: { token: string; env: string },
  alert: { title: string; body: string; data?: Record<string, unknown> }
): Promise<SendResult> {
  const cfg = loadConfig();
  if (!cfg) return { status: 0 };
  return post(
    hostFor(device.env),
    cfg,
    device.token,
    { "apns-push-type": "alert", "apns-topic": cfg.topic, "apns-priority": "10" },
    { aps: { alert: { title: alert.title, body: alert.body }, sound: "default" }, ...alert.data }
  );
}

/** Live Activity update/end push, replacing the activity's content state. */
export async function sendLiveActivity(
  activity: { token: string; env: string },
  opts: { event: "update" | "end"; contentState: Record<string, unknown>; dismissImmediately?: boolean }
): Promise<SendResult> {
  const cfg = loadConfig();
  if (!cfg) return { status: 0 };
  const aps: Record<string, unknown> = {
    timestamp: Math.floor(Date.now() / 1000),
    event: opts.event,
    "content-state": opts.contentState,
  };
  if (opts.event === "end" && opts.dismissImmediately) aps["dismissal-date"] = Math.floor(Date.now() / 1000);
  return post(
    hostFor(activity.env),
    cfg,
    activity.token,
    {
      "apns-push-type": "liveactivity",
      "apns-topic": `${cfg.topic}.push-type.liveactivity`,
      "apns-priority": "10",
    },
    { aps }
  );
}
