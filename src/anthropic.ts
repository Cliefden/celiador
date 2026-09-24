import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { AGENT_MODEL, AGENT_MAX_TOKENS } from "./config";
import { authenticateToken, bearerFrom } from "./auth";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) from the environment.
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Agent proxy for the Celiador clients (editor + iOS). The daemon owns the
 * Anthropic credential and the model/caps, so no key ships in the client; the
 * client supplies only the conversation, tools, and system prompt.
 *
 * Auth accepts EITHER a valid Supabase user JWT (the normal per-user path) OR
 * the CELIADOR_AGENT_TOKEN shared secret (keyless/dev fallback). The upstream
 * Anthropic stream is relayed to the client as Server-Sent Events.
 */
export async function agentProxy(c: Context) {
  const expected = process.env.CELIADOR_AGENT_TOKEN;
  const bearer = bearerFrom(c);
  const user = authenticateToken(bearer);
  const sharedOk = !!expected && bearer === expected;
  if (!user && !sharedOk) return c.json({ error: "unauthorized" }, 401);

  let body: {
    system?: unknown;
    tools?: unknown;
    messages?: unknown;
    max_tokens?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }

  const request = {
    model: AGENT_MODEL,
    max_tokens: Math.min(Number(body.max_tokens) || AGENT_MAX_TOKENS, AGENT_MAX_TOKENS),
    stream: true as const,
    system: typeof body.system === "string" ? body.system : undefined,
    tools: Array.isArray(body.tools) ? body.tools : undefined,
    messages: Array.isArray(body.messages) ? body.messages : [],
  };

  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => ac.abort());
    try {
      const upstream = (await getClient().messages.create(request as never, {
        signal: ac.signal,
      })) as unknown as AsyncIterable<unknown>;
      for await (const event of upstream) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        await stream.writeSSE({ data: JSON.stringify({ type: "error", error: { message } }) });
      }
    }
  });
}
