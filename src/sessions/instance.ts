import { ROOT } from "../config";
import { SessionStores } from "./store";

/**
 * Process-wide per-user session registry. Shared so session CRUD (routes),
 * event publishing, and account deletion all hit the same in-memory cache.
 */
export const sessionStores = new SessionStores(ROOT);
