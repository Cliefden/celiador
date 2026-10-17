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
process.env.CELIADOR_RELEASES_DIR = path.join(HOME, "releases");
process.env.CELIADOR_PUBLIC_URL = "https://smoke.test/";

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
	// The published limits are public and are the same object /api/me returns.
	const limitsRes = await app.request("http://localhost/api/limits");
	const published = (await limitsRes.json()) as { model?: string; limits?: Record<string, number> };
	ok("GET /api/limits is public with the enforced numbers", limitsRes.status === 200 && published.model === AGENT_MODEL && typeof published.limits?.dailyRequests === "number" && typeof published.limits?.rpm === "number", JSON.stringify(published));
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

	// ── Run review (git over the relay) ──────────────────────────────────────
	console.log("\n== git review ==");
	const G = `http://localhost/api/sessions/${sid}/git`;
	const offline = await app.request(`${G}/status`, { headers: authH });
	ok("git status with runner offline → 409", offline.status === 409, `got ${offline.status}`);
	const noMsg = await app.request(`${G}/commit`, { method: "POST", headers: authH, body: JSON.stringify({ message: "  " }) });
	ok("commit without a message → 400", noMsg.status === 400, `got ${noMsg.status}`);
	const noPaths = await app.request(`${G}/revert`, { method: "POST", headers: authH, body: JSON.stringify({}) });
	ok("revert without paths → 400", noPaths.status === 400, `got ${noPaths.status}`);
	const noTitle = await app.request(`${G}/pr`, { method: "POST", headers: authH, body: JSON.stringify({ title: " " }) });
	ok("pr without a title → 400", noTitle.status === 400, `got ${noTitle.status}`);
	const pushOffline = await app.request(`${G}/push`, { method: "POST", headers: authH });
	ok("push with runner offline → 409", pushOffline.status === 409, `got ${pushOffline.status}`);

	// Full round-trip: attach a fake runner on the real SSE command channel, let it
	// answer the relayed git.status / git.push / git.pr with fs.results, and check
	// the HTTP replies (incl. the compare-URL fallback for a PR without GitHub sign-in).
	const runnerAbort = new AbortController();
	const cmdStream = await app.request(`http://localhost/api/sessions/${sid}/commands`, { headers: authH, signal: runnerAbort.signal } as RequestInit);
	const fakeRunner = (async () => {
		const reader = cmdStream.body!.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) { return; }
			buf += decoder.decode(value, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (!payload) continue;
				const cmd = JSON.parse(payload) as { kind?: string; requestId?: string; title?: string; body?: string; base?: string };
				if (!cmd.requestId) continue;
				const reply = (result: Record<string, unknown>) => app.request(`http://localhost/api/sessions/${sid}/events`, {
					method: "POST", headers: authH,
					body: JSON.stringify({ kind: "fs.result", requestId: cmd.requestId, ...result }),
				});
				if (cmd.kind === "git.status") {
					await reply({ ok: true, branch: "main", files: [{ path: "a.ts", status: "M" }] });
				} else if (cmd.kind === "git.push") {
					await reply({ ok: true, branch: "feat/x", remote: "origin" });
				} else if (cmd.kind === "git.pr") {
					seenPr.push(cmd);
					if (seenPr.length === 1) {
						await reply({ ok: true, url: "https://github.com/Cliefden/daemon/pull/99", created: true });
					} else {
						// No GitHub sign-in in the editor → compare page, not an error.
						await reply({ ok: true, url: "https://github.com/Cliefden/daemon/compare/main...feat/x?expand=1", created: false });
						return;
					}
				}
			}
		}
	})();
	const seenPr: Array<{ title?: string; body?: string; base?: string }> = [];
	// Give the stream a tick to attach as the runner, then ask for status.
	await new Promise((r) => setTimeout(r, 50));
	const statusRes = await app.request(`${G}/status`, { headers: authH });
	const status = (await statusRes.json()) as { branch?: string; files?: Array<{ path: string; status: string }> };
	ok("git status round-trip → 200 with payload", statusRes.status === 200 && status.branch === "main" && status.files?.[0]?.path === "a.ts", JSON.stringify(status));
	const pushRes = await app.request(`${G}/push`, { method: "POST", headers: authH });
	const pushed = (await pushRes.json()) as { ok?: boolean; branch?: string; remote?: string };
	ok("git push round-trip → 200 with branch + remote", pushRes.status === 200 && pushed.branch === "feat/x" && pushed.remote === "origin", JSON.stringify(pushed));
	const prRes = await app.request(`${G}/pr`, { method: "POST", headers: authH, body: JSON.stringify({ title: "  Add x  ", body: "Does x." }) });
	const pr = (await prRes.json()) as { url?: string; created?: boolean };
	ok("git pr round-trip → 200 with url", prRes.status === 200 && pr.url === "https://github.com/Cliefden/daemon/pull/99" && pr.created === true, JSON.stringify(pr));
	ok("git pr relays a trimmed title + body, no base", seenPr[0]?.title === "Add x" && seenPr[0]?.body === "Does x." && seenPr[0]?.base === undefined, JSON.stringify(seenPr[0]));
	const compareRes = await app.request(`${G}/pr`, { method: "POST", headers: authH, body: JSON.stringify({ title: "Add x", base: " main " }) });
	const compare = (await compareRes.json()) as { url?: string; created?: boolean };
	ok("git pr compare-URL fallback → 200 with created:false", compareRes.status === 200 && compare.created === false && compare.url?.includes("/compare/") === true, JSON.stringify(compare));
	ok("git pr relays a trimmed base", seenPr[1]?.base === "main", JSON.stringify(seenPr[1]));
	await fakeRunner;
	runnerAbort.abort();

	// ── Presence (editor → phone repo picker) ────────────────────────────────
	console.log("\n== presence ==");
	const PR = "http://localhost/api/presence/workspaces";
	const put = await app.request(PR, {
		method: "PUT", headers: authH,
		body: JSON.stringify({
			clientId: "editor-a",
			workspaces: [
				{ name: "celiador", remoteUrl: "https://github.com/Cliefden/celiador.git", branch: "main" },
				{ name: "insecure", remoteUrl: "http://example.com/x.git" }, // non-https → filtered
			],
		}),
	});
	ok("heartbeat → 200, non-https filtered", put.status === 200 && ((await put.json()) as { count?: number }).count === 1, `got ${put.status}`);
	await app.request(PR, {
		method: "PUT", headers: authH,
		body: JSON.stringify({ clientId: "editor-b", workspaces: [{ name: "celiador", remoteUrl: "https://github.com/Cliefden/celiador.git" }] }),
	});
	const list = ((await (await app.request(PR, { headers: authH })).json()) as { workspaces: Array<{ remoteUrl: string; branch?: string }> }).workspaces;
	ok("list de-duped across editors", list.length === 1 && list[0].remoteUrl === "https://github.com/Cliefden/celiador.git", JSON.stringify(list));
	const noClient = await app.request(PR, { method: "PUT", headers: authH, body: JSON.stringify({ workspaces: [] }) });
	ok("missing clientId → 400", noClient.status === 400, `got ${noClient.status}`);

	// Editor run-requests ("Run on your editor"): validation, no-editor 409, and fan-out.
	const RQ = "http://localhost/api/presence/requests";
	const badReq = await app.request(RQ, { method: "POST", headers: authH, body: JSON.stringify({ prompt: "hi" }) });
	ok("run request without a repo → 400", badReq.status === 400, `got ${badReq.status}`);
	const noEditor = await app.request(RQ, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: "https://github.com/Cliefden/celiador.git", prompt: "check the code" }) });
	ok("run request with no editor online → 409", noEditor.status === 409, `got ${noEditor.status}`);
	const { editorControl } = await import("../src/presence/control.ts");
	const received: Array<Record<string, unknown>> = [];
	const unsub = editorControl.subscribe("smoke-user", (cmd) => received.push(cmd as unknown as Record<string, unknown>));
	const okReq = await app.request(RQ, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: "https://github.com/Cliefden/celiador.git", name: "celiador", branch: "main", prompt: "check the code" }) });
	ok("run request with editor online → 200", okReq.status === 200, `got ${okReq.status}`);
	ok("editor received a start-run command", received.length === 1 && received[0].kind === "start-run" && received[0].prompt === "check the code" && received[0].branch === "main");
	const emptyReq = await app.request(RQ, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: "https://github.com/Cliefden/celiador.git" }) });
	ok("run request with no prompt → 200 (opens an idle chat)", emptyReq.status === 200, `got ${emptyReq.status}`);
	ok("empty-prompt start-run has an empty prompt", received.length === 2 && received[1].prompt === "");
	unsub();

	// ── Releases (editor update feed + downloads) ────────────────────────────
	console.log("\n== releases ==");
	const relDir = path.join(HOME, "releases");
	fs.mkdirSync(relDir, { recursive: true });
	fs.writeFileSync(path.join(relDir, "Celiador-darwin-arm64-1.0.1.zip"), "zip-bytes");
	fs.writeFileSync(path.join(relDir, "secret.txt"), "nope");
	const OLD = "0123456789abcdef0123456789abcdef01234567";
	const NEW = "fedcba9876543210fedcba9876543210fedcba98";
	const sha = "a".repeat(64);
	fs.writeFileSync(path.join(relDir, "manifest.json"), JSON.stringify({
		releases: [
			{ platform: "darwin-arm64", quality: "stable", version: OLD, productVersion: "1.0.0", timestamp: 1_700_000_000_000, archive: "Celiador-darwin-arm64-1.0.0.zip", archiveSha256: sha, dmg: "Celiador-darwin-arm64-1.0.0.dmg", dmgSha256: sha },
			{ platform: "darwin-arm64", quality: "stable", version: NEW, productVersion: "1.0.1", timestamp: 1_700_000_001_000, archive: "Celiador-darwin-arm64-1.0.1.zip", archiveSha256: sha, dmg: "Celiador-darwin-arm64-1.0.1.dmg", dmgSha256: sha },
			{ platform: "darwin-arm64", quality: "stable", version: "bad", archive: "../etc/passwd" }, // invalid → skipped
		],
	}));
	const U = "http://localhost/api/update/darwin-arm64/stable";
	const upd = await app.request(`${U}/${OLD}`);
	const updBody = (await upd.json()) as { url?: string; version?: string; productVersion?: string; sha256hash?: string };
	ok("older known commit → 200 with the newest build", upd.status === 200 && updBody.version === NEW && updBody.productVersion === "1.0.1" && updBody.sha256hash === sha, JSON.stringify(updBody));
	ok("update url is absolute on CELIADOR_PUBLIC_URL", updBody.url === "https://smoke.test/api/releases/Celiador-darwin-arm64-1.0.1.zip", String(updBody.url));
	ok("newest commit → 204", (await app.request(`${U}/${NEW}`)).status === 204);
	ok("unknown (dev) commit → 204", (await app.request(`${U}/${"c".repeat(40)}`)).status === 204);
	ok("platform without releases → 204", (await app.request(`http://localhost/api/update/linux-x64/stable/${OLD}`)).status === 204);
	ok("malformed commit → 400", (await app.request(`${U}/not-a-commit`)).status === 400);
	const R = "http://localhost/api/releases";
	const listRes = await app.request(R);
	const listed = ((await listRes.json()) as { releases: Array<{ version: string; dmgUrl?: string }> }).releases;
	ok("list: valid entries only, newest first, with urls", listRes.status === 200 && listed.length === 2 && listed[0].version === NEW && listed[0].dmgUrl === "https://smoke.test/api/releases/Celiador-darwin-arm64-1.0.1.dmg", JSON.stringify(listed));
	const latest = (await (await app.request(`${R}/latest/darwin-arm64/stable`)).json()) as { version?: string };
	ok("latest descriptor", latest.version === NEW, JSON.stringify(latest));
	const redir = await app.request(`${R}/latest/darwin-arm64/stable/dmg`, { redirect: "manual" });
	ok("latest/dmg → 302 to the file", redir.status === 302 && redir.headers.get("location") === "https://smoke.test/api/releases/Celiador-darwin-arm64-1.0.1.dmg", `${redir.status} ${redir.headers.get("location")}`);
	ok("latest for an unpublished platform → 404", (await app.request(`${R}/latest/linux-x64/stable`)).status === 404);
	const dl = await app.request(`${R}/Celiador-darwin-arm64-1.0.1.zip`);
	ok("download → 200 with length + zip content-type", dl.status === 200 && dl.headers.get("content-length") === "9" && dl.headers.get("content-type") === "application/zip" && (await dl.text()) === "zip-bytes", `got ${dl.status}`);
	const head = await app.request(`${R}/Celiador-darwin-arm64-1.0.1.zip`, { method: "HEAD" });
	ok("HEAD → 200 with length, no body", head.status === 200 && head.headers.get("content-length") === "9" && (await head.text()) === "", `got ${head.status}`);
	ok("listed but missing on disk → 404", (await app.request(`${R}/Celiador-darwin-arm64-1.0.0.zip`)).status === 404);
	ok("unlisted file in the dir → 404", (await app.request(`${R}/secret.txt`)).status === 404);
	ok("manifest itself is not downloadable", (await app.request(`${R}/manifest.json`)).status === 404);
	ok("path traversal → 404", (await app.request(`${R}/..%2Fmanifest.json`)).status === 404);

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
	// The run ends with `done` plus a terminal `state: done` event — only state
	// events move Session.state, so without it a finished run would stay "running".
	const last = runEvents[runEvents.length - 1] as { kind?: unknown; state?: unknown };
	ok(
		"run sequence state→…→done",
		kinds[0] === "state" && kinds.includes("diff") && kinds.includes("done") && last.kind === "state" && last.state === "done",
		kinds.join(">")
	);
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
