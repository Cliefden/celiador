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
	// GitHub's REST API, stubbed per section (never the real network): 404 unless a test installs a handler.
	type GhCall = { method: string; path: string; body?: Record<string, unknown> };
	let ghHandler: (call: GhCall) => { status: number; json?: unknown } = () => ({ status: 404, json: { message: "Not Found" } });
	globalThis.fetch = (async (url: unknown, init: { body?: string; method?: string } = {}) => {
		if (String(url).startsWith("https://api.github.com/")) {
			const call: GhCall = { method: init.method ?? "GET", path: String(url).slice("https://api.github.com".length), body: init.body ? JSON.parse(init.body) : undefined };
			const r = ghHandler(call);
			return new Response(JSON.stringify(r.json ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
		}
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
	const published = (await limitsRes.json()) as { model?: string; limits?: Record<string, number>; tasks?: { concurrency?: number } };
	ok("GET /api/limits is public with the enforced numbers", limitsRes.status === 200 && published.model === AGENT_MODEL && typeof published.limits?.dailyRequests === "number" && typeof published.limits?.rpm === "number", JSON.stringify(published));
	ok("GET /api/limits publishes the agent task concurrency", typeof published.tasks?.concurrency === "number", JSON.stringify(published.tasks));
	const body = JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 999999, stream: true, system: "test", tools: [{ name: "bash", input_schema: { type: "object" } }], messages: [{ role: "user", content: "hi" }] });
	const gw = await app.request(GW, { method: "POST", headers: authH, body });
	ok("valid request → 200", gw.status === 200, `got ${gw.status}`);
	await gw.text();
	ok("model forced to AGENT_MODEL", gwBody?.model === AGENT_MODEL, `got ${String(gwBody?.model)}`);
	ok("max_tokens capped", typeof gwBody?.max_tokens === "number" && (gwBody.max_tokens as number) <= 32000);
	ok("caller system + tools forwarded", gwBody?.system === "test" && Array.isArray(gwBody?.tools));
	// A per-turn effort chosen for the caller's model is dropped when the daemon
	// substitutes its own (Anthropic rejects effort on models without it); the
	// rest of output_config survives, and a request for AGENT_MODEL itself keeps it.
	const effortBody = (model: string) => JSON.stringify({ model, max_tokens: 10, stream: true, output_config: { effort: "high", format: { type: "json_schema" } }, messages: [{ role: "user", content: "hi" }] });
	await (await app.request(GW, { method: "POST", headers: authH, body: effortBody("claude-opus-5-5") })).text();
	const cfg = gwBody?.output_config as Record<string, unknown> | undefined;
	ok("effort dropped (format kept) when the model is overridden", cfg !== undefined && !("effort" in cfg) && typeof cfg.format === "object", JSON.stringify(gwBody?.output_config));
	await (await app.request(GW, { method: "POST", headers: authH, body: effortBody(AGENT_MODEL) })).text();
	ok("effort kept for the daemon's own model", (gwBody?.output_config as { effort?: string } | undefined)?.effort === "high", JSON.stringify(gwBody?.output_config));

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
					}
				} else if (cmd.kind === "git.merge") {
					seenMerge.push(cmd);
					if (seenMerge.length === 1) {
						await reply({ ok: true, merged: true, sha: "abc123", url: "https://github.com/Cliefden/daemon/pull/99" });
					} else {
						await reply({ ok: false, merged: false, error: "Pull Request is not mergeable" });
						return;
					}
				}
			}
		}
	})();
	const seenPr: Array<{ title?: string; body?: string; base?: string }> = [];
	const seenMerge: Array<{ method?: string }> = [];
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
	const badMethod = await app.request(`${G}/merge`, { method: "POST", headers: authH, body: JSON.stringify({ method: "fast-forward" }) });
	ok("git merge with a bad method → 400", badMethod.status === 400, `got ${badMethod.status}`);
	const mergeRes = await app.request(`${G}/merge`, { method: "POST", headers: authH, body: JSON.stringify({ method: "squash" }) });
	const merge = (await mergeRes.json()) as { merged?: boolean; sha?: string };
	ok("git merge round-trip → 200 with merged + sha", mergeRes.status === 200 && merge.merged === true && merge.sha === "abc123", JSON.stringify(merge));
	ok("git merge relays the method", seenMerge[0]?.method === "squash", JSON.stringify(seenMerge[0]));
	const notMerged = await app.request(`${G}/merge`, { method: "POST", headers: authH, body: "{}" });
	ok("git merge the editor couldn't do → 409 with its reason", notMerged.status === 409 && ((await notMerged.json()) as { error?: string }).error === "Pull Request is not mergeable", `got ${notMerged.status}`);
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
	fs.writeFileSync(path.join(relDir, "Celiador-linux-x64-1.0.1.deb"), "deb-bytes");
	fs.writeFileSync(path.join(relDir, "secret.txt"), "nope");
	const OLD = "0123456789abcdef0123456789abcdef01234567";
	const NEW = "fedcba9876543210fedcba9876543210fedcba98";
	const sha = "a".repeat(64);
	fs.writeFileSync(path.join(relDir, "manifest.json"), JSON.stringify({
		releases: [
			{ platform: "darwin-arm64", quality: "stable", version: OLD, productVersion: "1.0.0", timestamp: 1_700_000_000_000, archive: "Celiador-darwin-arm64-1.0.0.zip", archiveSha256: sha, dmg: "Celiador-darwin-arm64-1.0.0.dmg", dmgSha256: sha },
			{ platform: "darwin-arm64", quality: "stable", version: NEW, productVersion: "1.0.1", timestamp: 1_700_000_001_000, archive: "Celiador-darwin-arm64-1.0.1.zip", archiveSha256: sha, dmg: "Celiador-darwin-arm64-1.0.1.dmg", dmgSha256: sha },
			// Linux: no dmg; deb/rpm ride `assets`. Timestamps sit between the mac ones so ordering stays deterministic.
			{ platform: "linux-x64", quality: "stable", version: OLD, productVersion: "1.0.0", timestamp: 1_700_000_000_400, archive: "Celiador-linux-x64-1.0.0.tar.gz", archiveSha256: sha },
			{ platform: "linux-x64", quality: "stable", version: NEW, productVersion: "1.0.1", timestamp: 1_700_000_000_500, archive: "Celiador-linux-x64-1.0.1.tar.gz", archiveSha256: sha, assets: { deb: { file: "Celiador-linux-x64-1.0.1.deb", sha256: sha }, rpm: { file: "Celiador-linux-x64-1.0.1.rpm", sha256: sha } } },
			{ platform: "linux-x64", quality: "stable", version: NEW, productVersion: "1.0.2", timestamp: 1_700_000_000_600, archive: "x.tar.gz", archiveSha256: sha, assets: { archive: { file: "y", sha256: sha } } }, // invalid: reserved asset kind → skipped
			{ platform: "darwin-arm64", quality: "stable", version: "bad", archive: "../etc/passwd" }, // invalid → skipped
		],
	}));
	const U = "http://localhost/api/update/darwin-arm64/stable";
	const upd = await app.request(`${U}/${OLD}`);
	const updBody = (await upd.json()) as { url?: string; version?: string; productVersion?: string; sha256hash?: string; notes?: string; pub_date?: string };
	ok("older known commit → 200 with the newest build", upd.status === 200 && updBody.version === NEW && updBody.productVersion === "1.0.1" && updBody.sha256hash === sha, JSON.stringify(updBody));
	ok("Squirrel fields: notes = commit, pub_date ISO", updBody.notes === NEW && updBody.pub_date === new Date(1_700_000_001_000).toISOString(), `${updBody.notes} ${updBody.pub_date}`);
	ok("update url is absolute on CELIADOR_PUBLIC_URL", updBody.url === "https://smoke.test/api/releases/Celiador-darwin-arm64-1.0.1.zip", String(updBody.url));
	ok("newest commit → 204", (await app.request(`${U}/${NEW}`)).status === 204);
	ok("unknown (dev) commit → 204", (await app.request(`${U}/${"c".repeat(40)}`)).status === 204);
	ok("platform without releases → 204", (await app.request(`http://localhost/api/update/win32-x64/stable/${OLD}`)).status === 204);
	ok("malformed commit → 400", (await app.request(`${U}/not-a-commit`)).status === 400);
	const linUpd = (await (await app.request(`http://localhost/api/update/linux-x64/stable/${OLD}`)).json()) as { url?: string; version?: string };
	ok("linux update → newest build, url is the download page (no in-place updater)", linUpd.version === NEW && linUpd.url === "https://smoke.test/download", JSON.stringify(linUpd));
	const R = "http://localhost/api/releases";
	const listRes = await app.request(R);
	const listed = ((await listRes.json()) as { releases: Array<{ platform: string; version: string; dmgUrl?: string; assetUrls?: Record<string, string> }> }).releases;
	ok("list: valid entries only, newest first, with urls", listRes.status === 200 && listed.length === 4 && listed[0].version === NEW && listed[0].dmgUrl === "https://smoke.test/api/releases/Celiador-darwin-arm64-1.0.1.dmg", JSON.stringify(listed));
	ok("list: linux entry carries per-asset urls", listed.find((e) => e.platform === "linux-x64")?.assetUrls?.deb === "https://smoke.test/api/releases/Celiador-linux-x64-1.0.1.deb", JSON.stringify(listed[1]));
	const latest = (await (await app.request(`${R}/latest/darwin-arm64/stable`)).json()) as { version?: string };
	ok("latest descriptor", latest.version === NEW, JSON.stringify(latest));
	const redir = await app.request(`${R}/latest/darwin-arm64/stable/dmg`, { redirect: "manual" });
	ok("latest/dmg → 302 to the file", redir.status === 302 && redir.headers.get("location") === "https://smoke.test/api/releases/Celiador-darwin-arm64-1.0.1.dmg", `${redir.status} ${redir.headers.get("location")}`);
	const debRedir = await app.request(`${R}/latest/linux-x64/stable/deb`, { redirect: "manual" });
	ok("latest/deb → 302 to the asset", debRedir.status === 302 && debRedir.headers.get("location") === "https://smoke.test/api/releases/Celiador-linux-x64-1.0.1.deb", `${debRedir.status} ${debRedir.headers.get("location")}`);
	ok("latest/unknown kind → 404", (await app.request(`${R}/latest/linux-x64/stable/snap`, { redirect: "manual" })).status === 404);
	ok("latest/dmg for a platform without one → 404", (await app.request(`${R}/latest/linux-x64/stable/dmg`, { redirect: "manual" })).status === 404);
	ok("latest for an unpublished platform → 404", (await app.request(`${R}/latest/win32-x64/stable`)).status === 404);
	const deb = await app.request(`${R}/Celiador-linux-x64-1.0.1.deb`);
	ok("asset download → 200 with deb content-type", deb.status === 200 && deb.headers.get("content-type") === "application/vnd.debian.binary-package" && (await deb.text()) === "deb-bytes", `got ${deb.status}`);
	const dl = await app.request(`${R}/Celiador-darwin-arm64-1.0.1.zip`);
	ok("download → 200 with length + zip content-type", dl.status === 200 && dl.headers.get("content-length") === "9" && dl.headers.get("content-type") === "application/zip" && (await dl.text()) === "zip-bytes", `got ${dl.status}`);
	const head = await app.request(`${R}/Celiador-darwin-arm64-1.0.1.zip`, { method: "HEAD" });
	ok("HEAD → 200 with length, no body", head.status === 200 && head.headers.get("content-length") === "9" && (await head.text()) === "", `got ${head.status}`);
	ok("listed but missing on disk → 404", (await app.request(`${R}/Celiador-darwin-arm64-1.0.0.zip`)).status === 404);
	ok("unlisted file in the dir → 404", (await app.request(`${R}/secret.txt`)).status === 404);
	ok("manifest itself is not downloadable", (await app.request(`${R}/manifest.json`)).status === 404);
	ok("path traversal → 404", (await app.request(`${R}/..%2Fmanifest.json`)).status === 404);

	// ── Extension control manifest (offline: upstream is a data: URL) ─────────
	console.log("\n== extension control ==");
	const { resetControlCache } = await import("../src/extensions/control.ts");
	const EC = "http://localhost/api/extensions/control";
	const upstreamJson = JSON.stringify({ malicious: ["evil.ext"], deprecated: { "old.ext": true, "codeium.codeium": { disallowInstall: true } }, search: [], migrateToPreRelease: {} });
	process.env.CELIADOR_EXTENSION_CONTROL_UPSTREAM = `data:application/json,${encodeURIComponent(upstreamJson)}`;
	resetControlCache();
	const ec = (await (await app.request(EC)).json()) as { malicious: string[]; deprecated: Record<string, unknown>; migrateToPreRelease?: unknown };
	ok("upstream malicious list passes through", ec.malicious.length === 1 && ec.malicious[0] === "evil.ext", JSON.stringify(ec.malicious));
	ok("upstream deprecations and other keys kept", ec.deprecated["old.ext"] === true && ec.migrateToPreRelease !== undefined, JSON.stringify(ec.deprecated["old.ext"]));
	const codeium = ec.deprecated["codeium.codeium"] as { disallowInstall?: boolean; additionalInfo?: string };
	ok("Celiador entry overrides upstream: a second AI layer is a warning, not a block", !codeium.disallowInstall && !!codeium.additionalInfo, JSON.stringify(codeium));
	const cursorOnly = ec.deprecated["anysphere.cursorpyright"] as { disallowInstall?: boolean };
	ok("Cursor-only extension is blocked", cursorOnly.disallowInstall === true, JSON.stringify(cursorOnly));
	process.env.CELIADOR_EXTENSION_CONTROL_UPSTREAM = "data:application/json,%7Bnot-json";
	const fallback = (await (await app.request(EC)).json()) as { malicious: string[]; deprecated: Record<string, unknown> };
	ok("upstream broken before any good fetch → Celiador entries only", fallback.malicious.length === 0 && !!fallback.deprecated["github.copilot"], JSON.stringify(fallback.malicious));
	delete process.env.CELIADOR_EXTENSION_CONTROL_UPSTREAM;
	resetControlCache();

	// ── Agent task queue: GitHub webhook → task → editor dispatch → PR ─────────
	console.log("\n== tasks ==");
	const crypto = await import("node:crypto");
	const T = "http://localhost/api/tasks";
	const WH = "http://localhost/api/github/webhook";
	const REPO = "https://github.com/Cliefden/smoke-repo.git";
	const ghRepo = { name: "smoke-repo", owner: { login: "Cliefden" }, clone_url: REPO };
	const hook = (event: string, payload: unknown, secret = "whsec") => {
		const body = JSON.stringify(payload);
		const sig = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
		return app.request(WH, { method: "POST", headers: { "content-type": "application/json", "x-github-event": event, "x-hub-signature-256": sig }, body });
	};
	const labeled = (n: number, label = "celiador") => ({ action: "labeled", label: { name: label }, repository: ghRepo, issue: { number: n, title: `Fix the thing ${n}`, body: "It breaks.", html_url: `https://github.com/Cliefden/smoke-repo/issues/${n}` } });
	delete process.env.CELIADOR_GITHUB_WEBHOOK_SECRET;
	ok("webhook without a configured secret → 503", (await hook("ping", {})).status === 503);
	process.env.CELIADOR_GITHUB_WEBHOOK_SECRET = "whsec";
	process.env.CELIADOR_TASK_CONCURRENCY = "1";
	ok("bad signature → 401", (await hook("ping", {}, "wrong")).status === 401);
	ok("ping → 200", (await hook("ping", {})).status === 200);
	const unlinked = (await (await hook("issues", labeled(41))).json()) as { ignored?: string };
	ok("label on an unlinked repo is ignored", /not linked/.test(unlinked.ignored ?? ""), JSON.stringify(unlinked));
	const link = await app.request(`${T}/repos`, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: "https://github.com/Cliefden/smoke-repo" }) });
	ok("link a repo", link.status === 200 && ((await link.json()) as { repos: string[] }).repos.includes(REPO));
	ok("another label is ignored", /another label/.test(((await (await hook("issues", labeled(42, "bug"))).json()) as { ignored?: string }).ignored ?? ""));
	const created = await hook("issues", labeled(42));
	const createdBody = (await created.json()) as { taskId?: string; state?: string };
	ok("celiador label → task queued (no editor online)", created.status === 201 && createdBody.state === "queued", JSON.stringify(createdBody));
	ok("same issue again → deduped", /already queued/.test(((await (await hook("issues", labeled(42))).json()) as { ignored?: string }).ignored ?? ""));
	const comment = (n: number, assoc: string, body = "@celiador please fix") => ({ action: "created", repository: ghRepo, comment: { body, author_association: assoc }, issue: { number: n, title: `Comment task ${n}`, body: "", html_url: `https://github.com/Cliefden/smoke-repo/issues/${n}` } });
	ok("@celiador from an outsider is ignored", /not a collaborator/.test(((await (await hook("issue_comment", comment(43, "NONE"))).json()) as { ignored?: string }).ignored ?? ""));
	ok("comment without the mention is ignored", /no @celiador/.test(((await (await hook("issue_comment", comment(43, "OWNER", "looks good"))).json()) as { ignored?: string }).ignored ?? ""));
	ok("@celiador from a collaborator → task", (await hook("issue_comment", comment(43, "COLLABORATOR"))).status === 201);

	// An editor comes online with the repo open: the oldest task is dispatched, the limit (1) holds the second.
	const edAbort = new AbortController();
	const edStream = await app.request("http://localhost/api/presence/commands", { headers: authH, signal: edAbort.signal } as RequestInit);
	const taskCmds: Array<{ kind?: string; taskId?: string; branch?: string; prompt?: string; issue?: { number: number } }> = [];
	const edReader = (async () => {
		const reader = edStream.body!.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		for (;;) {
			const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
			if (done) return;
			buf += decoder.decode(value, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const line of lines) {
				if (line.startsWith("data:") && line.slice(5).trim()) taskCmds.push(JSON.parse(line.slice(5)));
			}
		}
	})();
	await new Promise((r) => setTimeout(r, 30));
	await app.request("http://localhost/api/presence/workspaces", { method: "PUT", headers: authH, body: JSON.stringify({ clientId: "ed-task", workspaces: [{ name: "smoke-repo", remoteUrl: REPO }] }) });
	await new Promise((r) => setTimeout(r, 50));
	const first = taskCmds.filter((r) => r.kind === "start-task");
	ok("editor online → one start-task (limit 1), oldest first, own branch", first.length === 1 && first[0].issue?.number === 42 && first[0].branch === "42-fix-the-thing-42", JSON.stringify(first));
	ok("prompt names the issue and asks for a referencing commit", /issue #42/.test(first[0]?.prompt ?? "") && /references #42/.test(first[0]?.prompt ?? ""));
	const tid = first[0]?.taskId ?? "";
	ok("status: pr-open without prUrl → 400", (await app.request(`${T}/${tid}/status`, { method: "POST", headers: authH, body: JSON.stringify({ state: "pr-open" }) })).status === 400);
	await app.request(`${T}/${tid}/status`, { method: "POST", headers: authH, body: JSON.stringify({ state: "running", sessionId: "sess-1" }) });
	const taskPr = await app.request(`${T}/${tid}/status`, { method: "POST", headers: authH, body: JSON.stringify({ state: "pr-open", prUrl: "https://github.com/Cliefden/smoke-repo/pull/7" }) });
	ok("status: pr-open with prUrl → recorded", ((await taskPr.json()) as { task?: { state: string; prUrl?: string; sessionId?: string } }).task?.prUrl === "https://github.com/Cliefden/smoke-repo/pull/7");
	await new Promise((r) => setTimeout(r, 50));
	const second = taskCmds.filter((r) => r.kind === "start-task");
	ok("a finished task frees the slot → the next one is dispatched", second.length === 2 && second[1].issue?.number === 43, JSON.stringify(second.map((r) => r.issue?.number)));
	const manual = await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: REPO, title: "Tidy the README" }) });
	const manualTask = ((await manual.json()) as { task?: { id: string; state: string; branch: string } }).task;
	ok("manual task → queued behind the running one, celiador-* branch", manual.status === 201 && manualTask?.state === "queued" && /^celiador-[0-9a-f]{6}-tidy-the-readme$/.test(manualTask.branch), JSON.stringify(manualTask));
	ok("cancel a queued task", ((await (await app.request(`${T}/${manualTask?.id}/cancel`, { method: "POST", headers: authH })).json()) as { task?: { state: string } }).task?.state === "cancelled");
	ok("cancel again → 409", (await app.request(`${T}/${manualTask?.id}/cancel`, { method: "POST", headers: authH })).status === 409);
	const linkedRun = await app.request("http://localhost/api/sessions", { method: "POST", headers: authH, body: JSON.stringify({ title: "Comment task 43", origin: "editor", runner: "editor", taskId: second[1]?.taskId }) });
	const linkedSession = ((await linkedRun.json()) as { session?: { id: string } }).session;
	const afterLink = ((await (await app.request(T, { headers: authH })).json()) as { tasks: Array<{ id: string; sessionId?: string }> }).tasks.find((t) => t.id === second[1]?.taskId);
	ok("an editor run's relay session is linked to its task", !!linkedSession && afterLink?.sessionId === linkedSession.id, JSON.stringify(afterLink));
	const taskList = (await (await app.request(T, { headers: authH })).json()) as { tasks: Array<{ state: string }>; concurrency: number };
	ok("list: all tasks, concurrency published", taskList.tasks.length === 3 && taskList.concurrency === 1, JSON.stringify(taskList.tasks.map((t) => t.state)));
	edAbort.abort();
	await edReader;
	delete process.env.CELIADOR_TASK_CONCURRENCY;

	// ── GitHub App: app JWT, manifest, its webhook secret, merged-PR webhook ──
	console.log("\n== github app ==");
	const { appJwt, appManifest, resetGitHubAppForTests } = await import("../src/github/app.ts");
	const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
	const smokeApp = { id: 4242, slug: "celiador-smoke", name: "Celiador", htmlUrl: "https://github.com/apps/celiador-smoke", pem, webhookSecret: "appsec", clientId: "cid", clientSecret: "cs", createdAt: new Date().toISOString() };
	resetGitHubAppForTests(smokeApp);
	const jwt = appJwt(smokeApp, 1_800_000_000);
	const [h, p, s] = jwt.split(".");
	const jwtOk = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s!, "base64url"));
	const claims = JSON.parse(Buffer.from(p!, "base64url").toString()) as { iss: number; iat: number; exp: number };
	ok("app JWT: RS256 over the stored key, iss = app id, 10-minute window", jwtOk && claims.iss === 4242 && claims.exp - claims.iat === 600, JSON.stringify(claims));
	const manifest = appManifest() as { hook_attributes: { url: string }; redirect_url: string; default_events: string[]; default_permissions: Record<string, string> };
	ok("manifest: webhook + redirect on the public URL, the three events, write on issues/PRs/contents", /\/api\/github\/webhook$/.test(manifest.hook_attributes.url) && /\/api\/github\/app\/setup$/.test(manifest.redirect_url) && manifest.default_events.includes("pull_request") && manifest.default_permissions.contents === "write", JSON.stringify(manifest));
	ok("webhook signed with the app's secret is accepted", (await hook("ping", {}, "appsec")).status === 200);
	ok("webhook signed with a third secret is still refused", (await hook("ping", {}, "nope")).status === 401);
	const prMerged = { action: "closed", repository: ghRepo, pull_request: { merged: true, html_url: "https://github.com/Cliefden/smoke-repo/pull/7", head: { ref: "42-fix-the-thing-42" } } };
	const mergedRes = (await (await hook("pull_request", prMerged, "appsec")).json()) as { taskId?: string; state?: string };
	const mergedTask = ((await (await app.request(T, { headers: authH })).json()) as { tasks: Array<{ id: string; state: string }> }).tasks.find((t) => t.id === tid);
	ok("a pull_request merged on GitHub moves the task to merged", mergedRes.taskId === tid && mergedTask?.state === "merged", JSON.stringify(mergedRes));
	ok("a closed-unmerged pull_request is ignored", /pull_request\/closed/.test(((await (await hook("pull_request", { ...prMerged, pull_request: { ...prMerged.pull_request, merged: false } }, "appsec")).json()) as { ignored?: string }).ignored ?? ""));
	resetGitHubAppForTests();
	const newPage = await app.request("http://localhost/api/github/app/new");
	ok("setup page renders the manifest form when no app is stored", newPage.status === 200 && /organizations\/Cliefden\/settings\/apps\/new\?state=/.test(await newPage.text()));
	ok("setup callback without a known state → 400", (await app.request("http://localhost/api/github/app/setup?code=x&state=unknown")).status === 400);
	ok("manifest: checks + statuses read, check_suite + status events", manifest.default_permissions.checks === "read" && manifest.default_permissions.statuses === "read" && manifest.default_events.includes("check_suite") && manifest.default_events.includes("status"), JSON.stringify(manifest.default_permissions));

	// ── Agents UI: task fields, live session state, merge / follow-up, deep-link pages ──
	console.log("\n== agents ui ==");
	const AREPO = "https://github.com/Cliefden/agents-repo.git";
	const aGhRepo = { name: "agents-repo", owner: { login: "Cliefden" }, clone_url: AREPO };
	await app.request(`${T}/repos`, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: AREPO }) });
	type ATask = { id: string; state: string; title: string; branch: string; source: string; runner?: string; machine?: string; startedAt?: string; finishedAt?: string; activity?: string; prUrl?: string; issue?: { number: number }; posted?: unknown; awaiting?: { kind: string; requestId: string; text: string; preview?: string; choices?: string[] }; pr?: { number: number; url: string; additions?: number; deletions?: number; changedFiles?: number; checks?: string; mergeable?: boolean; updatedAt: string } };
	const getTask = async (id: string) => ((await (await app.request(T, { headers: authH })).json()) as { tasks: ATask[] }).tasks.find((t) => t.id === id);
	const postStatus = (id: string, body: unknown) => app.request(`${T}/${id}/status`, { method: "POST", headers: authH, body: JSON.stringify(body) });
	const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

	// An editor with the repo open, to take dispatched tasks.
	const aAbort = new AbortController();
	const aStream = await app.request("http://localhost/api/presence/commands", { headers: authH, signal: aAbort.signal } as RequestInit);
	const aCmds: Array<{ kind?: string; taskId?: string; commented?: boolean }> = [];
	const aReader = (async () => {
		const reader = aStream.body!.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		for (;;) {
			const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
			if (done) return;
			buf += decoder.decode(value, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const line of lines) if (line.startsWith("data:") && line.slice(5).trim()) aCmds.push(JSON.parse(line.slice(5)));
		}
	})();
	await tick(30);
	await app.request("http://localhost/api/presence/workspaces", { method: "PUT", headers: authH, body: JSON.stringify({ clientId: "ed-agents", workspaces: [{ name: "agents-repo", remoteUrl: AREPO }] }) });

	// Manual create with an issue (the editor's "Run an issue…" picker).
	const issueUrl = (n: number, repo = "agents-repo") => `https://github.com/Cliefden/${repo}/issues/${n}`;
	const otherRepo = await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: AREPO, issue: { number: 11, title: "Relay drops frames", url: issueUrl(11, "smoke-repo") } }) });
	ok("manual create: issue of another repo → 400", otherRepo.status === 400, `got ${otherRepo.status}`);
	const wrongNumber = await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: AREPO, issue: { number: 11, title: "x", url: issueUrl(12) } }) });
	ok("manual create: issue url/number mismatch → 400", wrongNumber.status === 400, `got ${wrongNumber.status}`);
	const withIssue = await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: AREPO, issue: { number: 11, title: "Relay drops frames", url: issueUrl(11) }, details: "Frames vanish under load." }) });
	const at = ((await withIssue.json()) as { task: ATask }).task;
	ok("manual create with an issue → 201, title from the issue, issue branch", withIssue.status === 201 && at.title === "Relay drops frames" && at.issue?.number === 11 && at.branch === "11-relay-drops-frames" && at.source === "manual", JSON.stringify(at));
	const again = await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: AREPO, issue: { number: 11, title: "Relay drops frames", url: issueUrl(11) } }) });
	const againBody = (await again.json()) as { task?: ATask; deduped?: boolean };
	ok("same issue again → the open task (deduped)", again.status === 200 && againBody.deduped === true && againBody.task?.id === at.id, JSON.stringify(againBody));
	await tick();
	const aStart = aCmds.find((c) => c.kind === "start-task" && c.taskId === at.id);
	ok("dispatched to the editor, commented=false without the App", !!aStart && aStart.commented === false, JSON.stringify(aCmds));
	ok("dispatch sets runner mac", (await getTask(at.id))?.runner === "mac");

	// The editor's run session, linked to the task.
	const aSess = ((await (await app.request("http://localhost/api/sessions", { method: "POST", headers: authH, body: JSON.stringify({ title: at.title, origin: "editor", runner: "editor", taskId: at.id }) })).json()) as { session: { id: string } }).session.id;
	const ev = (events: unknown[]) => app.request(`http://localhost/api/sessions/${aSess}/events`, { method: "POST", headers: authH, body: JSON.stringify(events) });

	// Follow-up / merge before there's a runner or a PR.
	const noRunner = await app.request(`${T}/${at.id}/followup`, { method: "POST", headers: authH, body: JSON.stringify({ text: "also add a test" }) });
	ok("followup with the editor offline → 409", noRunner.status === 409 && /editor offline/.test(((await noRunner.json()) as { error?: string }).error ?? ""), `got ${noRunner.status}`);
	ok("followup without text → 400", (await app.request(`${T}/${at.id}/followup`, { method: "POST", headers: authH, body: JSON.stringify({ text: " " }) })).status === 400);
	ok("merge before a PR → 409", (await app.request(`${T}/${at.id}/merge`, { method: "POST", headers: authH, body: "{}" })).status === 409);

	// Status with machine: startedAt once, no finishedAt.
	const runRes = ((await (await postStatus(at.id, { state: "running", sessionId: aSess, machine: "Stefan's MacBook Pro\n" })).json()) as { task: ATask }).task;
	ok("running + machine → machine (one line), startedAt set, no finishedAt", runRes.machine === "Stefan's MacBook Pro" && !!runRes.startedAt && !runRes.finishedAt && runRes.posted === undefined, JSON.stringify(runRes));
	const startedAt = runRes.startedAt;

	// Session events → activity / awaiting on the task.
	await ev([{ kind: "state", state: "running" }, { kind: "activity", text: "Reading   src/relay.ts\n" }]);
	ok("session activity → task.activity (one line)", (await getTask(at.id))?.activity === "Reading src/relay.ts");
	await ev([{ kind: "approval", requestId: "r1", approvalKind: "bash", title: "Run command: npm test -- relay", preview: "npm test -- relay" }, { kind: "state", state: "awaiting" }]);
	const awaitingP = (await getTask(at.id))?.awaiting;
	ok("approval → awaiting permission with requestId, text, preview", awaitingP?.kind === "permission" && awaitingP.requestId === "r1" && awaitingP.text === "Run command: npm test -- relay" && awaitingP.preview === "npm test -- relay", JSON.stringify(awaitingP));
	await ev([{ kind: "state", state: "running" }]);
	ok("session back to running → awaiting cleared", (await getTask(at.id))?.awaiting === undefined);
	await ev([{ kind: "question", requestId: "q1", prompt: "Which port?", choices: ["4661", "4671"] }, { kind: "state", state: "awaiting" }]);
	const awaitingQ = (await getTask(at.id))?.awaiting;
	ok("question → awaiting question with choices", awaitingQ?.kind === "question" && awaitingQ.text === "Which port?" && awaitingQ.choices?.length === 2, JSON.stringify(awaitingQ));
	await ev([{ kind: "state", state: "done" }]);
	const doneTask = await getTask(at.id);
	ok("session done → awaiting and activity cleared", doneTask?.awaiting === undefined && doneTask?.activity === undefined, JSON.stringify(doneTask));
	const onDisk = JSON.parse(fs.readFileSync(path.join(HOME, "data", "tasks", "smoke-user.json"), "utf8")) as ATask[];
	await ev([{ kind: "activity", text: "Still going" }]);
	const onDisk2 = JSON.parse(fs.readFileSync(path.join(HOME, "data", "tasks", "smoke-user.json"), "utf8")) as ATask[];
	ok("activity is never written to disk", onDisk2.every((t) => t.activity === undefined) && onDisk.length === onDisk2.length);

	// pr-open with pr numbers: finishedAt, pr fields; running again clears finishedAt.
	const prOpen = ((await (await postStatus(at.id, { state: "pr-open", prUrl: "https://github.com/Cliefden/agents-repo/pull/8", pr: { number: 8, additions: 64, deletions: 11, changedFiles: 3 } })).json()) as { task: ATask }).task;
	ok("pr-open + pr → pr {number,url,+/-,files}, checks unknown, finishedAt", prOpen.pr?.number === 8 && prOpen.pr.url === "https://github.com/Cliefden/agents-repo/pull/8" && prOpen.pr.additions === 64 && prOpen.pr.deletions === 11 && prOpen.pr.changedFiles === 3 && prOpen.pr.checks === "unknown" && !!prOpen.pr.updatedAt && !!prOpen.finishedAt && prOpen.activity === undefined, JSON.stringify(prOpen));
	const badPr = ((await (await postStatus(at.id, { state: "pr-open", pr: { number: "8", additions: -1 } })).json()) as { task: ATask }).task;
	ok("pr-open re-sent (no prUrl, bad pr values) → idempotent, keeps the PR", badPr.state === "pr-open" && badPr.pr?.number === 8 && badPr.pr.additions === 64 && badPr.finishedAt === prOpen.finishedAt, JSON.stringify(badPr.pr));
	const followRun = ((await (await postStatus(at.id, { state: "running" })).json()) as { task: ATask }).task;
	ok("running after pr-open (follow-up) → finishedAt cleared, startedAt kept", !followRun.finishedAt && followRun.startedAt === startedAt && followRun.pr?.number === 8, JSON.stringify(followRun));
	await postStatus(at.id, { state: "pr-open", prUrl: "https://github.com/Cliefden/agents-repo/pull/8" });
	ok("merge with no App and the editor offline → 409 with the reason", await (async () => {
		const r = await app.request(`${T}/${at.id}/merge`, { method: "POST", headers: authH, body: "{}" });
		return r.status === 409 && ((await r.json()) as { error?: string }).error === "editor offline and the GitHub App isn't installed on this repo";
	})());
	ok("merge with a bad method → 400", (await app.request(`${T}/${at.id}/merge`, { method: "POST", headers: authH, body: JSON.stringify({ method: "ff" }) })).status === 400);

	// The editor attaches as the session's runner: follow-up + merge are relayed to it.
	const rAbort = new AbortController();
	const rStream = await app.request(`http://localhost/api/sessions/${aSess}/commands`, { headers: authH, signal: rAbort.signal } as RequestInit);
	const rCmds: Array<{ kind?: string; requestId?: string; text?: string; head?: string; method?: string }> = [];
	const rReader = (async () => {
		const reader = rStream.body!.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		for (;;) {
			const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
			if (done) return;
			buf += decoder.decode(value, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.startsWith("data:") || !line.slice(5).trim()) continue;
				const cmd = JSON.parse(line.slice(5));
				rCmds.push(cmd);
				if (cmd.kind === "git.merge") {
					await app.request(`http://localhost/api/sessions/${aSess}/events`, { method: "POST", headers: authH, body: JSON.stringify({ kind: "fs.result", requestId: cmd.requestId, ok: true, merged: true, sha: "feed01", url: "https://github.com/Cliefden/agents-repo/pull/8" }) });
				}
			}
		}
	})();
	await tick(30);
	const fu = await app.request(`${T}/${at.id}/followup`, { method: "POST", headers: authH, body: JSON.stringify({ text: "  also add a test  " }) });
	await tick(20);
	ok("followup → 200, instruct relayed to the run's session", fu.status === 200 && rCmds.some((c) => c.kind === "instruct" && c.text === "also add a test"), JSON.stringify(rCmds));
	const mr = await app.request(`${T}/${at.id}/merge`, { method: "POST", headers: authH, body: JSON.stringify({ method: "squash" }) });
	const mrBody = (await mr.json()) as { ok?: boolean; merged?: boolean; sha?: string; url?: string };
	ok("merge without the App → relayed git.merge with head = the task branch", mr.status === 200 && mrBody.merged === true && mrBody.sha === "feed01" && rCmds.some((c) => c.kind === "git.merge" && c.head === at.branch && c.method === "squash"), JSON.stringify({ mrBody, rCmds }));
	const mergedA = await getTask(at.id);
	ok("merged task: state merged, finishedAt set", mergedA?.state === "merged" && !!mergedA.finishedAt, JSON.stringify(mergedA));
	ok("merge again → 409", (await app.request(`${T}/${at.id}/merge`, { method: "POST", headers: authH, body: "{}" })).status === 409);
	ok("a late running report on a merged task → 409", (await postStatus(at.id, { state: "running" })).status === 409);
	rAbort.abort();
	await rReader;

	// With the GitHub App: comments at running / pr-open, PR refresh with checks, App merge.
	const ghCalls: GhCall[] = [];
	ghHandler = (call) => {
		ghCalls.push(call);
		const base = "/repos/Cliefden/agents-repo";
		if (call.path === `${base}/installation`) return { status: 200, json: { id: 7 } };
		if (call.path === "/app/installations/7/access_tokens") {
			// An installation that hasn't approved checks/statuses read refuses the request.
			const perms = (call.body?.permissions ?? {}) as Record<string, string>;
			return perms.checks ? { status: 422, json: { message: "The permissions requested are not granted to this installation." } } : { status: 201, json: { token: "ghs_smoke" } };
		}
		if (call.path === base) return { status: 200, json: { default_branch: "develop" } };
		if (call.path.startsWith(`${base}/issues/`) && call.method === "POST") return { status: 201, json: { id: 1 } };
		if (call.path === `${base}/pulls/9`) return { status: 200, json: { number: 9, html_url: "https://github.com/Cliefden/agents-repo/pull/9", additions: 5, deletions: 1, changed_files: 2, mergeable: true, merged: false, head: { sha: "deadbeef" } } };
		if (call.path.startsWith(`${base}/commits/deadbeef/check-runs`)) return { status: 200, json: { total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] } };
		if (call.path === `${base}/commits/deadbeef/status`) return { status: 200, json: { state: "pending", total_count: 0, statuses: [] } };
		if (call.path === `${base}/pulls/9/merge` && call.method === "PUT") return { status: 200, json: { merged: true, sha: "m1" } };
		return { status: 404, json: { message: "Not Found" } };
	};
	resetGitHubAppForTests(smokeApp);
	const appTask = ((await (await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: AREPO, issue: { number: 12, title: "Queue shows stale checks", url: issueUrl(12) } }) })).json()) as { task: ATask }).task;
	await tick();
	ok("with the App, dispatch tells the editor the daemon will comment", aCmds.find((c) => c.kind === "start-task" && c.taskId === appTask.id)?.commented === true, JSON.stringify(aCmds));
	ok("no comment at dispatch any more", !ghCalls.some((c) => c.path.includes("/issues/12/comments")));
	await postStatus(appTask.id, { state: "running", machine: "Stefan's MacBook Pro" });
	await tick();
	await postStatus(appTask.id, { state: "running", machine: "Stefan's MacBook Pro" });
	await tick();
	const pickedUp = ghCalls.filter((c) => c.path.endsWith("/issues/12/comments")).map((c) => String(c.body?.body));
	ok("token request retried without checks/statuses after a 422", ghCalls.filter((c) => c.path.endsWith("/access_tokens")).length === 2);
	const expectedComment = `**Picked up.** Running on Stefan's MacBook Pro in its own worktree, \`${appTask.branch}\`.\n\nI'll open a pull request against \`develop\` and link it here. Approvals and questions go to the Celiador queue.\n\n[Watch the run](https://smoke.test/api/open/task/${appTask.id}) · [Open the queue](https://smoke.test/api/open/queue)`;
	ok("running → one 'Picked up' comment with machine, branch, default branch and links", pickedUp.length === 1 && pickedUp[0] === expectedComment, JSON.stringify(pickedUp));
	await postStatus(appTask.id, { state: "pr-open", prUrl: "https://github.com/Cliefden/agents-repo/pull/9" });
	await tick();
	await postStatus(appTask.id, { state: "pr-open", prUrl: "https://github.com/Cliefden/agents-repo/pull/9" });
	await tick();
	const prComments = ghCalls.filter((c) => c.path.endsWith("/issues/12/comments")).map((c) => String(c.body?.body)).slice(1);
	ok("pr-open → one 'Pull request opened' comment", prComments.length === 1 && prComments[0] === "Pull request opened: https://github.com/Cliefden/agents-repo/pull/9", JSON.stringify(prComments));
	const refreshed = await getTask(appTask.id);
	ok("pr-open → PR refreshed from GitHub (size, mergeable, checks passing)", refreshed?.pr?.number === 9 && refreshed.pr.additions === 5 && refreshed.pr.changedFiles === 2 && refreshed.pr.mergeable === true && refreshed.pr.checks === "passing", JSON.stringify(refreshed?.pr));
	const ciHook = (await (await hook("check_suite", { action: "completed", repository: aGhRepo, check_suite: { head_branch: appTask.branch, pull_requests: [] } }, "appsec")).json()) as { refreshed?: string[] };
	ok("check_suite completed on the task's branch → its PR is refreshed", ciHook.refreshed?.includes(appTask.id) === true, JSON.stringify(ciHook));
	const statusHook = (await (await hook("status", { repository: aGhRepo, sha: "deadbeef", branches: [{ name: appTask.branch }] }, "appsec")).json()) as { refreshed?: string[] };
	ok("status event on the task's branch → refreshed", statusHook.refreshed?.includes(appTask.id) === true, JSON.stringify(statusHook));
	const syncHook = (await (await hook("pull_request", { action: "synchronize", repository: aGhRepo, pull_request: { number: 9, head: { ref: appTask.branch } } }, "appsec")).json()) as { refreshed?: string[] };
	ok("pull_request synchronize → refreshed", syncHook.refreshed?.includes(appTask.id) === true, JSON.stringify(syncHook));
	await tick();
	const appMerge = await app.request(`${T}/${appTask.id}/merge`, { method: "POST", headers: authH, body: JSON.stringify({ method: "rebase" }) });
	const appMergeBody = (await appMerge.json()) as { merged?: boolean; sha?: string; url?: string };
	const putCall = ghCalls.find((c) => c.method === "PUT");
	ok("merge with the App → PUT pulls/9/merge as the App, task merged", appMerge.status === 200 && appMergeBody.merged === true && appMergeBody.sha === "m1" && appMergeBody.url === "https://github.com/Cliefden/agents-repo/pull/9" && putCall?.body?.merge_method === "rebase" && (await getTask(appTask.id))?.state === "merged", JSON.stringify({ appMergeBody, putCall }));
	ok("internal comment bookkeeping is not in the API", (await getTask(appTask.id))?.posted === undefined);
	resetGitHubAppForTests();
	ghHandler = () => ({ status: 404, json: { message: "Not Found" } });
	aAbort.abort();
	await aReader;

	// Deep-link pages for the comment's links: no auth, no data, bounce to the app.
	const openTask = await app.request(`http://localhost/api/open/task/${appTask.id}`);
	const openTaskHtml = await openTask.text();
	ok("GET /api/open/task/:id (no auth) → page bouncing to celiador://task/<id>", openTask.status === 200 && openTaskHtml.includes(`celiador://task/${appTask.id}`) && openTaskHtml.includes("Open in Celiador") && !openTaskHtml.includes(appTask.title), openTaskHtml.slice(0, 200));
	ok("open page for a non-uuid id → 404", (await app.request("http://localhost/api/open/task/not-a-uuid")).status === 404);
	const openQueue = await app.request("http://localhost/api/open/queue");
	ok("GET /api/open/queue → page bouncing to celiador://queue", openQueue.status === 200 && (await openQueue.text()).includes("celiador://queue"));

	// ── Cloud-runner sandbox (pure parts; isolation itself: scripts/sandbox-check.ts) ──
	console.log("\n== sandbox ==");
	const { streamLineToEvents, streamLineResult, dockerRunArgs } = await import("../src/runner/sandbox.ts");
	const asst = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Reading the file." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }] } });
	const toolRes = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true }] } });
	ok("stream-json: assistant text + tool_use → message + tool", JSON.stringify(streamLineToEvents(asst)) === JSON.stringify([{ kind: "message", role: "assistant", text: "Reading the file." }, { kind: "tool", callId: "t1", name: "Read", input: { file_path: "a.ts" } }]), JSON.stringify(streamLineToEvents(asst)));
	ok("stream-json: tool_result error → toolResult ok=false", JSON.stringify(streamLineToEvents(toolRes)) === JSON.stringify([{ kind: "toolResult", callId: "t1", ok: false }]));
	ok("stream-json: junk and system lines → nothing", streamLineToEvents("not json").length === 0 && streamLineToEvents('{"type":"system","subtype":"init"}').length === 0);
	ok("stream-json: result verdicts", streamLineResult('{"type":"result","subtype":"success","is_error":false,"result":"done"}')?.ok === true && streamLineResult('{"type":"result","subtype":"error_max_turns","is_error":true}')?.ok === false && streamLineResult(asst) === undefined);
	const dargs = dockerRunArgs({ name: "n", workspaceDir: "/w", gatewayDir: "/g", uid: 1000, gid: 1000, token: "tok", prompt: "fix it" });
	const flag = (f: string, v?: string) => { const i = dargs.indexOf(f); return i >= 0 && (v === undefined || dargs[i + 1] === v); };
	ok("docker run: no network, read-only, caps dropped, no-new-privileges, non-root", flag("--network", "none") && flag("--read-only") && flag("--cap-drop", "ALL") && flag("--security-opt", "no-new-privileges") && flag("--user", "1000:1000"), dargs.join(" "));
	ok("docker run: only the workspace + gateway dir mounted; prompt passed as one argv", dargs.filter((a) => a === "-v").length === 2 && flag("-p", "fix it"));
	const notActive = await app.request(`http://localhost/api/sessions/${sid}/cancel`, { method: "POST", headers: authH });
	ok("cancel on an editor session without a runner → 409 (unchanged)", notActive.status === 409, `got ${notActive.status}`);

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

	// ── Cost per run: gateway usage → session → task → /api/me ───────────────
	console.log("\n== cost ==");
	const { parseSelfReview, extractPlan, composePrBody } = await import("../src/tasks/prBody.ts");
	const { overrideServerRunnerForTests } = await import("../src/runner/manager.ts");
	const { overrideCloudRemoteForTests, WAITING_FOR_APP } = await import("../src/tasks/cloud.ts");
	// A plain user token (no run id) — what the editor sends.
	const userJwt = (() => {
		const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
		const now = Math.floor(Date.now() / 1000);
		const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "smoke-user", role: "authenticated", aud: "authenticated", iat: now, exp: now + 600 })}`;
		return `${input}.${crypto.createHmac("sha256", process.env.SUPABASE_JWT_SECRET!).update(input).digest("base64url")}`;
	})();
	const userH = { "content-type": "application/json", authorization: `Bearer ${userJwt}` };
	const gwBodyPlain = JSON.stringify({ model: AGENT_MODEL, max_tokens: 10, stream: true, messages: [{ role: "user", content: "hi" }] });
	const until = async (pred: () => Promise<boolean> | boolean, ms = 10_000): Promise<boolean> => {
		const t0 = Date.now();
		while (Date.now() - t0 < ms) { if (await pred()) return true; await tick(40); }
		return false;
	};
	type Usage = { requests: number; inputTokens: number; outputTokens: number; costUsd: number };
	const getSession = async (id: string) => ((await (await app.request(`http://localhost/api/sessions/${id}`, { headers: authH })).json()) as { session?: { id: string; title: string; origin: string; runner: string; state: string; usage?: Usage } }).session;
	const limits2 = (await (await app.request("http://localhost/api/limits")).json()) as { prices?: { currency: string; inputPerMtok: number; outputPerMtok: number } };
	ok("GET /api/limits publishes the rate card (defaults 15 / 75 USD per Mtok)", limits2.prices?.currency === "USD" && limits2.prices.inputPerMtok === 15 && limits2.prices.outputPerMtok === 75, JSON.stringify(limits2.prices));
	const CREPO = "https://github.com/Cliefden/cost-repo.git";
	const costTask = ((await (await app.request(T, { method: "POST", headers: userH, body: JSON.stringify({ remoteUrl: CREPO, title: "Price the run" }) })).json()) as { task: ATask & { usage?: Usage } }).task;
	const mirrored = ((await (await app.request("http://localhost/api/sessions", { method: "POST", headers: userH, body: JSON.stringify({ title: "Price the run", origin: "editor", runner: "editor", mirrorKey: "agent-host:mirror-1", taskId: costTask.id }) })).json()) as { session: { id: string } }).session;
	await (await app.request(GW, { method: "POST", headers: { ...userH, "x-celiador-mirror": "agent-host:mirror-1" }, body: gwBodyPlain })).text();
	const usage1 = (await getSession(mirrored.id))?.usage;
	ok("gateway request with X-Celiador-Mirror → the mirrored session's usage, priced at the rate card", usage1?.requests === 1 && usage1.inputTokens === 5 && usage1.outputTokens === 3 && usage1.costUsd === 0.0003, JSON.stringify(usage1));
	ok("task.usage mirrors the linked session's", JSON.stringify((await getTask(costTask.id) as ATask & { usage?: Usage })?.usage) === JSON.stringify(usage1));
	await (await app.request(GW, { method: "POST", headers: { ...userH, "x-celiador-mirror": "agent-host:nobody" }, body: gwBodyPlain })).text();
	await (await app.request(GW, { method: "POST", headers: userH, body: gwBodyPlain })).text();
	ok("unknown / missing mirror header → counted for the user only", (await getSession(mirrored.id))?.usage?.requests === 1);
	const runTok = { "content-type": "application/json", authorization: `Bearer ${mintRunnerToken("smoke-user", mirrored.id, 300)!}` };
	await (await app.request(GW, { method: "POST", headers: runTok, body: gwBodyPlain })).text();
	const usage2 = (await getSession(mirrored.id))?.usage;
	ok("runner token → attributed by its run id (no header needed)", usage2?.requests === 2 && usage2.costUsd === 0.0006, JSON.stringify(usage2));
	const sessOnDisk = JSON.parse(fs.readFileSync(path.join(HOME, "data", "sessions", "meta", "smoke-user.json"), "utf8")) as { sessions: Array<{ id: string; usage?: Usage }> };
	await tick(300);
	const sessOnDisk2 = JSON.parse(fs.readFileSync(path.join(HOME, "data", "sessions", "meta", "smoke-user.json"), "utf8")) as { sessions: Array<{ id: string; usage?: Usage }> };
	ok("session usage is persisted (debounced)", (sessOnDisk2.sessions.find((s) => s.id === mirrored.id)?.usage?.requests ?? sessOnDisk.sessions.find((s) => s.id === mirrored.id)?.usage?.requests) === 2);
	await postStatus(costTask.id, { state: "running", sessionId: mirrored.id });
	await postStatus(costTask.id, { state: "pr-open", prUrl: "https://github.com/Cliefden/cost-repo/pull/3" });
	const me = (await (await app.request("http://localhost/api/me", { headers: userH })).json()) as { tasks?: { costUsdLast7Days?: number; prOpen?: number } };
	ok("GET /api/me → tasks.costUsdLast7Days sums pr-open + merged tasks finished in the window", me.tasks?.costUsdLast7Days === 0.0006, JSON.stringify(me.tasks));

	// ── PR body helper (pure) ────────────────────────────────────────────────
	console.log("\n== pr body ==");
	const finalMsg = "Plan:\n1. Read the relay\n2. Add the header\n\nDid the thing.\n\n## Self-review\n### What changed\nAdded the mirror header to the proxy.\n### Unsure about\n- Whether the header survives the retry path.\n### Not run / verified\n- The iOS build (no simulator here).\n";
	const review = parseSelfReview(finalMsg);
	ok("self-review: headed sub-sections → paragraph + bullets", review.whatChanged === "Added the mirror header to the proxy." && review.unsure[0] === "Whether the header survives the retry path." && review.notVerified[0] === "The iOS build (no simulator here).", JSON.stringify(review));
	const review2 = parseSelfReview("Done.\n\n**Self-review**\n- What changed: Renamed `foo` to `bar` in two files.\n- Unsure: nothing.\n- Not verified: didn't run the e2e suite.");
	ok("self-review: bold heading + labelled bullets", review2.whatChanged === "Renamed `foo` to `bar` in two files." && review2.unsure[0] === "nothing." && review2.notVerified[0] === "didn't run the e2e suite.", JSON.stringify(review2));
	ok("self-review: absent → empty", parseSelfReview("just text").whatChanged === undefined && parseSelfReview("just text").unsure.length === 0);
	ok("plan: the lines under a Plan: heading, up to the blank line", extractPlan(finalMsg) === "1. Read the relay\n2. Add the header", JSON.stringify(extractPlan(finalMsg)));
	ok("plan: bold inline form", extractPlan("**Plan:** look, then fix\n- a\n- b") === "look, then fix\n- a\n- b", JSON.stringify(extractPlan("**Plan:** look, then fix\n- a\n- b")));
	ok("plan: none without the heading", extractPlan("I will plan to do x") === undefined);
	const prBody = composePrBody({ issueNumber: 12, summary: finalMsg, runBy: "Stefan's MacBook Pro", changedFiles: 3, elapsedMs: 254_000, usage: { requests: 9, inputTokens: 12_345, outputTokens: 4_000, costUsd: 0.49 } });
	ok("PR body: Closes, what the agent did, self-review bullets, footer", prBody === "Closes #12\n\n## What the agent did\nAdded the mirror header to the proxy.\n\n## Self-review\n- Unsure: Whether the header survives the retry path.\n- Not verified: The iOS build (no simulator here).\n\n---\nRun by Celiador on Stefan's MacBook Pro · 3 files · 4 min · $0.49 (12.3k in / 4.0k out tokens)", JSON.stringify(prBody));
	const bareBody = composePrBody({ summary: "Just a sentence.", runBy: "the cloud" });
	ok("PR body without an issue, review or numbers", bareBody === "## What the agent did\nJust a sentence.\n\n## Self-review\n_The agent flagged nothing it was unsure about or left unverified._\n\n---\nRun by Celiador on the cloud", JSON.stringify(bareBody));

	// ── GitHub narration: plan, questions / approvals (+ answers from the issue), PR body, checks failed, failed ──
	console.log("\n== narration ==");
	const NREPO = "https://github.com/Cliefden/narrate-repo.git";
	const nGhRepo = { name: "narrate-repo", owner: { login: "Cliefden" }, clone_url: NREPO };
	const nBase = "/repos/Cliefden/narrate-repo";
	const nCalls: GhCall[] = [];
	ghHandler = (call) => {
		nCalls.push(call);
		if (call.path === `${nBase}/installation`) return { status: 200, json: { id: 9 } };
		if (call.path === "/app/installations/9/access_tokens") return { status: 201, json: { token: "ghs_narrate" } };
		if (call.path === nBase) return { status: 200, json: { default_branch: "main" } };
		if (call.path.startsWith(`${nBase}/issues/`) && call.method === "POST") return { status: 201, json: { id: 1 } };
		if (call.path === `${nBase}/pulls/31`) return { status: call.method === "PATCH" ? 200 : 200, json: { number: 31, html_url: "https://github.com/Cliefden/narrate-repo/pull/31", additions: 2, deletions: 1, changed_files: 1, mergeable: true, merged: false, head: { sha: "cafe01" } } };
		if (call.path.startsWith(`${nBase}/commits/`)) return { status: 200, json: { total_count: 0, check_runs: [], state: "pending", statuses: [] } };
		if (call.path === `${nBase}/check-suites/77/check-runs?per_page=50`) return { status: 200, json: { check_runs: [{ name: "build", conclusion: "failure", details_url: "https://ci.test/build/1" }, { name: "lint", conclusion: "success" }] } };
		return { status: 404, json: { message: "Not Found" } };
	};
	resetGitHubAppForTests(smokeApp);
	process.env.CELIADOR_TASK_CI_FIX_ATTEMPTS = "5";
	await app.request(`${T}/repos`, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: NREPO }) });
	const nAbort = new AbortController();
	const nStream = await app.request("http://localhost/api/presence/commands", { headers: authH, signal: nAbort.signal } as RequestInit);
	void nStream.body!.getReader().read().catch(() => undefined);
	await tick(30);
	await app.request("http://localhost/api/presence/workspaces", { method: "PUT", headers: authH, body: JSON.stringify({ clientId: "ed-narrate", workspaces: [{ name: "narrate-repo", remoteUrl: NREPO }] }) });
	const nTask = ((await (await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: NREPO, issue: { number: 30, title: "Narrate the run", url: issueUrl(30, "narrate-repo") } }) })).json()) as { task: ATask }).task;
	ok("narration task dispatched to the editor", nTask.state === "dispatched" && nTask.runner === "mac", JSON.stringify(nTask));
	const nSess = ((await (await app.request("http://localhost/api/sessions", { method: "POST", headers: authH, body: JSON.stringify({ title: nTask.title, origin: "editor", runner: "editor", taskId: nTask.id }) })).json()) as { session: { id: string } }).session.id;
	const nEv = (events: unknown[]) => app.request(`http://localhost/api/sessions/${nSess}/events`, { method: "POST", headers: authH, body: JSON.stringify(events) });
	const issueComments = () => nCalls.filter((c) => c.path === `${nBase}/issues/30/comments` && c.method === "POST").map((c) => String(c.body?.body));
	// The editor attaches as the session's runner (collects relayed commands; reattachable).
	const nCmds: Array<{ kind?: string; requestId?: string; text?: string }> = [];
	const attachRunner = async () => {
		const abort = new AbortController();
		const stream = await app.request(`http://localhost/api/sessions/${nSess}/commands`, { headers: authH, signal: abort.signal } as RequestInit);
		const reader = (async () => {
			const r = stream.body!.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			for (;;) {
				const { done, value } = await r.read().catch(() => ({ done: true, value: undefined }));
				if (done) return;
				buf += decoder.decode(value, { stream: true });
				const lines = buf.split("\n");
				buf = lines.pop() ?? "";
				for (const line of lines) if (line.startsWith("data:") && line.slice(5).trim()) nCmds.push(JSON.parse(line.slice(5)));
			}
		})();
		await tick(30);
		return { abort, reader };
	};
	let runner = await attachRunner();
	await postStatus(nTask.id, { state: "running", sessionId: nSess, machine: "Stefan's MacBook Pro" });
	await tick();
	ok("picked up comment (editor)", issueComments().length === 1 && issueComments()[0]!.startsWith("**Picked up.** Running on Stefan's MacBook Pro"), JSON.stringify(issueComments()));
	// Plan: streamed as deltas (the editor never sends a closing message), read when the reply ends.
	await nEv([{ kind: "state", state: "running" }, { kind: "delta", text: "Plan:\n1. Look\n" }, { kind: "delta", text: "2. Fix\n\nLet me start." }, { kind: "tool", callId: "t1", name: "Read", input: {} }]);
	await tick();
	ok("streamed Plan: → one `**Plan.**` comment with the plan lines", issueComments()[1] === "**Plan.**\n1. Look\n2. Fix", JSON.stringify(issueComments()));
	await nEv([{ kind: "message", role: "assistant", text: "Plan:\nagain" }]);
	await tick();
	ok("a later Plan: message does not post again", issueComments().length === 2, JSON.stringify(issueComments()));
	// Question → comment with numbered choices; an owner's "2" picks the choice and gets a 👍.
	await nEv([{ kind: "question", requestId: "q7", prompt: "Which port?", choices: ["4661", "4671"] }, { kind: "state", state: "awaiting" }]);
	await tick();
	ok("question → comment with choices + how to answer", issueComments()[2] === "**Question from the agent.** Which port?\n\n1. 4661\n2. 4671\n\nReply to this issue to answer (a number picks a choice), or answer in the Celiador queue.", JSON.stringify(issueComments()[2]));
	const reply = (body: string, assoc: string, id = 555) => hook("issue_comment", { action: "created", repository: nGhRepo, comment: { id, body, author_association: assoc }, issue: { number: 30, title: "Narrate the run", body: "", html_url: issueUrl(30, "narrate-repo") } }, "appsec");
	const outsider = (await (await reply("2", "NONE")).json()) as { ignored?: string };
	ok("an outsider's reply is ignored", /not a collaborator/.test(outsider.ignored ?? ""), JSON.stringify(outsider));
	const picked = (await (await reply("2", "OWNER")).json()) as { answered?: string; requestId?: string };
	await tick();
	ok("an owner's lone number → `answer` with that choice, relayed to the runner", picked.answered === "answer" && nCmds.some((c) => c.kind === "answer" && c.requestId === "q7" && c.text === "4671"), JSON.stringify({ picked, nCmds }));
	ok("the reply is acknowledged with a 👍 reaction, not a comment", nCalls.some((c) => c.method === "POST" && c.path === `${nBase}/issues/comments/555/reactions` && c.body?.content === "+1") && issueComments().length === 3);
	await nEv([{ kind: "state", state: "running" }]);
	// Approval → comment with the preview; "Approve…" approves, "no" rejects, anything else is ignored.
	await nEv([{ kind: "approval", requestId: "a8", approvalKind: "bash", title: "Run: npm test", preview: "npm test" }, { kind: "state", state: "awaiting" }]);
	await tick();
	ok("approval → comment with preview + approve/deny instructions", issueComments()[3] === "**Needs approval.** Run: npm test\n\n```\nnpm test\n```\n\nReply **approve** or **deny**, or decide in the Celiador queue.", JSON.stringify(issueComments()[3]));
	const chatter = (await (await reply("looks fine to me", "MEMBER", 556)).json()) as { ignored?: string };
	ok("a reply that isn't a decision is ignored", /approve/.test(chatter.ignored ?? ""), JSON.stringify(chatter));
	const approved = (await (await reply("Approve, go ahead", "MEMBER", 557)).json()) as { answered?: string };
	await tick();
	ok("\"Approve…\" → approve relayed", approved.answered === "approve" && nCmds.some((c) => c.kind === "approve" && c.requestId === "a8"), JSON.stringify(approved));
	await nEv([{ kind: "state", state: "running" }, { kind: "approval", requestId: "a9", approvalKind: "write_file", path: "src/x.ts" }, { kind: "state", state: "awaiting" }]);
	await tick();
	const denied = (await (await reply("no, leave that file", "COLLABORATOR", 558)).json()) as { answered?: string };
	await tick();
	ok("\"no\" → reject relayed; the second approval got its own comment", denied.answered === "reject" && nCmds.some((c) => c.kind === "reject" && c.requestId === "a9") && issueComments().length === 5, JSON.stringify({ denied, n: issueComments().length }));
	await nEv([{ kind: "state", state: "running" }]);
	// pr-open with the final message → the daemon composes the PR body and PATCHes it as the App.
	await postStatus(nTask.id, { state: "pr-open", prUrl: "https://github.com/Cliefden/narrate-repo/pull/31", pr: { number: 31, additions: 2, deletions: 1, changedFiles: 1 }, summary: finalMsg });
	await tick(120);
	const patched = nCalls.find((c) => c.method === "PATCH" && c.path === `${nBase}/pulls/31`);
	const patchedBody = String(patched?.body?.body ?? "");
	ok("pr-open + summary → PATCH pulls/31 with the composed body", !!patched && patchedBody.startsWith("Closes #30\n\n## What the agent did\nAdded the mirror header to the proxy.\n\n## Self-review\n- Unsure: Whether the header survives the retry path.") && /Run by Celiador on Stefan's MacBook Pro · 1 file · \d+ s$/.test(patchedBody), JSON.stringify(patchedBody));
	ok("…a run with no attributed usage gets no cost in the footer (nothing invented)", !patchedBody.includes("$"));
	ok("pull request opened comment", issueComments()[5] === "Pull request opened: https://github.com/Cliefden/narrate-repo/pull/31", JSON.stringify(issueComments()));
	// Checks failed → a fix follow-up (instruct) + comment; once per head sha; attempt cap; waits for a runner.
	const checkRun = (sha: string, conclusion = "failure") => hook("check_run", { action: "completed", repository: nGhRepo, check_run: { name: "lint", head_sha: sha, conclusion, details_url: `https://ci.test/lint/${sha}`, check_suite: { head_branch: nTask.branch }, pull_requests: [{ number: 31, head: { ref: nTask.branch } }] } }, "appsec");
	const ci1 = (await (await checkRun("cafe01")).json()) as { fixing?: string[] };
	await tick(80);
	ok("check_run failure on the PR branch → fix follow-up relayed to the run", ci1.fixing?.includes(nTask.id) === true && nCmds.some((c) => c.kind === "instruct" && c.text === "The CI checks failed on pull request #31 (lint). Details: https://ci.test/lint/cafe01. Investigate and fix, then commit."), JSON.stringify({ ci1, instructs: nCmds.filter((c) => c.kind === "instruct") }));
	ok("checks failed comment: attempt 1 of 5", issueComments()[6] === "**Checks failed** — the agent is taking a look (attempt 1 of 5).", JSON.stringify(issueComments().slice(6)));
	await checkRun("cafe01");
	await tick(80);
	ok("the same head sha again → nothing more", nCmds.filter((c) => c.kind === "instruct").length === 1 && issueComments().length === 7);
	ok("a cancelled / neutral conclusion is not the agent's to fix", ((await (await checkRun("cafe09", "cancelled")).json()) as { fixing?: string[] }).fixing === undefined);
	const suite = (await (await hook("check_suite", { action: "completed", repository: nGhRepo, check_suite: { id: 77, head_branch: nTask.branch, head_sha: "cafe02", conclusion: "failure", pull_requests: [{ number: 31, head: { ref: nTask.branch } }] } }, "appsec")).json()) as { fixing?: string[] };
	await tick(120);
	ok("check_suite failure → failed runs listed via the App, attempt 2", suite.fixing?.includes(nTask.id) === true && nCmds.some((c) => c.kind === "instruct" && c.text === "The CI checks failed on pull request #31 (build). Details: https://ci.test/build/1. Investigate and fix, then commit.") && issueComments()[7] === "**Checks failed** — the agent is taking a look (attempt 2 of 5).", JSON.stringify(issueComments().slice(7)));
	runner.abort.abort();
	await runner.reader;
	await checkRun("cafe03");
	await tick(80);
	ok("no runner online → \"I'll retry when a runner is online\", nothing sent", issueComments()[8] === "**Checks failed** — I'll retry when a runner is online." && nCmds.filter((c) => c.kind === "instruct").length === 2, JSON.stringify(issueComments().slice(8)));
	runner = await attachRunner();
	await app.request("http://localhost/api/presence/workspaces", { method: "PUT", headers: authH, body: JSON.stringify({ clientId: "ed-narrate", workspaces: [{ name: "narrate-repo", remoteUrl: NREPO }] }) });
	await tick(120);
	ok("a runner comes back (editor heartbeat) → the parked fix is sent, attempt 3", nCmds.filter((c) => c.kind === "instruct").length === 3 && nCmds[nCmds.length - 1]?.text?.includes("cafe03") === true && issueComments()[9] === "**Checks failed** — the agent is taking a look (attempt 3 of 5).", JSON.stringify(issueComments().slice(9)));
	process.env.CELIADOR_TASK_CI_FIX_ATTEMPTS = "3";
	await checkRun("cafe04");
	await tick(80);
	ok("attempt cap reached → one give-up comment, nothing sent", issueComments()[10]?.startsWith("**Checks failed** — I've made 3 attempts") === true && nCmds.filter((c) => c.kind === "instruct").length === 3, JSON.stringify(issueComments().slice(10)));
	await checkRun("cafe05");
	await tick(80);
	ok("…and only once", issueComments().length === 11);
	delete process.env.CELIADOR_TASK_CI_FIX_ATTEMPTS;
	ok("internal ci bookkeeping is not in the API", (await getTask(nTask.id) as ATask & { ci?: unknown })?.ci === undefined);
	await postStatus(nTask.id, { state: "failed", error: "the push was rejected" });
	await tick();
	ok("failed → one `**Failed.**` comment with the error", issueComments()[11] === "**Failed.** the push was rejected\n\n[Open the queue](https://smoke.test/api/open/queue)", JSON.stringify(issueComments().slice(11)));
	runner.abort.abort();
	await runner.reader;
	nAbort.abort();
	await tick(30);

	// ── Cloud fallback: no editor has the repo → sandboxed run → push → PR as the App ──
	console.log("\n== cloud ==");
	const seed = path.join(HOME, "cloud-seed");
	fs.mkdirSync(seed, { recursive: true });
	await run("git", ["init", "-q", "-b", "main", seed]);
	await run("git", ["-C", seed, "config", "user.email", "s@smoke"]);
	await run("git", ["-C", seed, "config", "user.name", "smoke"]);
	fs.writeFileSync(path.join(seed, "README.md"), "# cloud\n");
	await run("git", ["-C", seed, "add", "-A"]);
	await run("git", ["-C", seed, "commit", "-q", "-m", "init"]);
	const bare = path.join(HOME, "cloud-remote.git");
	await run("git", ["clone", "-q", "--bare", seed, bare]);
	overrideCloudRemoteForTests(() => `file://${bare}`);
	let turns = 0;
	const fakeAgent = async (ctx: { workspaceDir: string; userId: string; runId: string; publish: (e: unknown) => void }) => {
		turns++;
		fs.writeFileSync(path.join(ctx.workspaceDir, turns === 1 ? "fix.ts" : `followup-${turns}.ts`), `export const turn = ${turns};\n`);
		// The agent's model calls go through the gateway with its runner token → attributed to the run.
		await (await app.request(GW, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${mintRunnerToken(ctx.userId, ctx.runId, 300)!}` }, body: gwBodyPlain })).text();
		ctx.publish({ kind: "message", role: "assistant", text: `Plan:\n1. Patch it\n\nPatched (turn ${turns}).\n\n## Self-review\n- What changed: Added fix.ts.\n- Unsure: nothing.\n- Not verified: tests (none in the repo).` });
	};
	overrideServerRunnerForTests({ agent: fakeAgent as never });
	const CLREPO = "https://github.com/Cliefden/cloud-repo.git";
	const cBase = "/repos/Cliefden/cloud-repo";
	const cCalls: GhCall[] = [];
	ghHandler = (call) => {
		cCalls.push(call);
		if (call.path === `${cBase}/installation`) return { status: 200, json: { id: 10 } };
		if (call.path === "/app/installations/10/access_tokens") return { status: 201, json: { token: "ghs_cloud" } };
		if (call.path === cBase) return { status: 200, json: { default_branch: "main" } };
		if (call.path.startsWith(`${cBase}/issues/`) && call.method === "POST") return { status: 201, json: { id: 1 } };
		if (call.path === `${cBase}/pulls` && call.method === "POST") return { status: 201, json: { number: 21, html_url: "https://github.com/Cliefden/cloud-repo/pull/21", additions: 1, deletions: 0, changed_files: 1 } };
		if (call.path === `${cBase}/pulls/21`) return { status: 200, json: { number: 21, html_url: "https://github.com/Cliefden/cloud-repo/pull/21", additions: 1, deletions: 0, changed_files: 1, mergeable: true, merged: false, head: { sha: "c10ud" } } };
		if (call.path.startsWith(`${cBase}/commits/`)) return { status: 200, json: { total_count: 0, check_runs: [], state: "pending", statuses: [] } };
		return { status: 404, json: { message: "Not Found" } };
	};
	const cIssueComments = (n: number) => cCalls.filter((c) => c.path === `${cBase}/issues/${n}/comments` && c.method === "POST").map((c) => String(c.body?.body));
	await app.request(`${T}/repos`, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: CLREPO }) });
	const cRes = await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: CLREPO, issue: { number: 40, title: "Fix it in the cloud", url: issueUrl(40, "cloud-repo") }, details: "Nobody's laptop is on." }) });
	const cTask = ((await cRes.json()) as { task: ATask }).task;
	ok("no editor has the repo → dispatched to the cloud at once", cRes.status === 201 && cTask.state === "dispatched" && cTask.runner === "cloud", JSON.stringify(cTask));
	ok("…and the cloud run reaches pr-open", await until(async () => (await getTask(cTask.id))?.state === "pr-open"), JSON.stringify(await getTask(cTask.id)));
	const cDone = (await getTask(cTask.id)) as ATask & { usage?: Usage; sessionId?: string };
	const cSess = cDone.sessionId ? await getSession(cDone.sessionId) : undefined;
	ok("linked relay session: origin phone, runner server, title = task, done", cSess?.origin === "phone" && cSess.runner === "server" && cSess.title === "Fix it in the cloud" && cSess.state === "done", JSON.stringify(cSess));
	ok("the run's gateway usage is attributed to the task via the runner token", cDone.usage?.requests === 1 && cDone.usage.costUsd === 0.0003 && cSess?.usage?.requests === 1, JSON.stringify(cDone.usage));
	const logLine = (await run("git", ["-C", bare, "log", "-1", "--format=%an <%ae>|%cn|%s", cTask.branch])).stdout.trim();
	ok("branch pushed with the agent's work committed as Celiador <noreply@celiador.ai>, message \"<title> (#n)\"", logLine === "Celiador <noreply@celiador.ai>|Celiador|Fix it in the cloud (#40)", logLine);
	ok("the pushed commit carries the agent's file", (await run("git", ["-C", bare, "ls-tree", "--name-only", cTask.branch])).stdout.includes("fix.ts"));
	const prPost = cCalls.find((c) => c.method === "POST" && c.path === `${cBase}/pulls`);
	const prPostBody = String(prPost?.body?.body ?? "");
	ok("PR opened as the App: head = task branch, base = default branch, title = task", prPost?.body?.head === cTask.branch && prPost.body.base === "main" && prPost.body.title === "Fix it in the cloud", JSON.stringify(prPost?.body));
	ok("PR body: Closes #40, the self-review's what-changed, run in the cloud with files + cost", prPostBody.startsWith("Closes #40\n\n## What the agent did\nAdded fix.ts.\n\n## Self-review\n- Unsure: nothing.\n- Not verified: tests (none in the repo).") && /Run by Celiador on the cloud · 1 file · \d+ s · \$0\.00 \(0\.0k in \/ 0\.0k out tokens\)$/.test(prPostBody), JSON.stringify(prPostBody));
	ok("task pr-open with the PR's number, url and size", cDone.prUrl === "https://github.com/Cliefden/cloud-repo/pull/21" && cDone.pr?.number === 21 && cDone.pr.changedFiles === 1 && !!cDone.finishedAt, JSON.stringify(cDone.pr));
	ok("issue comments: picked up (cloud), plan, PR opened", cIssueComments(40)[0] === `**Picked up.** Running in the Celiador cloud on its own branch, \`${cTask.branch}\`.\n\nI'll open a pull request against \`main\` and link it here. Approvals and questions go to the Celiador queue.\n\n[Watch the run](https://smoke.test/api/open/task/${cTask.id}) · [Open the queue](https://smoke.test/api/open/queue)` && cIssueComments(40)[1] === "**Plan.**\n1. Patch it" && cIssueComments(40)[2] === "Pull request opened: https://github.com/Cliefden/cloud-repo/pull/21", JSON.stringify(cIssueComments(40)));
	// Follow-up: another turn in the same workspace, pushed onto the branch, PR body refreshed.
	const cFu = await app.request(`${T}/${cTask.id}/followup`, { method: "POST", headers: authH, body: JSON.stringify({ text: "also add a test" }) });
	ok("follow-up on a cloud task → 200 (runs again)", cFu.status === 200, `got ${cFu.status}`);
	ok("…runs (running) and finishes (pr-open again)", await until(async () => (await getTask(cTask.id))?.state === "running") && await until(async () => (await getTask(cTask.id))?.state === "pr-open"), JSON.stringify(await getTask(cTask.id)));
	const files2 = (await run("git", ["-C", bare, "ls-tree", "--name-only", cTask.branch])).stdout;
	ok("the follow-up's commit is on the branch too (second turn in the retained workspace)", files2.includes("fix.ts") && files2.includes("followup-2.ts") && (await run("git", ["-C", bare, "rev-list", "--count", `main..${cTask.branch}`])).stdout.trim() === "2", files2);
	ok("PR body refreshed via PATCH after the follow-up", cCalls.some((c) => c.method === "PATCH" && c.path === `${cBase}/pulls/21` && String(c.body?.body).includes("Closes #40") && String(c.body?.body).includes("Run by Celiador on the cloud")), JSON.stringify(cCalls.filter((c) => c.method === "PATCH").map((c) => c.body)));
	const { sessionStores } = await import("../src/sessions/instance.ts");
	const cEvents = sessionStores.for("smoke-user").replay(cDone.sessionId ?? "", 0).events;
	ok("the follow-up is logged as the user's turn on the session", cEvents.some((e) => e.kind === "message" && e.role === "user" && e.text === "also add a test"), JSON.stringify(cEvents.filter((e) => e.kind === "message")));
	ok("cloud run usage grew with the second turn", (await getTask(cTask.id) as ATask & { usage?: Usage })?.usage?.requests === 2, JSON.stringify((await getTask(cTask.id) as ATask & { usage?: Usage })?.usage));
	// Cancel: a slow agent, cancelled from the queue → sandbox killed, task + session cancelled.
	overrideServerRunnerForTests({ agent: ((ctx: { signal: AbortSignal }) => new Promise<void>((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("killed"))))) as never });
	const slow = ((await (await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: CLREPO, issue: { number: 41, title: "Slow one", url: issueUrl(41, "cloud-repo") } }) })).json()) as { task: ATask }).task;
	ok("second cloud task starts running", await until(async () => (await getTask(slow.id))?.state === "running"), JSON.stringify(await getTask(slow.id)));
	await until(async () => (await getSession((await getTask(slow.id) as ATask & { sessionId?: string })?.sessionId ?? ""))?.state === "running");
	const cancelled = await app.request(`${T}/${slow.id}/cancel`, { method: "POST", headers: authH });
	ok("cancel → 200, task cancelled", cancelled.status === 200 && (await getTask(slow.id))?.state === "cancelled");
	const slowSess = (await getTask(slow.id) as ATask & { sessionId?: string })?.sessionId ?? "";
	ok("…and the run's session ends cancelled", await until(async () => (await getSession(slowSess))?.state === "cancelled"), JSON.stringify(await getSession(slowSess)));
	// No changes → failed with a readable error (and a comment).
	overrideServerRunnerForTests({ agent: (async () => undefined) as never });
	const noop = ((await (await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: CLREPO, issue: { number: 42, title: "Nothing to do", url: issueUrl(42, "cloud-repo") } }) })).json()) as { task: ATask }).task;
	ok("an agent that changes nothing → task failed with a readable error", await until(async () => (await getTask(noop.id))?.state === "failed") && /finished without changing anything/.test((await getTask(noop.id) as ATask & { error?: string })?.error ?? ""), JSON.stringify(await getTask(noop.id)));
	await tick();
	ok("…and the issue is told", cIssueComments(42).some((c) => c.startsWith("**Failed.** The agent finished without changing anything.")), JSON.stringify(cIssueComments(42)));
	// No App on the repo → stays queued with the waiting-for-an-editor reason, published once.
	const NOAPP = "https://github.com/Cliefden/noapp-repo.git";
	const noApp = ((await (await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: NOAPP, title: "Private, no app" }) })).json()) as { task: ATask }).task;
	ok("repo without the App → back to queued with the reason", await until(async () => { const t = await getTask(noApp.id) as ATask & { error?: string }; return t?.state === "queued" && t.error === WAITING_FOR_APP; }), JSON.stringify(await getTask(noApp.id)));
	await app.request(T, { method: "POST", headers: authH, body: JSON.stringify({ remoteUrl: NOAPP, title: "Another, same repo" }) });
	await tick(60);
	ok("the repo isn't asked about again right away (negative cache): the next task just queues", (await getTask(noApp.id))?.state === "queued" && cCalls.filter((c) => c.path === "/repos/Cliefden/noapp-repo/installation").length === 1, String(cCalls.filter((c) => c.path.includes("noapp-repo")).length));
	ok("cancel on a server session without an active run → 409 (unchanged)", (await app.request(`http://localhost/api/sessions/${cDone.sessionId}/cancel`, { method: "POST", headers: authH })).status === 409);
	overrideServerRunnerForTests(undefined);
	overrideCloudRemoteForTests(undefined);
	resetGitHubAppForTests();
	ghHandler = () => ({ status: 404, json: { message: "Not Found" } });

	console.log(`\n${pass} passed, ${fail} failed`);
}

main()
	.catch((err) => { console.error(err); fail++; })
	.finally(() => {
		fs.rmSync(HOME, { recursive: true, force: true });
		process.exit(fail === 0 ? 0 : 1);
	});
