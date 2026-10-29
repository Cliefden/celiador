import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import type { AppEnv } from "../auth";
import { COMPLETE_MODEL, COMPLETE_MAX_TOKENS } from "../config";
import { checkAndCount, recordOutputTokens } from "./limiter";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Reads ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) from the environment.
  if (!client) client = new Anthropic();
  return client;
}

/** Sentinel marking the caret between prefix and suffix in the prompt. */
const CURSOR = "<|cursor|>";

const SYSTEM = [
  "You are a code completion engine embedded in an editor.",
  "You will be given a file with a " + CURSOR + " marker at the caret position.",
  "Output ONLY the raw code that should be inserted at the marker to continue the line or block.",
  "Do not repeat text that already appears before or after the marker.",
  "Do not include explanations, comments about your output, or Markdown code fences.",
  "Prefer short, high-confidence completions; a single line is usually best.",
  "If no useful completion is possible, output nothing.",
].join(" ");

/** Trim limits on what we send upstream — keeps latency and cost bounded. */
const MAX_PREFIX = 4000;
const MAX_SUFFIX = 1000;

/**
 * Clean the model's raw output into something safe to insert: drop a Markdown
 * code fence if it added one, and stop at the first blank line (the Anthropic
 * API rejects a whitespace-only stop sequence, so we truncate here instead of
 * asking it to stop). Trailing whitespace is trimmed.
 */
function cleanCompletion(text: string): string {
  let out = text;
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/;
  const match = out.match(fence);
  if (match) out = match[1]!;
  const blank = out.indexOf("\n\n");
  if (blank !== -1) out = out.slice(0, blank);
  return out.replace(/\s+$/, "");
}

/**
 * Inline completion ("Tab autocomplete"). A small, fast, non-streaming Haiku
 * call. The client sends the code before/after the caret and (optionally) the
 * language; the daemon returns the text to insert. Off by default on the
 * client and rate-limited here independently of the agent proxy.
 */
export async function completeHandler(c: Context<AppEnv>) {
  const userId = c.get("user").userId;
  const now = Date.now();

  const decision = checkAndCount(userId, now);
  if (!decision.ok) {
    c.header("Retry-After", String(decision.retryAfter ?? 1));
    return c.json({ error: "rate limited", retryAfter: decision.retryAfter }, 429);
  }

  let body: { prefix?: unknown; suffix?: unknown; language?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }

  const prefix = typeof body.prefix === "string" ? body.prefix.slice(-MAX_PREFIX) : "";
  const suffix = typeof body.suffix === "string" ? body.suffix.slice(0, MAX_SUFFIX) : "";
  const language = typeof body.language === "string" ? body.language : "";
  if (!prefix && !suffix) {
    return c.json({ completion: "" });
  }

  const header = language ? `Language: ${language}\n\n` : "";
  const prompt = `${header}${prefix}${CURSOR}${suffix}`;

  const ac = new AbortController();
  c.req.raw.signal.addEventListener("abort", () => ac.abort());

  try {
    const message = await getClient().messages.create(
      {
        model: COMPLETE_MODEL,
        max_tokens: COMPLETE_MAX_TOKENS,
        temperature: 0.2,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      },
      { signal: ac.signal }
    );

    recordOutputTokens(userId, message.usage?.output_tokens ?? 0, now);

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return c.json({ completion: cleanCompletion(text) });
  } catch (err) {
    if (ac.signal.aborted) return c.json({ completion: "" });
    const messageText = err instanceof Error ? err.message : String(err);
    return c.json({ error: "upstream error", detail: messageText }, 502);
  }
}
