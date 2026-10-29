/**
 * Ephemeral, in-memory presence of the repos currently open in a user's editor(s).
 * The editor heartbeats its open workspaces; the phone reads them to offer a
 * "from your editor" repo picker (feeding the existing cloud-run clone). Purely a
 * convenience cache — nothing here is durable, and stale editors age out via TTL.
 */

export interface WorkspaceEntry {
  /** Display name (the workspace folder name). */
  readonly name: string;
  /** Normalised https clone URL of the folder's git remote. */
  readonly remoteUrl: string;
  /** Current branch, when known. */
  readonly branch?: string;
}

interface StoredEntry extends WorkspaceEntry {
  readonly clientId: string;
  lastSeen: number;
}

/** Drop an editor's workspaces this long after its last heartbeat (~3 missed beats). */
const TTL_MS = 90_000;

class WorkspacePresence {
  private readonly byUser = new Map<string, StoredEntry[]>();

  /** Replace everything published by one editor instance (`clientId`). */
  publish(userId: string, clientId: string, items: WorkspaceEntry[], now = Date.now()): void {
    const others = (this.byUser.get(userId) ?? []).filter(
      (w) => w.clientId !== clientId && now - w.lastSeen < TTL_MS
    );
    const mine = items.map((i) => ({ ...i, clientId, lastSeen: now }));
    this.byUser.set(userId, [...others, ...mine]);
  }

  /** Non-expired workspaces for a user, de-duped by remote URL (most-recent wins). */
  list(userId: string, now = Date.now()): WorkspaceEntry[] {
    const live = (this.byUser.get(userId) ?? []).filter((w) => now - w.lastSeen < TTL_MS);
    if (live.length === 0) {
      this.byUser.delete(userId);
    } else {
      this.byUser.set(userId, live);
    }
    const seen = new Map<string, WorkspaceEntry>();
    for (const w of [...live].sort((a, b) => b.lastSeen - a.lastSeen)) {
      const key = w.remoteUrl.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, { name: w.name, remoteUrl: w.remoteUrl, branch: w.branch });
      }
    }
    return [...seen.values()];
  }

  /** Forget a user's presence entirely (e.g. account deletion). */
  clear(userId: string): void {
    this.byUser.delete(userId);
  }
}

/** Process-wide presence cache, shared across requests. */
export const workspacePresence = new WorkspacePresence();
