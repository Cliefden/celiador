import { publicTask, type Task } from "./store";

/**
 * Live task changes for the phone's queue: one listener set per user, fed on
 * every create / dispatch / status change. In-memory, best-effort. Listeners
 * get the public shape (internal bookkeeping stripped).
 */
type Listener = (task: ReturnType<typeof publicTask>) => void;
const listeners = new Map<string, Set<Listener>>();

export function onTaskChange(userId: string, listener: Listener): () => void {
  const set = listeners.get(userId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(userId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(userId);
  };
}

export function publishTaskChange(userId: string, task: Task): void {
  const set = listeners.get(userId);
  if (!set) return;
  const shown = publicTask(task);
  for (const listener of set) {
    try {
      listener(shown);
    } catch {
      /* a dead stream is reaped on its own abort */
    }
  }
}
