import path from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import { requireUser, type AppEnv } from "../auth";
import { isAdmin } from "../admin/routes";
import { ROOT } from "../config";
import { PUBLIC_URL } from "../releases/manifest";
import { escapeHtml, page } from "../github/app";
import { waitlistMailer } from "./mailer";
import { normalizeEmail, normalizeLists, WaitlistStore, type WaitlistEntry } from "./store";

/**
 * `/api/waitlist` — the website's "get notified" form. Public and
 * unauthenticated, so:
 *
 *   - double opt-in: a sign-up only mails a confirmation link; the address is on
 *     the list after the click (store.ts);
 *   - one answer for everyone: 202 `{ ok: true }` whether the address is new,
 *     pending, already confirmed or throttled, and the mail goes out after the
 *     response — nothing tells a visitor whether an address is on the list;
 *   - limits: per client IP (in memory, never stored), per address (store.ts),
 *     and a global cap on confirmation mails per hour so the form can't burn the
 *     sender's reputation; a honeypot field quietly drops naive bots;
 *   - links in the mail open a page with a button (GET never changes anything,
 *     so mail scanners that prefetch links can't confirm or unsubscribe), and
 *     unsubscribe also takes RFC 8058 one-click POSTs.
 *
 * `/api/admin/waitlist` lists (JSON or CSV) and erases addresses for the
 * accounts in CELIADOR_ADMIN_EMAILS / CELIADOR_ADMIN_USER_IDS (scripts/admin-waitlist.py).
 */

const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_PER_WINDOW = Number(process.env.CELIADOR_WAITLIST_IP_PER_10MIN || 5);
const MAILS_PER_HOUR = Number(process.env.CELIADOR_WAITLIST_MAILS_PER_HOUR || 100);
const HOUR_MS = 60 * 60 * 1000;

let store: WaitlistStore | undefined;
function waitlist(): WaitlistStore {
  store ??= new WaitlistStore(path.join(ROOT, "data", "waitlist"), PUBLIC_URL);
  return store;
}

const ipHits = new Map<string, number[]>();
let mailTimes: number[] = [];

/** The visitor's address: Caddy's X-Forwarded-For (its own hop is the last entry), else the socket. */
function clientIp(c: Context<AppEnv>): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const last = xff.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // app.request() in tests has no socket
  }
}

function ipAllowed(ip: string, now: number): { ok: boolean; retryAfter: number } {
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_PER_WINDOW) {
    ipHits.set(ip, hits);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((hits[0]! + IP_WINDOW_MS - now) / 1000)) };
  }
  hits.push(now);
  ipHits.set(ip, hits);
  // Keep the map from growing without bound: sweep stale IPs now and then.
  if (ipHits.size > 10_000) {
    for (const [k, v] of ipHits) if (!v.some((t) => now - t < IP_WINDOW_MS)) ipHits.delete(k);
  }
  return { ok: true, retryAfter: 0 };
}

function mailBudget(now: number): boolean {
  mailTimes = mailTimes.filter((t) => now - t < HOUR_MS);
  if (mailTimes.length >= MAILS_PER_HOUR) {
    console.warn(`[waitlist] confirmation-mail budget (${MAILS_PER_HOUR}/h) reached; holding mails`);
    return false;
  }
  mailTimes.push(now);
  return true;
}

/** Test hook: forget the in-memory limiter state and reload the store from disk. */
export function resetWaitlistForTests(): void {
  ipHits.clear();
  mailTimes = [];
  store = undefined;
}

const PAGE_HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };

function linkParams(c: Context<AppEnv>): { id: string; t: string } | null {
  const id = c.req.query("id") ?? "";
  const t = c.req.query("t") ?? "";
  return /^[0-9a-f]{32}$/.test(id) && /^[A-Za-z0-9_-]{20,64}$/.test(t) ? { id, t } : null;
}

