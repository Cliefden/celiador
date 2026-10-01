import { deleteAuthUser as dbDeleteAuthUser } from "./db/repo";
import { sessionStores } from "./sessions/instance";
import { pushStores } from "./push/instance";
import { sessionBus } from "./sessions/bus";

/**
 * Account deletion: permanently delete a user and all their data.
 * 
 * Order of operations (fail-safe):
 * 1. Delete auth.users (cascades to profiles, chats, messages via ON DELETE CASCADE)
 * 2. Evict from in-memory caches and close all live streams
 * 3. Delete local files (push tokens, session metadata/logs)
 * 
 * If step 1 fails (e.g. missing GRANT), nothing is deleted and the user remains intact.
 * 
 * Requires: DB role with DELETE permission on auth.users:
 *   GRANT DELETE ON auth.users TO <your_db_role>;
 * 
 * Throws if the database isn't configured or if the DB role lacks permission.
 * 
 * @param deleteAuthUser Injectable for testing (defaults to the real DB delete)
 */
export async function deleteAccount(
  userId: string,
  deleteAuthUser: (userId: string) => Promise<void> = dbDeleteAuthUser
): Promise<void> {
  // Step 1: Delete auth user FIRST. ON DELETE CASCADE removes profiles, chats, messages.
  // If this fails (e.g. missing GRANT), we throw and leave everything untouched.
  await deleteAuthUser(userId);
  
  // Step 2: Evict from caches and close streams. This prevents any pending debounced
  // saves from recreating files and stops all live SSE connections.
  const sessionIds = sessionStores.evict(userId);
  sessionBus.closeSessions(sessionIds);
  pushStores.evict(userId);
  
  // Step 3 is handled by the evict methods above (they delete files after cache eviction).
}
