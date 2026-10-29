import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { mintRunnerToken } from "../auth";
import { HOST, PORT } from "../config";
import type { SessionEventInput } from "../sessions/types";
import type { RunnerAgent } from "./agent";

const execFileP = promisify(execFile);

/**
 * Phase 3b: the real cloud agent, one locked-down container per run.
 *
 * The container runs Claude Code headless (`claude -p … --output-format
 * stream-json`) in the run's cloned workspace. Isolation, from the outside in:
 *
 * - `--network none`: no egress at all — not the internet, not the box, not
 *   other containers. The only way out is a Unix socket the daemon creates for
 *   this run and mounts in; a tiny bridge inside the container exposes it as
 *   127.0.0.1:8080, and the daemon side forwards it to the daemon's own
 *   Anthropic gateway. So the agent can talk to the model and nothing else.
 * - Auth to the gateway is a runner token minted for this user and run (2 h),
 *   so model usage meters against the user's quota like any other request, and
 *   the token is useless outside this run's gateway path.
 * - Read-only root filesystem, tmpfs for /tmp and $HOME, all capabilities
 *   dropped, no-new-privileges, the daemon's own non-root uid, CPU / memory /
 *   pid caps, a wall-clock limit, and `docker kill` on cancel.
 * - Only the run's own workspace is writable; it's the daemon-owned clone the
 *   diff is computed from afterwards, exactly as with the placeholder agent.
 *
 * Opt-in: the daemon uses this agent only when CELIADOR_RUNNER_AGENT=sandbox
 * (manager.ts). The image is built from runner-image/ (see its README).
 */

export const SANDBOX_IMAGE = process.env.CELIADOR_RUNNER_IMAGE ?? "celiador-runner:1";
const TIMEOUT_MS = Number(process.env.CELIADOR_RUNNER_TIMEOUT_MS || 30 * 60_000);
const MAX_TURNS = Number(process.env.CELIADOR_RUNNER_MAX_TURNS || 60);

/** Map one line of Claude Code's `stream-json` output to relay events. Pure; exported for tests. */
export function streamLineToEvents(line: string): SessionEventInput[] {
  let msg: { type?: string; subtype?: string; is_error?: boolean; result?: unknown; message?: { content?: unknown } };
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  const blocks = Array.isArray(msg?.message?.content) ? (msg.message!.content as Array<Record<string, unknown>>) : [];
  const events: SessionEventInput[] = [];
  if (msg.type === "assistant") {
    for (const b of blocks) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        events.push({ kind: "message", role: "assistant", text: b.text });
      } else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
        events.push({ kind: "tool", callId: b.id, name: b.name, input: b.input ?? {} });
      }
    }
  } else if (msg.type === "user") {
    for (const b of blocks) {
      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        events.push({ kind: "toolResult", callId: b.tool_use_id, ok: b.is_error !== true });
      }
    }
  }
  return events;
}

/** The final `result` line's verdict, if this line is one. Pure; exported for tests. */
export function streamLineResult(line: string): { ok: boolean; text: string } | undefined {
  try {
    const msg = JSON.parse(line) as { type?: string; subtype?: string; is_error?: boolean; result?: unknown };
    if (msg.type !== "result") return undefined;
    const ok = msg.subtype === "success" && msg.is_error !== true;
    return { ok, text: typeof msg.result === "string" ? msg.result : String(msg.subtype ?? "") };
  } catch {
    return undefined;
  }
}

/**
 * Bridge a per-run Unix socket to the daemon's own HTTP port. Raw byte piping —
 * the gateway's normal auth, quota and logging apply unchanged.
 */
