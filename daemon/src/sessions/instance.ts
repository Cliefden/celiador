import { ROOT } from "../config";
import { SessionStores } from "./store";

/**
 * Process-wide per-user session stores. Shared so the relay routes and account
 * deletion (which purges a user's sessions) hit the same in-memory cache.
 */
export const sessionStores = new SessionStores(ROOT);
