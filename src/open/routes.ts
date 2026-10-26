import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { escapeHtml, page } from "../github/app";

/**
 * `/api/open/*` — the links in the GitHub "Picked up" comment. Unauthenticated
 * on purpose and data-free: each page only bounces to the app's deep link
 * (`celiador://task/<id>`, `celiador://queue`) and shows a fallback link, so a
 * task id in a public comment reveals nothing. The app decides what the
 * signed-in user may see.
 */

/** The app's URL scheme (the iOS app registers a channel-specific one; prod is `celiador`). */
const SCHEME = (process.env.CELIADOR_APP_SCHEME ?? "celiador").replace(/[^a-z0-9+.-]/gi, "") || "celiador";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function redirectPage(title: string, link: string): string {
  const href = escapeHtml(link);
  const head = `<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${href}">`;
  const body =
    `<h1>${escapeHtml(title)}</h1>` +
    `<p><a href="${href}" style="display:inline-block;background:#7FD1AE;color:#0B1A13;border-radius:10px;padding:12px 18px;font-weight:600;text-decoration:none">Open in Celiador</a></p>` +
    `<p>Nothing happened? Get the app: Celiador for iPhone and the Celiador editor are at <a href="https://celiador.ai">celiador.ai</a>.</p>` +
    `<script>location.href=${JSON.stringify(link)};</script>`;
  return page(title, body, head);
}

export function openRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const headers = { "cache-control": "no-store", "x-robots-tag": "noindex" };

  app.get("/task/:id", (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.html(page("Not found", "<h1>That link isn't valid</h1><p>Open the Celiador queue instead.</p>"), 404, headers);
    return c.html(redirectPage("Opening the run in Celiador…", `${SCHEME}://task/${id.toLowerCase()}`), 200, headers);
  });

  app.get("/queue", (c) => c.html(redirectPage("Opening the Celiador queue…", `${SCHEME}://queue`), 200, headers));

  return app;
}