async function openGatewaySocket(socketPath: string): Promise<net.Server> {
  await fs.promises.rm(socketPath, { force: true });
  const target = { host: HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST, port: PORT };
  const server = net.createServer((inbound) => {
    const outbound = net.connect(target);
    inbound.pipe(outbound).pipe(inbound);
    const close = () => { inbound.destroy(); outbound.destroy(); };
    inbound.on("error", close);
    outbound.on("error", close);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await fs.promises.chmod(socketPath, 0o600);
  return server;
}

/** The `docker run` argv for one run. Pure; exported so tests can pin the isolation flags. */
export function dockerRunArgs(p: { name: string; workspaceDir: string; gatewayDir: string; uid: number; gid: number; token: string; prompt: string }): string[] {
  return [
    "run", "--rm", "--name", p.name,
    "--network", "none",
    "--read-only",
    "--tmpfs", "/tmp:rw,size=512m",
    "--tmpfs", "/home/runner:rw,mode=1777,size=256m",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "512",
    "--cpus", "1.5",
    "--memory", "3g",
    "--user", `${p.uid}:${p.gid}`,
    "-e", "HOME=/home/runner",
    "-e", "ANTHROPIC_BASE_URL=http://127.0.0.1:8080/api/anthropic",
    "-e", `ANTHROPIC_AUTH_TOKEN=${p.token}`,
    "-e", "DISABLE_AUTOUPDATER=1",
    "-e", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
    "-v", `${p.workspaceDir}:/workspace`,
    "-v", `${p.gatewayDir}:/run/celiador`,
    "-w", "/workspace",
    SANDBOX_IMAGE,
    "-p", p.prompt,
    "--output-format", "stream-json",
    "--verbose",
    // The container IS the permission boundary: no network, nothing writable but the workspace.
    "--dangerously-skip-permissions",
    "--max-turns", String(MAX_TURNS),
  ];
}

/** Whether Docker and the runner image are available — checked before a sandboxed run starts. */
export async function sandboxAvailable(): Promise<string | undefined> {
  try {
    await execFileP("docker", ["image", "inspect", SANDBOX_IMAGE], { timeout: 15_000 });
    return undefined;
  } catch {
    return `the cloud runner isn't set up on this server (docker image ${SANDBOX_IMAGE} missing)`;
  }
}

export const sandboxAgent: RunnerAgent = async (ctx) => {
  const unavailable = await sandboxAvailable();
  if (unavailable) throw new Error(unavailable);
  const token = mintRunnerToken(ctx.userId, ctx.runId, 2 * 60 * 60);
  if (!token) throw new Error("cloud runs need SUPABASE_JWT_SECRET to mint a runner token");

  const runDir = path.dirname(ctx.workspaceDir);
  const gatewayDir = path.join(runDir, "gw");
  await fs.promises.mkdir(gatewayDir, { recursive: true, mode: 0o700 });
  const server = await openGatewaySocket(path.join(gatewayDir, "gw.sock"));
  const name = `celiador-run-${ctx.runId}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 60);
  const kill = () => { execFile("docker", ["kill", name], () => undefined); };

  try {
    const child = spawn("docker", dockerRunArgs({
      name,
      workspaceDir: ctx.workspaceDir,
      gatewayDir,
      uid: process.getuid?.() ?? 1000,
      gid: process.getgid?.() ?? 1000,
      token,
      prompt: ctx.prompt,
    }), { stdio: ["ignore", "pipe", "pipe"] });

    const timer = setTimeout(kill, TIMEOUT_MS);
    const onAbort = () => kill();
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    let result: { ok: boolean; text: string } | undefined;
    let stderrTail = "";
    child.stderr.on("data", (d: Buffer) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });
    const lines = readline.createInterface({ input: child.stdout });
    for await (const line of lines) {
      for (const event of streamLineToEvents(line)) ctx.publish(event);
      result = streamLineResult(line) ?? result;
    }
    const code: number | null = await new Promise((resolve) => child.once("close", resolve));
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onAbort);

    if (ctx.signal.aborted) throw new Error("cancelled");
    if (!result) {
      throw new Error(`the agent exited (${code}) without a result${stderrTail ? `: ${stderrTail.trim().split("\n").pop()}` : ""}`);
    }
    if (!result.ok) throw new Error(`the agent stopped: ${result.text || "error"}`);
  } finally {
    server.close();
    await fs.promises.rm(gatewayDir, { recursive: true, force: true });
  }
};
