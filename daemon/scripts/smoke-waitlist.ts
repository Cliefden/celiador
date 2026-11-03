/**
 * In-process smoke test for the website waitlist (src/waitlist): double opt-in,
 * one answer for every sign-up, limits, the mail links, and the admin export.
 * Runs the real `createApp()` with the mailer swapped for a recorder — no SMTP,
 * no network. Part of `npm run smoke`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = path.join(os.tmpdir(), `celiador-smoke-waitlist-${process.pid}`);
process.env.SUPABASE_JWT_SECRET ??= "smoke-secret";
process.env.ANTHROPIC_API_KEY ??= "sk-smoke";
process.env.CELIADOR_HOME = HOME;
process.env.CELIADOR_PUBLIC_URL = "https://smoke.test/";
process.env.CELIADOR_ADMIN_EMAILS = "admin@smoke.test";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = ""): void {
	if (cond) { pass++; console.log(`  ok  - ${name}`); }
	else { fail++; console.log(`FAIL  - ${name} ${extra}`); }
}

function userJwt(sub: string, email: string): string {
	const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
	const now = Math.floor(Date.now() / 1000);
	const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 600 })}`;
	return `${input}.${crypto.createHmac("sha256", process.env.SUPABASE_JWT_SECRET!).update(input).digest("base64url")}`;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

async function main(): Promise<void> {
	fs.mkdirSync(HOME, { recursive: true });
	const { createApp } = await import("../src/app.ts");
	const { overrideWaitlistMailerForTests } = await import("../src/waitlist/mailer.ts");
	const { resetWaitlistForTests } = await import("../src/waitlist/routes.ts");
	type Mail = { email: string; lists: string[]; confirmUrl: string; unsubscribeUrl: string };
	const sent: Mail[] = [];
	overrideWaitlistMailerForTests(async (m) => { sent.push(m); });

	const app = createApp();
	const W = "http://localhost/api/waitlist";
	let ip = 1;
	const post = (body: unknown, fromIp = `203.0.113.${ip++}`) =>
		app.request(W, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.9, ${fromIp}` }, body: typeof body === "string" ? body : JSON.stringify(body) });
	const local = (u: string) => u.replace("https://smoke.test", "http://localhost");

	console.log("\n== waitlist: sign-up ==");
	const r1 = await post({ email: "  Ada@Example.com ", lists: ["windows"] });
	await tick();
	ok("new address → 202 { ok }", r1.status === 202 && (await r1.json() as { ok?: boolean }).ok === true);
	ok("…and one confirmation mail, to the normalized address, for the asked list", sent.length === 1 && sent[0]!.email === "ada@example.com" && sent[0]!.lists.join() === "windows", JSON.stringify(sent));
	ok("the links carry an id + token, never the address", !sent[0]!.confirmUrl.includes("ada") && /^https:\/\/smoke\.test\/api\/waitlist\/confirm\?id=[0-9a-f]{32}&t=/.test(sent[0]!.confirmUrl), sent[0]!.confirmUrl);
	const r2 = await post({ email: "ada@example.com", lists: ["windows"] });
	await tick();
	ok("same address again → the same 202, but no second mail (throttled)", r2.status === 202 && sent.length === 1);
	ok("invalid address → 400", (await post({ email: "not-an-email" })).status === 400);
	ok("header-injection attempt → 400", (await post({ email: "a@b.co\r\nBcc: x@y.z" })).status === 400);
	ok("not JSON → 400", (await post("email=a@b.co")).status === 400);
	ok("oversized body → 413", (await post({ email: "a@b.co", pad: "x".repeat(8000) })).status === 413);
	const bot = await post({ email: "bot@example.com", website: "http://spam" });
	await tick();
	ok("honeypot filled → 202 but nothing stored or mailed", bot.status === 202 && !sent.some((m) => m.email === "bot@example.com"));
	const statuses: number[] = [];
	for (let i = 0; i < 7; i++) statuses.push((await post({ email: `flood${i}@example.com` }, "192.0.2.77")).status);
	await tick();
	ok("per-IP limit: 5 per 10 minutes, then 429", statuses.slice(0, 5).every((s) => s === 202) && statuses.slice(5).every((s) => s === 429), statuses.join());

	console.log("\n== waitlist: links ==");
	const mail = sent[0]!;
	const getConfirm = await app.request(local(mail.confirmUrl));
	const getHtml = await getConfirm.text();
	ok("GET confirm only shows a button (mail scanners can't confirm)", getConfirm.status === 200 && getHtml.includes('<form method="post"') && getConfirm.headers.get("cache-control") === "no-store");
	ok("a forged token is refused", (await app.request(local(mail.confirmUrl.replace(/t=[^&]+/, "t=" + "A".repeat(43))), { method: "POST" })).status === 400);
	const confirm = await app.request(local(mail.confirmUrl), { method: "POST" });
	ok("POST confirm → on the list", confirm.status === 200 && (await confirm.text()).includes("on the list"));
	ok("the confirm link is single-use", (await app.request(local(mail.confirmUrl), { method: "POST" })).status === 400);

	const admin = { authorization: `Bearer ${userJwt("admin-user", "admin@smoke.test")}` };
	const exp = await app.request("http://localhost/api/admin/waitlist", { headers: admin });
	const data = (await exp.json()) as { count: number; entries: { email: string; lists: string[]; unsubscribeUrl: string | null }[] };
	ok("admin export lists confirmed addresses with an unsubscribe link", exp.status === 200 && data.count === 1 && data.entries[0]!.email === "ada@example.com" && data.entries[0]!.lists.join() === "windows" && data.entries[0]!.unsubscribeUrl === mail.unsubscribeUrl, JSON.stringify(data));
	const pendingExp = (await (await app.request("http://localhost/api/admin/waitlist?status=pending", { headers: admin })).json()) as { count: number };
	ok("pending (unconfirmed) addresses are listed separately", pendingExp.count === 5, JSON.stringify(pendingExp));
	const csv = await app.request("http://localhost/api/admin/waitlist?format=csv", { headers: admin });
	const csvText = await csv.text();
	ok("CSV export", csv.headers.get("content-type")?.startsWith("text/csv") === true && csvText.split("\n")[1]!.startsWith("ada@example.com,windows,"), csvText);
	const notAdmin = { authorization: `Bearer ${userJwt("someone", "someone@example.com")}` };
	ok("a non-admin gets 404", (await app.request("http://localhost/api/admin/waitlist", { headers: notAdmin })).status === 404);
	ok("no auth → 401", (await app.request("http://localhost/api/admin/waitlist")).status === 401);

	// Already confirmed: still the same answer, and no mail for a list it's on.
	// (Age the per-address mail throttle on disk, then reload, as after a restart.)
	const listFile = path.join(HOME, "data", "waitlist", "list.json");
	const stored = JSON.parse(fs.readFileSync(listFile, "utf8")) as { entries: { lastMailAt: number }[] };
	for (const e of stored.entries) e.lastMailAt = 0;
	fs.writeFileSync(listFile, JSON.stringify(stored));
	resetWaitlistForTests();
	const before = sent.length;
	const again = await post({ email: "ada@example.com", lists: ["windows"] });
	await tick();
	ok("a confirmed address signing up again → same 202, no mail", again.status === 202 && sent.length === before, JSON.stringify(sent.slice(before)));
	const more = await post({ email: "ada@example.com", lists: ["linux", "windows"] });
	await tick();
	ok("…a new list for it needs its own confirmation", more.status === 202 && sent.length === before + 1 && sent.at(-1)!.lists.join() === "linux", JSON.stringify(sent.at(-1)));

	ok("GET unsubscribe only shows a button", (await (await app.request(local(mail.unsubscribeUrl))).text()).includes('<form method="post"'));
	const unsub = await app.request(local(mail.unsubscribeUrl), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
	ok("one-click unsubscribe → 200", unsub.status === 200);
	const after = (await (await app.request("http://localhost/api/admin/waitlist?status=all", { headers: admin })).json()) as { entries: { email: string }[] };
	ok("…and the record is deleted, not flagged", !after.entries.some((e) => e.email === "ada@example.com"), JSON.stringify(after));
	const onDisk = fs.readFileSync(path.join(HOME, "data", "waitlist", "list.json"), "utf8");
	ok("stored file holds no IP address", !onDisk.includes("203.0.113") && !onDisk.includes("192.0.2.77"));

	const erase = await app.request("http://localhost/api/admin/waitlist?email=flood0@example.com", { method: "DELETE", headers: admin });
	ok("admin erasure by address", ((await erase.json()) as { removed: boolean }).removed === true);

	console.log("\n== waitlist: no mailer ==");
	overrideWaitlistMailerForTests(null);
	ok("no SMTP configured → 503 (the site falls back to mailto:)", (await post({ email: "x@example.com" })).status === 503);
	overrideWaitlistMailerForTests(undefined);

	console.log(`\n${pass} passed, ${fail} failed`);
}

main()
	.catch((err) => { console.error(err); fail++; })
	.finally(() => {
		fs.rmSync(HOME, { recursive: true, force: true });
		process.exit(fail === 0 ? 0 : 1);
	});
