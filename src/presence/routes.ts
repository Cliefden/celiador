import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { workspacePresence, type WorkspaceEntry } from "./workspaces";
import { editorControl, type EditorRunRequest } from "./control";

/** SSE heartbeat so proxies/clients keep the editor control stream open. */
const HEARTBEAT_MS = 25_000;
/** Cap the run prompt so one request can't ship an unbounded payload to the editor. */
const MAX_PROMPT = 8000;

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

  // Editor control stream: the editor subscribes and the daemon pushes control
  // commands (today, "start a run on a local repo" requested by the phone). This
  // is what lets "Run on your editor" reach the Mac without cloning anything.
  app.get("/commands", (c) => {
    const userId = c.get("user").userId;
    return streamSSE(c, async (stream) => {
      let chain: Promise<unknown> = Promise.resolve();
      const serial = (fn: () => Promise<unknown>): Promise<unknown> => (chain = chain.then(fn, fn));

      let close: () => void = () => {};
      const closed = new Promise<void>((resolve) => (close = resolve));
      const send = (command: EditorRunRequest) => {
        void serial(() => stream.writeSSE({ data: JSON.stringify(command) })).catch(() => close());
      };

      const unsubscribe = editorControl.subscribe(userId, send);
      const heartbeat = setInterval(() => {
        void serial(() => stream.writeSSE({ event: "ping", data: "" })).catch(() => close());
      }, HEARTBEAT_MS);
      c.req.raw.signal.addEventListener("abort", close);

      await closed;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // Phone: ask the user's editor to run an agent on a repo it already has open —
  // no clone, no credentials, on the local working copy. The editor matches
  // `remoteUrl` against its open workspaces and seeds a local agent-host session.
  app.post("/requests", async (c) => {
    const userId = c.get("user").userId;
    const body = (await c.req.json().catch(() => null)) as
      | { remoteUrl?: unknown; name?: unknown; branch?: unknown; prompt?: unknown }
      | null;
    const remoteUrl = typeof body?.remoteUrl === "string" ? body.remoteUrl : "";
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!/^https:\/\//.test(remoteUrl) || !prompt) {
      return c.json({ error: "remoteUrl (https) and prompt are required" }, 400);
    }
    const req: EditorRunRequest = {
      kind: "start-run",
      requestId: randomUUID(),
      remoteUrl,
      name: typeof body?.name === "string" ? body.name.slice(0, 400) : undefined,
      branch: typeof body?.branch === "string" && body.branch ? body.branch.slice(0, 400) : undefined,
      prompt: prompt.slice(0, MAX_PROMPT),
    };
    const delivered = editorControl.request(userId, req);
    if (delivered === 0) {
      return c.json({ error: "No editor is online to run this. Open the repo in Celiador on your Mac." }, 409);
    }
    return c.json({ ok: true, requestId: req.requestId, delivered });
  });

  return app;
}
