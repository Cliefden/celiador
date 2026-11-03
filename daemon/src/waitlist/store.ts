import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The website's waitlist ("one email when Windows ships", early access), kept
 * the way the daemon keeps its other state: one JSON file under data/, written
 * atomically (tmp + rename), loaded once. Sign-ups are double opt-in: an
 * address is only *on* a list after its owner clicks the link we mailed.
 *
 * Minimal data (GDPR art. 5(1)(c)): the address, which lists it asked for, and
 * when. No IP, no user agent, no name. Unconfirmed requests are forgotten after
 * PENDING_TTL_MS; unsubscribing deletes the record, it doesn't flag it.
 *
 * Links never carry the address: each record has a random `id`, and the
 * confirm / unsubscribe tokens are HMACs over it with a per-install secret
 * (CELIADOR_WAITLIST_SECRET, else generated into data/waitlist/secret). The
 * unsubscribe token is stable, so an export can print a working unsubscribe
 * link per address for the announcement mail; the confirm token is bound to a
 * nonce that is dropped on confirmation, so an old link can't re-subscribe.
 */

export const LISTS = ["early-access", "windows", "linux"] as const;
export type WaitlistName = (typeof LISTS)[number];

export interface WaitlistEntry {
  /** Random handle used in links instead of the address. */
  id: string;
  /** Normalized (trimmed, lower-cased) address. */
  email: string;
  /** Lists the owner confirmed. */
  lists: WaitlistName[];
  /** Lists asked for and awaiting the confirmation click. */
  pending: WaitlistName[];
  /** Binds the current confirmation token; null when nothing is pending. */
  nonce: string | null;
  createdAt: string;
  confirmedAt: string | null;
  pendingSince: string | null;
  /** Per-address mail throttle (so the form can't be used to mail-bomb someone). */
  lastMailAt: number;
  mailDay: string;
  mailsToday: number;
}

/** A confirmation mail to send: who, and the two links it carries. */
export interface ConfirmMail {
  email: string;
  lists: WaitlistName[];
  confirmUrl: string;
  unsubscribeUrl: string;
}

export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** At most one confirmation mail per address per this long… */
const MAIL_GAP_MS = 5 * 60 * 1000;
/** …and at most this many per UTC day. */
const MAILS_PER_DAY = 3;
/** Hard cap on records so a flood of distinct addresses can't grow the file without bound. */
const MAX_ENTRIES = Number(process.env.CELIADOR_WAITLIST_MAX_ENTRIES || 50_000);

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

/** Normalize and validate an address; null when it isn't one we'd mail. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(email)) return null;
  if (!EMAIL.test(email)) return null;
  const [local, domain] = email.split("@") as [string, string];
  if (local.length > 64 || domain.includes("..") || domain.startsWith(".") || domain.startsWith("-")) return null;
  return email;
}

/** The requested lists, filtered to known ones; defaults to early access. */
export function normalizeLists(raw: unknown): WaitlistName[] {
  const asked = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out = LISTS.filter((l) => asked.includes(l));
  return out.length ? [...out] : ["early-access"];
}

interface FileShape {
  entries: WaitlistEntry[];
}

export class WaitlistStore {
  private entries = new Map<string, WaitlistEntry>(); // by email
  private byId = new Map<string, WaitlistEntry>();
  private secret: Buffer;

