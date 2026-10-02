/**
 * In-process blocklist of deleted user IDs.
 * 
 * JWTs are stateless, so after account deletion a user can still call the API
 * with a valid token until it expires. This blocklist prevents:
 * - Deleted users from making API calls
 * - SessionStores.for() and PushStores.for() from recreating files
 * 
 * Entries are kept for at least MAX_JWT_LIFETIME to ensure all tokens expire.
 */

const MAX_JWT_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours

interface BlockedUser {
  userId: string;
  deletedAt: number;
}

class DeletedUsersBlocklist {
  private blocked = new Map<string, number>();

  /** Mark a user as deleted. They will be blocked for at least 24h. */
  add(userId: string): void {
    this.blocked.set(userId, Date.now());
  }

  /** Check if a user is deleted (blocked). */
  isDeleted(userId: string): boolean {
    return this.blocked.has(userId);
  }

  /** Remove expired entries (older than MAX_JWT_LIFETIME). Called periodically. */
  cleanup(): void {
    const cutoff = Date.now() - MAX_JWT_LIFETIME_MS;
    for (const [userId, deletedAt] of this.blocked.entries()) {
      if (deletedAt < cutoff) {
        this.blocked.delete(userId);
      }
    }
  }
}

/** Process-wide singleton. */
export const deletedUsers = new DeletedUsersBlocklist();

// Cleanup every hour
setInterval(() => deletedUsers.cleanup(), 60 * 60 * 1000);
