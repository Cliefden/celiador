/**
 * Seen GitHub webhook deliveries (`X-GitHub-Delivery`), so a replayed or
 * redelivered one is answered without being processed twice. In memory with a
 * TTL and a size cap: GitHub retries and manual redeliveries come within hours,
 * and the handlers are idempotent enough (a task per issue, merged stays merged)
 * that the window only has to cover those.
 */
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_IDS = 50_000;
/** GitHub's ids are UUIDs; anything longer is not kept. */
const MAX_ID_LENGTH = 100;

export class DeliveryLog {
  /** id → when it was first seen (insertion-ordered, so the oldest come first). */
  private seen = new Map<string, number>();

  constructor(private ttlMs = TTL_MS, private maxIds = MAX_IDS) {}

  /**
   * Claim a delivery id: true the first time (process it), false for a repeat
   * within the TTL. A missing or malformed id can't be deduped and is let through.
   */
  claim(id: string | undefined, now = Date.now()): boolean {
    if (!id || id.length > MAX_ID_LENGTH) return true;
    this.prune(now);
    const at = this.seen.get(id);
    if (at !== undefined && now - at < this.ttlMs) return false;
    this.seen.delete(id);
    this.seen.set(id, now);
    return true;
  }

  /** Forget a claim (the delivery failed, so GitHub's redelivery must be processed). */
  release(id: string | undefined): void {
    if (id) this.seen.delete(id);
  }

  private prune(now: number): void {
    for (const [id, at] of this.seen) {
      if (now - at < this.ttlMs && this.seen.size <= this.maxIds) break;
      this.seen.delete(id);
    }
  }
}

export const githubDeliveries = new DeliveryLog();