  constructor(
    private dir: string,
    private publicUrl: string
  ) {
    this.secret = this.loadSecret();
    const file = this.file();
    if (fs.existsSync(file)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<FileShape>;
        for (const e of loaded.entries ?? []) this.index(e);
      } catch (err) {
        // Don't start clean over a corrupt list: the next save would erase it.
        throw new Error(`[waitlist] ${file} is unreadable: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private file(): string {
    return path.join(this.dir, "list.json");
  }

  private loadSecret(): Buffer {
    const fromEnv = process.env.CELIADOR_WAITLIST_SECRET;
    if (fromEnv) return Buffer.from(fromEnv, "utf8");
    const file = path.join(this.dir, "secret");
    try {
      return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
    } catch {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const secret = crypto.randomBytes(32);
      fs.writeFileSync(file, secret.toString("hex"), { mode: 0o600 });
      return secret;
    }
  }

  private index(e: WaitlistEntry): void {
    this.entries.set(e.email, e);
    this.byId.set(e.id, e);
  }

  private drop(e: WaitlistEntry): void {
    this.entries.delete(e.email);
    this.byId.delete(e.id);
  }

  private save(): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file()}.tmp`;
    const data: FileShape = { entries: [...this.entries.values()] };
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file());
  }

  private hmac(kind: "confirm" | "unsubscribe", ...parts: string[]): string {
    return crypto.createHmac("sha256", this.secret).update([kind, ...parts].join("\n")).digest("base64url");
  }

  private static same(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }

  confirmUrl(e: WaitlistEntry): string {
    return `${this.publicUrl}/api/waitlist/confirm?id=${e.id}&t=${this.hmac("confirm", e.id, e.nonce ?? "")}`;
  }

  unsubscribeUrl(e: WaitlistEntry): string {
    return `${this.publicUrl}/api/waitlist/unsubscribe?id=${e.id}&t=${this.hmac("unsubscribe", e.id)}`;
  }

  /** Forget unconfirmed requests older than PENDING_TTL_MS. */
  purge(now = Date.now()): void {
    let changed = false;
    for (const e of [...this.entries.values()]) {
      if (!e.pendingSince || now - Date.parse(e.pendingSince) < PENDING_TTL_MS) continue;
      changed = true;
      if (e.lists.length === 0) {
        this.drop(e);
      } else {
        e.pending = [];
        e.nonce = null;
        e.pendingSince = null;
      }
    }
    if (changed) this.save();
  }

  /**
   * Record a sign-up request. Returns the confirmation mail to send, or null
   * when there's nothing to send (already confirmed for these lists, throttled,
   * list full, or `mayMail` said no). Callers must answer the visitor the same
   * way either way — the response must not tell whether an address is known.
   */
  signup(email: string, lists: WaitlistName[], mayMail: () => boolean, now = Date.now()): ConfirmMail | null {
    this.purge(now);
    let e = this.entries.get(email);
    if (!e) {
      if (this.entries.size >= MAX_ENTRIES) {
        console.warn(`[waitlist] list is full (${MAX_ENTRIES}); sign-up dropped`);
        return null;
      }
      e = {
        id: crypto.randomBytes(16).toString("hex"),
        email,
        lists: [],
        pending: [],
        nonce: null,
        createdAt: new Date(now).toISOString(),
        confirmedAt: null,
        pendingSince: null,
        lastMailAt: 0,
        mailDay: "",
        mailsToday: 0,
      };
    }
    const wanted = lists.filter((l) => !e.lists.includes(l));
    if (wanted.length === 0) return null; // already on every list asked for
    const isNew = !this.entries.has(email);
    e.pending = LISTS.filter((l) => e.pending.includes(l) || wanted.includes(l));
    if (!e.nonce) {
      e.nonce = crypto.randomBytes(12).toString("hex");
      e.pendingSince = new Date(now).toISOString();
    }

    const day = new Date(now).toISOString().slice(0, 10);
    if (e.mailDay !== day) {
      e.mailDay = day;
      e.mailsToday = 0;
    }
    const throttled = now - e.lastMailAt < MAIL_GAP_MS || e.mailsToday >= MAILS_PER_DAY;
    const send = !throttled && mayMail();
    if (send) {
      e.lastMailAt = now;
      e.mailsToday++;
    }
    if (isNew) this.index(e);
    this.save();
    return send ? { email, lists: [...e.pending], confirmUrl: this.confirmUrl(e), unsubscribeUrl: this.unsubscribeUrl(e) } : null;
  }

  /** The confirmation click. Returns the lists the address is now on, or null for a bad/expired link. */
  confirm(id: string, token: string, now = Date.now()): WaitlistName[] | null {
    this.purge(now);
    const e = this.byId.get(id);
    // No nonce = nothing pending (already confirmed, or expired): the link is spent.
    if (!e?.nonce) return null;
    if (!WaitlistStore.same(token, this.hmac("confirm", e.id, e.nonce))) return null;
    e.lists = LISTS.filter((l) => e.lists.includes(l) || e.pending.includes(l));
    e.pending = [];
    e.nonce = null;
    e.pendingSince = null;
    e.confirmedAt ??= new Date(now).toISOString();
    this.save();
    return [...e.lists];
  }

  /** The unsubscribe link (also in the confirmation mail, as "this wasn't me"). Deletes the record. */
  unsubscribe(id: string, token: string): boolean {
    const e = this.byId.get(id);
    if (!e || !WaitlistStore.same(token, this.hmac("unsubscribe", e.id))) return false;
    this.drop(e);
    this.save();
    return true;
  }

  /** Erase an address on request (admin). True when it was there. */
  remove(email: string): boolean {
    const e = this.entries.get(email);
    if (!e) return false;
    this.drop(e);
    this.save();
    return true;
  }

  /** Everything, for the operator's export. */
  all(now = Date.now()): WaitlistEntry[] {
    this.purge(now);
    return [...this.entries.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
