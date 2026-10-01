import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config";
import { deleteAuthUser, deleteUserData } from "./db/repo";

/**
 * Account deletion: permanently delete a user and all their data.
 * 
 * This removes:
 * - Auth user (auth.users) — requires DB role with DELETE permission on auth.users
 * - Profile, chats, messages (public schema) — cascade from auth.users or explicit delete
 * - Push device and Live Activity tokens (data/push/<userId>.json)
 * - Agent session metadata and logs (data/sessions/meta/<userId>.json, data/sessions/log/<userId>.json)
 * 
 * Throws if the database isn't configured or if the DB role lacks auth.users DELETE permission.
 */
export async function deleteAccount(userId: string): Promise<void> {
  // Delete database data (profile → cascades to chats → messages)
  await deleteUserData(userId);
  
  // Delete auth user (requires elevated DB permissions)
  await deleteAuthUser(userId);
  
  // Delete push tokens (device registrations + Live Activity tokens)
  const pushFile = path.join(ROOT, "data", "push", `${userId}.json`);
  try {
    if (fs.existsSync(pushFile)) {
      fs.unlinkSync(pushFile);
    }
  } catch (err) {
    console.error(`[account] failed to delete push file for ${userId}:`, err);
  }
  
  // Delete session metadata
  const metaFile = path.join(ROOT, "data", "sessions", "meta", `${userId}.json`);
  try {
    if (fs.existsSync(metaFile)) {
      fs.unlinkSync(metaFile);
    }
  } catch (err) {
    console.error(`[account] failed to delete session meta for ${userId}:`, err);
  }
  
  // Delete session logs
  const logFile = path.join(ROOT, "data", "sessions", "log", `${userId}.json`);
  try {
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }
  } catch (err) {
    console.error(`[account] failed to delete session log for ${userId}:`, err);
  }
}
