import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { AGENT_MODEL, AGENT_MAX_TOKENS } from "./config";
import { authenticateToken, bearerFrom, safeEqual } from "./auth";
import { SYSTEM_PROMPT, TOOLS, validateMessages } from "./agent/policy";
import { agentQuota } from "./agent/quota";
import { dbEnabled } from "./db/pool";
import { getProfile } from "./db/repo";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) from the environment.
  if (!client) client = new Anthropic();
  return client;
}

/** Plans allowed to use the proxy (CELIADOR_AGENT_PLANS, comma-separated). Unset = any plan. */
function allowedPlans(): Set<string> | null {
  const raw = process.env.CELIADOR_AGENT_PLANS?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((p) => p.trim()).filter(Boolean));
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
  const bearer = bearerFrom(c);
  const user = authenticateToken(bearer);
  const sharedOk = safeEqual(bearer, process.env.CELIADOR_AGENT_TOKEN);
  if (!user && !sharedOk) return c.json({ error: "unauthorized" }, 401);
  const quotaKey = user?.userId ?? "shared-agent-token";

  // Optional plan gate (only meaningful for real users; the shared token is ops-only).
  const plans = allowedPlans();
  if (plans && user && !sharedOk) {
    if (!dbEnabled()) return c.json({ error: "plan check unavailable" }, 503);
    const profile = await getProfile(user.userId).catch(() => null);
    if (!profile || !plans.has(profile.plan)) {
      return c.json({ error: "Your plan doesn't include the Celiador agent." }, 403);
    }
  }

  let body: { messages?: unknown; max_tokens?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const invalid = validateMessages(body.messages);
  if (invalid) return c.json({ error: invalid }, 400);

  const slot = agentQuota.acquire(quotaKey);
  if ("error" in slot) {
    c.header("Retry-After", String(slot.retryAfter));
    return c.json({ error: slot.error }, 429);
  }

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
      slot.release();
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