/** A page whose button POSTs back to this same link (GET stays side-effect free). */
function buttonPage(c: Context<AppEnv>, title: string, text: string, button: string) {
  const action = escapeHtml(c.req.url.replace(/^[a-z]+:\/\/[^/]+/i, ""));
  return c.html(page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><form method="post" action="${action}"><button type="submit">${escapeHtml(button)}</button></form>`), 200, PAGE_HEADERS);
}

function resultPage(c: Context<AppEnv>, status: 200 | 400, title: string, html: string) {
  return c.html(page(title, `<h1>${escapeHtml(title)}</h1>${html}<p><a href="https://celiador.ai">celiador.ai</a></p>`), status, PAGE_HEADERS);
}

export function waitlistRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post(
    "/",
    bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: "request too large" }, 413) }),
    async (c) => {
      const send = waitlistMailer();
      if (!send) return c.json({ error: "The waitlist isn't available here yet." }, 503);
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = await c.req.json();
        body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      } catch {
        return c.json({ error: "Send JSON: { email, lists }." }, 400);
      }
      const now = Date.now();
      const limit = ipAllowed(clientIp(c), now);
      if (!limit.ok) {
        return c.json({ error: "Too many sign-ups from here. Try again in a few minutes." }, 429, { "retry-after": String(limit.retryAfter) });
      }
      const email = normalizeEmail(body.email);
      if (!email) return c.json({ error: "Please enter a valid email address." }, 400);
      // Honeypot: a hidden field people never fill. Answer as if it worked.
      if (typeof body.website === "string" && body.website.trim() !== "") return c.json({ ok: true }, 202);

      const mail = waitlist().signup(email, normalizeLists(body.lists), () => mailBudget(now), now);
      if (mail) {
        // After the response, so its timing doesn't tell a new address from a known one.
        setImmediate(() => {
          send(mail).catch((err) => console.error("[waitlist] confirmation mail failed:", err instanceof Error ? err.message : err));
        });
      }
      return c.json({ ok: true }, 202);
    }
  );

  app.get("/confirm", (c) => {
    if (!linkParams(c)) return resultPage(c, 400, "That link isn't valid", "<p>Copy the whole link from the email, or sign up again on the site.</p>");
    return buttonPage(c, "Confirm your sign-up", "One click and you're on the list. We'll only mail you about what you signed up for.", "Confirm");
  });

  app.post("/confirm", (c) => {
    const p = linkParams(c);
    const lists = p ? waitlist().confirm(p.id, p.t) : null;
    if (!lists) {
      return resultPage(c, 400, "That link has expired or was already used", "<p>If you clicked it before, you're on the list. Otherwise sign up again on the site; confirmation links last 7 days.</p>");
    }
    return resultPage(c, 200, "You're on the list", "<p>Thanks — one email when there's news. Every mail has an unsubscribe link.</p>");
  });

  app.get("/unsubscribe", (c) => {
    if (!linkParams(c)) return resultPage(c, 400, "That link isn't valid", "<p>Write to hello@celiador.ai and we'll remove your address by hand.</p>");
    return buttonPage(c, "Unsubscribe", "This removes your address from every Celiador list and deletes it from our records.", "Remove my address");
  });

  // The page's button, and RFC 8058 one-click (mail clients POST `List-Unsubscribe=One-Click`).
  app.post("/unsubscribe", (c) => {
    const p = linkParams(c);
    if (p) waitlist().unsubscribe(p.id, p.t);
    // Same answer when the record is already gone: the address isn't on any list either way.
    return p
      ? resultPage(c, 200, "You're unsubscribed", "<p>Your address is deleted from our list. Sorry to see you go.</p>")
      : resultPage(c, 400, "That link isn't valid", "<p>Write to hello@celiador.ai and we'll remove your address by hand.</p>");
  });

  return app;
}

function exportRow(s: WaitlistStore, e: WaitlistEntry) {
  return {
    email: e.email,
    lists: e.lists,
    pending: e.pending,
    createdAt: e.createdAt,
    confirmedAt: e.confirmedAt,
    // For the announcement mail's footer (and its List-Unsubscribe header).
    unsubscribeUrl: e.lists.length ? s.unsubscribeUrl(e) : null,
  };
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function waitlistAdminRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);
  app.use("*", async (c, next) => {
    if (!isAdmin(c.get("user"))) return c.json({ error: "not found" }, 404);
    await next();
  });

  // ?status=confirmed (default) | pending | all  ·  ?list=windows  ·  ?format=csv
  app.get("/", (c) => {
    const s = waitlist();
    const status = c.req.query("status") ?? "confirmed";
    const list = c.req.query("list");
    const rows = s
      .all()
      .filter((e) => (status === "all" ? true : status === "pending" ? e.pending.length > 0 : e.lists.length > 0))
      .filter((e) => !list || e.lists.includes(list as never) || (status !== "confirmed" && e.pending.includes(list as never)))
      .map((e) => exportRow(s, e));
    if (c.req.query("format") === "csv") {
      const lines = ["email,lists,pending,created_at,confirmed_at,unsubscribe_url"];
      for (const r of rows) {
        lines.push([r.email, r.lists.join(" "), r.pending.join(" "), r.createdAt, r.confirmedAt ?? "", r.unsubscribeUrl ?? ""].map(csvCell).join(","));
      }
      return c.body(lines.join("\n") + "\n", 200, { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" });
    }
    return c.json({ count: rows.length, entries: rows }, 200, { "cache-control": "no-store" });
  });

  // Erasure on request (GDPR art. 17): DELETE /api/admin/waitlist?email=…
  app.delete("/", (c) => {
    const email = normalizeEmail(c.req.query("email"));
    if (!email) return c.json({ error: "email required" }, 400);
    return c.json({ removed: waitlist().remove(email) });
  });

  return app;
}
