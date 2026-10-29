import type { Context } from "hono";
import { stream } from "hono/streaming";
import { AGENT_MODEL, AGENT_MAX_TOKENS } from "./config";
import { validateGatewayRequest } from "./agent/policy";
import { agentQuota } from "./agent/quota";
import { authorizeAgent, refuse } from "./agent/authorize";
import type { AuthResult } from "./auth";
import type { TokenCounts } from "./agent/pricing";
import { attributeUsage, MIRROR_HEADER } from "./sessions/usage";

/**
 * First-party Anthropic-compatible gateway. Unlike the locked proxy
 * (/api/agent/messages, anthropic.ts), this endpoint forwards the CALLER's own
 * system prompt + tool schemas so a client built on @anthropic-ai/claude-agent-sdk
 * (the editor's Agents Window, and the future server runner) can point
 * ANTHROPIC_BASE_URL at the daemon and "just work" with its full ~40-tool set.
 *
 * The daemon still owns everything that matters: it holds the real Anthropic key
 * (clients never see it), forces the model, caps max_tokens, authenticates every
 * caller and charges per-user quota. The forwarded tools never execute here — they
 * run in the caller's workspace/sandbox — so passthrough of tool schemas is inert
 * data, not an exec surface.
 *
 * It is a transparent reverse proxy (raw fetch passthrough) rather than a re-issue
 * via the SDK, so it faithfully forwards thinking config, tool_choice, server-side
 * tools, images and anthropic-beta headers without the daemon modelling each field.
 */

const UPSTREAM = (process.env.ANTHROPIC_UPSTREAM_URL ?? "https://api.anthropic.com").replace(/\/+$/, "");

/**
 * Gateway mode is on by default — it is the whole point of this product (clients
 * run the agent through us). Set CELIADOR_AGENT_GATEWAY=0 to fall back to the
 * locked 3-tool proxy only. Runner tokens always get gateway mode regardless.
 */
function gatewayEnabled(): boolean {
  const raw = process.env.CELIADOR_AGENT_GATEWAY?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Optional model allowlist (CELIADOR_AGENT_MODELS). Unset = force AGENT_MODEL. */
function modelFor(requested: unknown): string {
  const raw = process.env.CELIADOR_AGENT_MODELS?.trim();
  if (raw && typeof requested === "string") {
    const allowed = new Set(raw.split(",").map((m) => m.trim()).filter(Boolean));
    if (allowed.has(requested)) return requested;
  }
  return AGENT_MODEL;
}

/** Credentials for the daemon's own upstream call (never exposed to clients). */
function upstreamHeaders(c: Context): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": c.req.header("anthropic-version") || "2023-06-01",
  };
  const beta = c.req.header("anthropic-beta");
  if (beta) headers["anthropic-beta"] = beta;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (apiKey) headers["x-api-key"] = apiKey;
  else if (authToken) headers["authorization"] = `Bearer ${authToken}`;
  return headers;
}

/**
 * A per-turn `output_config.effort` is chosen for the model the caller asked
 * for. When the daemon substitutes its own model, that effort may not exist
 * on it (Anthropic answers 400 "requires a model that supports per-turn
 * effort"), so it is dropped; the rest of output_config stays. Exported for the smoke test.
 */
