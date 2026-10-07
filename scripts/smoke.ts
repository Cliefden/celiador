/**
 * In-process smoke test for the daemon's agent backbone: the first-party gateway,
 * the session relay (incl. the widened approval schema), and the server runner. Runs
 * the real `createApp()` app with a stubbed Anthropic upstream and an offline local
 * git repo — no network, no real key. Run: `npm run smoke`.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Env must be set before the daemon modules read it at import time → dynamic import below.
const HOME = path.join(os.tmpdir(), `celiador-smoke-${process.pid}`);
process.env.SUPABASE_JWT_SECRET ??= "smoke-secret";
process.env.ANTHROPIC_API_KEY ??= "sk-smoke";
process.env.CELIADOR_HOME = HOME;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = ""): void {
	if (cond) { pass++; console.log(`  ok  - ${name}`); }
	else { fail++; console.log(`FAIL  - ${name} ${extra}`); }
}

async function main(): Promise<void> {
	fs.mkdirSync(HOME, { recursive: true });

	// Stub the Anthropic upstream the gateway forwards to.
	let gwBody: Record<string, unknown> | null = null;
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (url: unknown, init: { body?: string } = {}) => {
		if (String(url).includes("/v1/messages")) {
			gwBody = JSON.parse(init.body ?? "{}");
			const sse = `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\n`
				+ `event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n`;
			return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
		}
		return (realFetch as typeof fetch)(url as string, init as RequestInit);
	}) as typeof fetch;

	const { createApp } = await import("../src/app.ts");
	const { mintRunnerToken } = await import("../src/auth.ts");
	const { AGENT_MODEL } = await import("../src/config.ts");
	const { executeServerRun } = await import("../src/runner/run.ts");
	const { runsRoot } = await import("../src/runner/workspace.ts");

	const app = createApp();
	const token = mintRunnerToken("smoke-user", "smoke-run", 300)!;
	const authH = { "content-type": "application/json", authorization: `Bearer ${token}` };

	// ── Gateway ──────────────────────────────────────────────────────────────
	console.log("\n== gateway ==");
	const GW = "http://localhost/api/anthropic/v1/messages";
	const noAuth = await app.request(GW, { method: "POST", headers: { "content-type": "application/json" }, body: '{"messages":[{"role":"user","content":"hi"}]}' });
	ok("no auth → 401", noAuth.status === 401, `got ${noAuth.status}`);
	const body = JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 999999, stream: true, system: "test", tools: [{ name: "bash", input_schema: { type: "object" } }], messages: [{ role: "user", content: "hi" }] });
	const gw = await app.request(GW, { method: "POST", headers: authH, body });
	ok("valid request → 200", gw.status === 200, `got ${gw.status}`);
	await gw.text();
	ok("model forced to AGENT_MODEL", gwBody?.model === AGENT_MODEL, `got ${String(gwBody?.model)}`);
	ok("max_tokens capped", typeof gwBody?.max_tokens === "number" && (gwBody.max_tokens as number) <= 32000);
	ok("caller system + tools forwarded", gwBody?.system === "test" && Array.isArray(gwBody?.tools));

	// ── Relay ────────────────────────────────────────────────────────────────
	console.log("\n== relay ==");
	const rc = await app.request("http://localhost/api/sessions", { method: "POST", headers: authH, body: JSON.stringify({ title: "smoke", origin: "editor", runner: "editor" }) });
	const sid = ((await rc.json()) as { session?: { id?: string } })?.session?.id;
	ok("create session", typeof sid === "string");
	const events = [
		{ kind: "state", state: "running" },
		{ kind: "delta", text: "hello" },
		{ kind: "tool", callId: "c1", name: "bash", input: {} },
		{ kind: "approval", requestId: "c1", approvalKind: "bash", title: "Run ls" },
		{ kind: "done" },
	];
	const pub = await app.request(`http://localhost/api/sessions/${sid}/events`, { method: "POST", headers: authH, body: JSON.stringify(events) });
	ok("publish events (incl. bash approval) → 200", pub.status === 200, `got ${pub.status}`);
	ok("all events validated", ((await pub.json()) as { lastSeq?: number })?.lastSeq === 5);
	const bad = await app.request(`http://localhost/api/sessions/${sid}/events`, { method: "POST", headers: authH, body: JSON.stringify([{ kind: "tool" }]) });
	ok("invalid event → 400", bad.status === 400, `got ${bad.status}`);

	// ── Server runner (offline local repo) ────────────────────────────────────
	console.log("\n== server runner ==");
	const repo = path.join(HOME, "origin");
	fs.mkdirSync(repo, { recursive: true });
	await run("git", ["init", "-q", repo]);
	await run("git", ["-C", repo, "config", "user.email", "s@smoke"]);
	await run("git", ["-C", repo, "config", "user.name", "smoke"]);
	fs.writeFileSync(path.join(repo, "README.md"), "# smoke\n");
	await run("git", ["-C", repo, "add", "-A"]);
	await run("git", ["-C", repo, "commit", "-q", "-m", "init"]);

	const runEvents: Array<Record<string, unknown>> = [];
	await executeServerRun({
		userId: "smoke-user",
		sessionId: "srv-1",
		repo: { url: `file://${repo}` },
		prompt: "leave a note",
		publish: (e) => runEvents.push(e as Record<string, unknown>),
	});
	const kinds = runEvents.map((e) => e.kind);
	ok("run sequence state→…→done", kinds[0] === "state" && kinds.includes("diff") && kinds[kinds.length - 1] === "done", kinds.join(">"));
	ok("no run error", !runEvents.some((e) => e.kind === "error"), String(runEvents.find((e) => e.kind === "error")?.message ?? ""));
	// The run workspace is intentionally RETAINED after the run (so a watcher can
	// browse its files via GET /:id/files); it's reclaimed on session delete /
	// account deletion / boot sweep, not in executeServerRun's finally.
	ok("workspace retained after run", fs.existsSync(path.join(runsRoot(), "smoke-user", "srv-1")));

	console.log(`\n${pass} passed, ${fail} failed`);
}

main()
	.catch((err) => { console.error(err); fail++; })
	.finally(() => {
		fs.rmSync(HOME, { recursive: true, force: true });
		process.exit(fail === 0 ? 0 : 1);
	});
