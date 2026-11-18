/**
 * Server-owned agent policy: the system prompt and the tool allowlist the proxy
 * sends upstream. Clients only supply the conversation — anything they send as
 * `system` / `tools` is ignored, so a signed-in user can't turn the proxy into a
 * general-purpose Claude endpoint (custom prompts, arbitrary or server-side tools).
 *
 * Keep in sync with the editor's local agent loop
 * (celiador-editor/extensions/celiador-ai/src/extension.ts: SYSTEM_PROMPT / TOOLS),
 * which executes these tools on the user's workspace.
 */

export const SYSTEM_PROMPT = `You are Celiador, an AI coding agent embedded in the user's editor. You work directly on the code in their open workspace.

- Use the tools to explore and edit the real files: list_files, read_file, write_file. All paths are relative to the workspace root; you cannot access anything outside it.
- When the user asks for a change, make it by writing files — the user reviews your edits through source control.
- Keep edits minimal and focused on what was asked. Don't refactor or add abstractions beyond the request.
- Lead with the outcome. After finishing, give a short summary of what you changed and why.`;

export const TOOLS = [
  {
    name: "list_files",
    description:
      "List files in the current workspace (recursively), optionally under a subdirectory. Returns paths relative to the workspace root. Skips node_modules, .git, and build output.",
    input_schema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Subdirectory relative to the workspace root. Omit for the whole workspace." },
      },
    },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file (max 512 KB). Path is relative to the workspace root.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a file with the given contents (creating parent directories). Path is relative to the workspace root. The user reviews changes via source control; writes to .git and node_modules are refused.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
] as const;

const TOOL_NAMES = new Set<string>(TOOLS.map((t) => t.name));

/** Content-block types a client may replay in the conversation. */
const ALLOWED_BLOCKS = new Set(["text", "tool_use", "tool_result", "thinking", "redacted_thinking"]);

/** Hard caps on what one proxied request may carry. */
export const MAX_MESSAGES = 400;

/**
 * Validate the client-supplied conversation. Returns an error string, or null if
 * it's acceptable: user/assistant turns only, known block types only, and every
 * tool_use must name an allowlisted tool.
 */
export function validateMessages(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array";
  if (messages.length > MAX_MESSAGES) return `too many messages (max ${MAX_MESSAGES})`;
  for (const m of messages) {
    if (!m || typeof m !== "object") return "bad message";
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return "bad message role";
    if (typeof content === "string") continue;
    if (!Array.isArray(content)) return "bad message content";
    for (const block of content) {
      if (!block || typeof block !== "object") return "bad content block";
      const { type, name } = block as { type?: unknown; name?: unknown };
      if (typeof type !== "string" || !ALLOWED_BLOCKS.has(type)) return `content block type not allowed: ${String(type)}`;
      if (type === "tool_use" && (typeof name !== "string" || !TOOL_NAMES.has(name))) return "tool not allowed";
    }
  }
  return null;
}

/**
 * First-party "gateway" mode caps (see gateway.ts). Unlike the locked proxy, the
 * gateway forwards the CALLER's own system prompt + tool schemas (the Claude Agent
 * SDK's ~40-tool set), so the only guards here are structural: bound the shape so
 * one request can't ship an unbounded payload upstream on the daemon's paid key.
 * The tools never execute on the daemon — they run in the caller's workspace /
 * runner sandbox — so arbitrary tool *schemas* are inert data, not an exec risk.
 */
export const GATEWAY_MAX_TOOLS = Number(process.env.CELIADOR_GATEWAY_MAX_TOOLS || 100);
export const GATEWAY_MAX_TOOLS_BYTES = Number(process.env.CELIADOR_GATEWAY_MAX_TOOLS_BYTES || 512 * 1024);
export const GATEWAY_MAX_SYSTEM_BYTES = Number(process.env.CELIADOR_GATEWAY_MAX_SYSTEM_BYTES || 256 * 1024);

function utf8Bytes(v: unknown): number {
  return Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8");
}

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Anthropic-defined tool types that run in the CALLER's workspace (the client
 * executes them, like custom tools), so they cost tokens only. Everything else
 * with a `type` — web_search_*, web_fetch_*, code_execution_*, tool_search_*,
 * MCP toolsets, … — runs on Anthropic's side and is billed per use, outside the
 * per-user dollar budget, so the gateway refuses it. CELIADOR_GATEWAY_SERVER_TOOLS
 * (comma-separated type prefixes, e.g. "web_search_") lets an operator opt in.
 */