export function withoutEffort(outputConfig: unknown): Record<string, unknown> | undefined {
  if (!outputConfig || typeof outputConfig !== "object") return undefined;
  const { effort: _effort, ...rest } = outputConfig as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export async function anthropicGateway(c: Context) {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const invalid = validateGatewayRequest(body);
  if (invalid) return c.json({ error: invalid }, 400);

  const auth = await authorizeAgent(c);
  if (!auth.ok) return refuse(c, auth);
  const { quotaKey, isRunner, user, release } = auth;
  // Which run this request belongs to (cost attribution): the runner token's run id,
  // or the editor's mirror header. See sessions/usage.ts.
  const mirrorKey = c.req.header(MIRROR_HEADER);

  // Gateway mode must be enabled globally, OR the caller is a daemon-minted runner.
  if (!gatewayEnabled() && !isRunner) {
    release();
    return c.json({ error: "gateway mode is disabled on this server" }, 403);
  }

  // The daemon owns model + max_tokens; everything else is the caller's.
  const forwarded: Record<string, unknown> = {
    ...body,
    model: modelFor(body.model),
    max_tokens: Math.min(Number(body.max_tokens) || AGENT_MAX_TOKENS, AGENT_MAX_TOKENS),
  };
  if (forwarded.model !== body.model) {
    forwarded.output_config = withoutEffort(body.output_config);
  }
  const streaming = forwarded.stream === true;

  const ac = new AbortController();
  c.req.raw.signal.addEventListener("abort", () => ac.abort());

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/v1/messages`, {
      method: "POST",
      headers: upstreamHeaders(c),
      body: JSON.stringify(forwarded),
      signal: ac.signal,
    });
  } catch (err) {
    release();
    if (ac.signal.aborted) return c.body(null, 499 as never);
    console.error("[gateway] upstream fetch failed:", err instanceof Error ? err.message : err);
    return c.json({ error: "The agent request failed upstream." }, 502);
  }

  // Non-streaming: forward status + JSON, account usage from the body.
  if (!streaming || !upstream.body) {
    try {
      const text = await upstream.text();
      if (upstream.ok) {
        try {
          const json = JSON.parse(text) as { usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };
          const cacheWrite = json.usage?.cache_creation_input_tokens ?? 0;
          const cacheRead = json.usage?.cache_read_input_tokens ?? 0;
          recordUsage(quotaKey, user, mirrorKey, { input: (json.usage?.input_tokens ?? 0) + cacheWrite + cacheRead, cacheRead, cacheWrite, output: json.usage?.output_tokens ?? 0 });
        } catch {
          /* non-JSON body — skip accounting */
        }
      }
      c.header("content-type", upstream.headers.get("content-type") || "application/json");
      return c.body(text, upstream.status as never);
    } finally {
      release();
    }
  }

  // Streaming: pass the SSE bytes through unchanged, scanning for usage as we go.
  c.header("content-type", upstream.headers.get("content-type") || "text/event-stream");
  c.header("cache-control", "no-cache");
  return stream(c, async (s) => {
    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    const usage = newUsageScanner();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        usage.scan(decoder.decode(value, { stream: true }));
        await s.write(value);
      }
    } catch (err) {
      if (!ac.signal.aborted) console.error("[gateway] stream error:", err instanceof Error ? err.message : err);
    } finally {
      recordUsage(quotaKey, user, mirrorKey, usage.tokens);
      release();
    }
  });
}

/** GET /api/anthropic/v1/models — let SDK clients enumerate models via the daemon. */
export async function anthropicModels(c: Context) {
  const auth = await authorizeAgent(c);
  if (!auth.ok) return refuse(c, auth);
  // models listing is not a billable turn — return the slot immediately.
  auth.release();
  try {
    const upstream = await fetch(`${UPSTREAM}/v1/models?limit=1000`, { headers: upstreamHeaders(c) });
    const text = await upstream.text();
    c.header("content-type", upstream.headers.get("content-type") || "application/json");
    return c.body(text, upstream.status as never);
  } catch (err) {
    console.error("[gateway] models fetch failed:", err instanceof Error ? err.message : err);
    return c.json({ error: "Couldn't list models." }, 502);
  }
}

/** Quota (per user) + run attribution (per session) for one request's tokens. */
function recordUsage(quotaKey: string, user: AuthResult | null, mirrorKey: string | undefined, tokens: TokenCounts): void {
  const inputTokens = Math.max(0, tokens.input);
  const outputTokens = Math.max(0, tokens.output);
  agentQuota.record(quotaKey, inputTokens, outputTokens); // the quota counts every input token alike
  attributeUsage(user, mirrorKey, { ...tokens, input: inputTokens, output: outputTokens });
}

/**
 * Best-effort usage extraction from a streamed Anthropic SSE response. input_tokens
 * (plus cache tokens) land in `message_start`; output_tokens is reported cumulatively
 * in `message_delta`. We keep a small carry so a number split across chunk
 * boundaries is still matched.
 */
function newUsageScanner() {
  let carry = "";
  const state = { inputTokens: 0, cacheRead: 0, cacheWrite: 0, outputTokens: 0, gotInput: false };
  return {
    /** Totals so far; `input` includes the cache tokens, which are also broken out. */
    get tokens(): TokenCounts {
      return { input: state.inputTokens, cacheRead: state.cacheRead, cacheWrite: state.cacheWrite, output: state.outputTokens };
    },
    scan(chunk: string) {
      const text = carry + chunk;
      if (!state.gotInput) {
        const input = /"input_tokens":\s*(\d+)/.exec(text);
        if (input) {
          state.cacheWrite = Number(/"cache_creation_input_tokens":\s*(\d+)/.exec(text)?.[1] ?? 0);
          state.cacheRead = Number(/"cache_read_input_tokens":\s*(\d+)/.exec(text)?.[1] ?? 0);
          state.inputTokens = Number(input[1]) + state.cacheWrite + state.cacheRead;
          state.gotInput = true;
        }
      }
      let out: RegExpExecArray | null;
      const re = /"output_tokens":\s*(\d+)/g;
      while ((out = re.exec(text))) state.outputTokens = Number(out[1]); // cumulative; keep the last
      carry = text.slice(-200);
    },
  };
}
