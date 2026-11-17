import type { Server } from "node:http";
import { agentQuota } from "./agent/quota";
import { sessionStores } from "./sessions/instance";

/**
 * Write every debounced store to disk now: the session stores (metadata, event
 * logs, usage) and the agent quota. Their timers are short but a restart lands
 * inside them often enough to lose the last events / usage of every deploy.
 */
export function flushStores(): void {
  sessionStores.flushAll();
  agentQuota.flush();
}

/** How long in-flight requests get to finish before the process exits anyway. */
const SHUTDOWN_GRACE_MS = Number(process.env.CELIADOR_SHUTDOWN_GRACE_MS || 3000);

/**
 * On SIGINT/SIGTERM: stop accepting connections, give in-flight requests a
 * moment (SSE streams never finish on their own, so this is bounded), flush the
 * stores, then exit. A second signal exits at once (after a flush).
 */
export function installShutdown(server: Server): void {
  let stopping = false;
  const finish = (): never => {
    try {
      flushStores();
    } catch (err) {
      console.error("[shutdown] flush failed:", err instanceof Error ? err.message : err);
    }
    process.exit(0);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) finish();
      stopping = true;
      console.log(`[shutdown] ${signal}: draining for up to ${SHUTDOWN_GRACE_MS} ms`);
      server.close(() => finish());
      server.closeIdleConnections?.();
      setTimeout(finish, SHUTDOWN_GRACE_MS);
    });
  }
}
