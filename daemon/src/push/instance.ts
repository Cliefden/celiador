import { ROOT } from "../config";
import { PushStores } from "./store";

/**
 * Process-wide per-user push registry. Shared so token registration (push routes)
 * and event-driven sends (the session relay) hit the same in-memory cache.
 */
export const pushStores = new PushStores(ROOT);
