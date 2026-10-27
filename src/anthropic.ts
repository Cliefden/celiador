import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { AGENT_MODEL, AGENT_MAX_TOKENS } from "./config";
import { SYSTEM_PROMPT, TOOLS, validateMessages } from "./agent/policy";
import { agentQuota } from "./agent/quota";
import { authorizeAgent } from "./agent/authorize";
import { attributeUsage, MIRROR_HEADER } from "./sessions/usage";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) from the environment.
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Agent proxy for the Celiador clients (editor + iOS). The daemon owns the
 * Anthropic credential AND the request shape: model, max_tokens cap, system
 * prompt and tool set are all server-side (see agent/policy.ts). The client
 * supplies only the conversation (`messages`, validated) and optionally a lower
 * `max_tokens`; any `system` / `tools` / `model` it sends is ignored.
 *
 * Auth accepts EITHER a valid Supabase user JWT (the normal per-user path) OR
 * the CELIADOR_AGENT_TOKEN shared secret (keyless/dev fallback). Every caller is
 * subject to the per-user quota (agent/quota.ts); optionally, CELIADOR_AGENT_PLANS
 * restricts access to the listed `profiles.plan` values. The upstream Anthropic
 * stream is relayed to the client as Server-Sent Events.
 */
export async function agentProxy(c: Context) {
  let body: { messages?: unknown; max_tokens?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const invalid = validateMessages(body.messages);
  if (invalid) return c.json({ error: invalid }, 400);

  const auth = await authorizeAgent(c);
  if (!auth.ok) {
    if (auth.retryAfter !== undefined) c.header("Retry-After", String(auth.retryAfter));
    return c.json({ error: auth.error }, auth.status);
  }
  const { quotaKey, user, release } = auth;
  const mirrorKey = c.req.header(MIRROR_HEADER);

  const request = {
    model: AGENT_MODEL,
    max_tokens: Math.min(Number(body.max_tokens) || AGENT_MAX_TOKENS, AGENT_MAX_TOKENS),
    stream: true as const,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages: body.messages,
  };

  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => ac.abort());
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const upstream = (await getClient().messages.create(request as never, {
        signal: ac.signal,
      })) as unknown as AsyncIterable<UsageEvent>;
      for await (const event of upstream) {
        if (event.type === "message_start") {
          const u = event.message?.usage;
          inputTokens = (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
        } else if (event.type === "message_delta" && typeof event.usage?.output_tokens === "number") {
          outputTokens = event.usage.output_tokens; // cumulative
        }
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        console.error("[agent] upstream error:", err instanceof Error ? err.message : err);
        await stream.writeSSE({ data: JSON.stringify({ type: "error", error: { message: "The agent request failed upstream." } }) });
      }
    } finally {
      agentQuota.record(quotaKey, inputTokens, outputTokens);
      attributeUsage(user, mirrorKey, inputTokens, outputTokens); // per-run cost (sessions/usage.ts)
      release();
    }
  });
}

/** The subset of Anthropic stream events we read usage from. */
interface UsageEvent {
  type: string;
  message?: {
    usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  usage?: { output_tokens?: number };
}
