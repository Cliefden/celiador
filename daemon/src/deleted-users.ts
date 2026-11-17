import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config";

/**
 * Deleted accounts, refused at token verification (auth.ts `authenticateToken`).
 *
 * JWTs are stateless: after account deletion a still-valid access token (or a
 * daemon-minted runner token for one of the user's runs) would otherwise keep
 * working until it expires. Every authenticated path — `requireUser`, the agent
 * proxy and the gateway (`authorizeAgent`) — resolves the bearer through
 * `authenticateToken`, which refuses ids on this list.
 *
 * The list is persisted (`data/deleted-users.json`, atomic writes), so a restart
 * doesn't reopen the window. Entries are kept for RETENTION_MS — far longer
 * than any token the daemon accepts lives (GoTrue access tokens: an hour;
 * runner tokens: two) — and GoTrue no longer knows the user, so no new token
 * can be issued for them.
 */

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

class DeletedUsersBlocklist {
  private blocked: Map<string, number> | null = null;

  constructor(private readonly file: string) {}

  private load(): Map<string, number> {
    if (this.blocked) return this.blocked;
    const map = new Map<string, number>();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, unknown>;
      for (const [id, at] of Object.entries(raw ?? {})) if (typeof at === "number") map.set(id, at);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        console.error("[auth] deleted-users list unreadable:", err instanceof Error ? err.message : err);
      }
    }
    this.blocked = map;
    return map;
  }

  private save(): void {
    const map = this.load();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Mark a user as deleted (persisted before returning). */
  add(userId: string): void {
    this.load().set(userId, Date.now());
    this.save();
  }

  /** Whether the user's account was deleted. */
  isDeleted(userId: string): boolean {
    return this.load().has(userId);
  }

  /** Drop entries older than the retention window. */
  cleanup(): void {
    const map = this.load();
    const cutoff = Date.now() - RETENTION_MS;
    let changed = false;
    for (const [userId, deletedAt] of map) {
      if (deletedAt < cutoff) {
        map.delete(userId);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** Test seam: forget the in-memory copy so the next check re-reads the file (as a restart would). */
  reloadForTests(): void {
    this.blocked = null;
  }
}

/** Process-wide singleton. */
export const deletedUsers = new DeletedUsersBlocklist(path.join(ROOT, "data", "deleted-users.json"));

// Prune daily-ish; never keeps the process alive.
setInterval(() => {
  try {
    deletedUsers.cleanup();
  } catch (err) {
    console.error("[auth] deleted-users cleanup failed:", err instanceof Error ? err.message : err);
  }
}, 60 * 60 * 1000).unref();
