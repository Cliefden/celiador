/**
 * Proves the cloud-runner sandbox's isolation on a real Docker host, without a
 * model: starts a container with EXACTLY the daemon's `docker run` flags
 * (dockerRunArgs), but runs a probe instead of Claude Code, against a fake
 * gateway on the per-run Unix socket. Run on the box (Linux; Docker Desktop on
 * macOS can't pass a host Unix socket into its VM):
 *
 *   docker build -t celiador-runner:1 runner-image && npx tsx scripts/sandbox-check.ts
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { dockerRunArgs, SANDBOX_IMAGE } from "../src/runner/sandbox.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "celiador-sandbox-check-"));
const workspace = path.join(root, "repo");
const gw = path.join(root, "gw");
fs.mkdirSync(workspace);
fs.mkdirSync(gw, { mode: 0o700 });
const sock = path.join(gw, "gw.sock");

// Fake gateway: any HTTP request on the socket gets "gw-ok".
const server = net.createServer((s) => {
  s.once("data", () => s.end("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 5\r\nconnection: close\r\n\r\ngw-ok"));
});
await new Promise<void>((r) => server.listen(sock, () => r()));
fs.chmodSync(sock, 0o600);

const probe = [
  `echo "uid=$(id -u)"`,
  `touch /workspace/written && echo "workspace=writable"`,
  `(touch /etc/celiador-probe 2>/dev/null && echo "rootfs=WRITABLE") || echo "rootfs=read-only"`,
  `node -e "fetch('https://api.anthropic.com',{signal:AbortSignal.timeout(5000)}).then(()=>console.log('egress=OPEN'),()=>console.log('egress=blocked'))"`,
  `node -e "fetch('http://127.0.0.1:8080/probe').then(r=>r.text()).then(t=>console.log('gateway='+t),e=>console.log('gateway=FAILED '+e.message))"`,
  `echo "claude=$(claude --version 2>/dev/null | head -1)"`,
].join("; ");

const args = dockerRunArgs({
  name: `celiador-sandbox-check-${process.pid}`,
  workspaceDir: workspace,
  gatewayDir: gw,
  uid: process.getuid?.() ?? 1000,
  gid: process.getgid?.() ?? 1000,
  token: "not-a-real-token",
  prompt: "unused",
});
// Same flags; just swap the agent for the probe (the entrypoint honours CELIADOR_SANDBOX_EXEC).
args.splice(args.indexOf(SANDBOX_IMAGE), 0, "-e", `CELIADOR_SANDBOX_EXEC=${probe}`);
// CELIADOR_CHECK_SUDO=1 runs docker through sudo (the probe still uses this user's uid), for hosts where
// the daemon user is deliberately not in the docker group.
const useSudo = process.env.CELIADOR_CHECK_SUDO === "1";
// Async on purpose: the fake gateway above lives in this process and must keep answering while the container runs.
const result = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
  const child = spawn(useSudo ? "sudo" : "docker", useSudo ? ["-n", "docker", ...args] : args);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
  child.on("close", () => { clearTimeout(timer); resolve({ stdout, stderr }); });
});
server.close();

const out = `${result.stdout}`;
console.log(out.trim());
if (result.stderr.trim()) console.error(result.stderr.trim());
const expect: Array<[string, boolean]> = [
  ["runs as a non-root uid", /uid=(?!0\b)\d+/.test(out)],
  ["workspace is writable", out.includes("workspace=writable") && fs.existsSync(path.join(workspace, "written"))],
  ["root filesystem is read-only", out.includes("rootfs=read-only")],
  ["no network egress", out.includes("egress=blocked")],
  ["gateway reachable through the socket bridge", out.includes("gateway=gw-ok")],
  ["Claude Code is installed", /claude=\d/.test(out)],
];
let failed = 0;
for (const [name, pass] of expect) {
  console.log(`${pass ? "  ok " : "  FAIL"} - ${name}`);
  if (!pass) failed++;
}
fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${expect.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