const CLIENT_TOOL_TYPE_PREFIXES = ["bash_", "text_editor_", "computer_", "memory_"];

export function gatewayToolAllowed(tool: { type?: unknown }): boolean {
  const { type } = tool;
  if (type === undefined || type === "custom") return true;
  if (typeof type !== "string") return false;
  return [...CLIENT_TOOL_TYPE_PREFIXES, ...listFromEnv("CELIADOR_GATEWAY_SERVER_TOOLS")].some((p) => type.startsWith(p));
}

/**
 * Body fields that switch on server-side, per-use-billed features with no tool
 * entry of their own (the MCP connector; code-execution / skills containers).
 */
const GATEWAY_REFUSED_FIELDS = ["mcp_servers", "container"];

/**
 * `anthropic-beta` values the gateway forwards (prefix match, so dated variants
 * pass). These only change the request/stream shape or caching, which the
 * daemon already prices; betas that enable billed server features or a
 * different price tier (1M context, code execution, MCP client, files, skills, …)
 * are dropped. CELIADOR_GATEWAY_BETAS replaces the list.
 */
const DEFAULT_GATEWAY_BETAS = [
  "claude-code-",
  "interleaved-thinking-",
  "fine-grained-tool-streaming-",
  "token-efficient-tools-",
  "context-management-",
  "prompt-caching-",
  "extended-cache-ttl-",
  "effort-",
  "output-128k-",
  "structured-outputs-",
];

/** Filter a comma-separated `anthropic-beta` header; undefined when nothing survives. */
export function allowedBetas(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const configured = listFromEnv("CELIADOR_GATEWAY_BETAS");
  const allow = configured.length > 0 ? configured : DEFAULT_GATEWAY_BETAS;
  const kept = header
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b && allow.some((p) => b.startsWith(p)));
  return kept.length > 0 ? kept.join(",") : undefined;
}

/**
 * Validate a passthrough (gateway) request body: an Anthropic /v1/messages shape.
 * Checks structure and size, and refuses server-side (per-use billed) tools —
 * but NOT the caller's own client-side tool schemas (that's the whole point of
 * gateway mode). Returns an error string, or null when acceptable.
 */
export function validateGatewayRequest(body: {
  messages?: unknown;
  system?: unknown;
  tools?: unknown;
  [field: string]: unknown;
}): string | null {
  const { messages, system, tools } = body;
  for (const field of GATEWAY_REFUSED_FIELDS) {
    if (body[field] !== undefined) return `${field} is not allowed through the gateway`;
  }
  if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array";
  if (messages.length > MAX_MESSAGES) return `too many messages (max ${MAX_MESSAGES})`;
  for (const m of messages) {
    if (!m || typeof m !== "object") return "bad message";
    const { role, content } = m as { role?: unknown; content?: unknown };
    // The Claude Agent SDK also sends `system`-role turns (e.g. reminders, compaction);
    // the caller's system prompt is already forwarded in gateway mode, so allowing them
    // widens nothing — upstream validates the conversation itself.
    if (role !== "user" && role !== "assistant" && role !== "system") return `bad message role: ${String(role).slice(0, 32)}`;
    if (typeof content !== "string" && !Array.isArray(content)) return "bad message content";
    // Block types are intentionally NOT allowlisted here — the SDK legitimately
    // sends server_tool_use, web_search_tool_result, image, document, etc.
  }
  if (system !== undefined) {
    if (typeof system !== "string" && !Array.isArray(system)) return "bad system prompt";
    if (utf8Bytes(system) > GATEWAY_MAX_SYSTEM_BYTES) return "system prompt too large";
  }
  if (tools !== undefined) {
    if (!Array.isArray(tools)) return "tools must be an array";
    if (tools.length > GATEWAY_MAX_TOOLS) return `too many tools (max ${GATEWAY_MAX_TOOLS})`;
    if (utf8Bytes(tools) > GATEWAY_MAX_TOOLS_BYTES) return "tools payload too large";
    for (const t of tools) {
      if (!t || typeof t !== "object") return "bad tool definition";
      const { name } = t as { name?: unknown };
      if (typeof name !== "string" || !name) return "tool missing name";
      if (!gatewayToolAllowed(t as { type?: unknown })) {
        return `server tool not allowed: ${String((t as { type?: unknown }).type).slice(0, 64)}`;
      }
    }
  }
  return null;
}
