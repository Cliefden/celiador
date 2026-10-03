import fs from "node:fs";
import path from "node:path";
import type { SessionEventInput } from "../sessions/types";

/** What an agent implementation gets: a cloned workspace, the task, and a relay publisher. */
export interface IRunnerAgentContext {
  readonly workspaceDir: string;
  readonly prompt: string;
  /** Publish a relay event (activity/tool/toolResult/delta/message/…) to watchers. */
  readonly publish: (event: SessionEventInput) => void;
}

/** A server-run agent: do the work in the workspace, narrating via `publish`. */
export type RunnerAgent = (ctx: IRunnerAgentContext) => Promise<void>;

/**
 * Phase 3a placeholder agent. Deterministic (no LLM, no key, no bash) so the whole
 * server-run pipeline — create → clone → run → diff → relay → cleanup — is provable
 * in-process. It drops a note file describing the task; `computeDiffs` then surfaces
 * it as a real diff. The real agent (the Claude Agent SDK / a gateway-backed loop
 * with a sandboxed toolset) replaces this in 3b and MUST run isolated before it can
 * execute untrusted model-driven bash/edits.
 */
export const placeholderAgent: RunnerAgent = async (ctx) => {
  const file = "CELIADOR_SERVER_RUN.md";
  ctx.publish({ kind: "tool", callId: "note-1", name: "write_file", input: { path: file } });
  await fs.promises.writeFile(
    path.join(ctx.workspaceDir, file),
    `# Celiador server run\n\nThis file was written by a server-side agent run.\n\n## Task\n\n${ctx.prompt}\n`,
    "utf8",
  );
  ctx.publish({ kind: "toolResult", callId: "note-1", ok: true });
};
