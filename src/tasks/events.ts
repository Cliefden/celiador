import type { Task } from "./store";

/**
 * Live task changes for the phone's queue: one listener set per user, fed on
 * every create / dispatch / status change. In-memory, best-effort.
 */
type Listener = (task: Task) => void;
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
  for (const listener of listeners.get(userId) ?? []) {
    try {
      listener(task);
    } catch {
      /* a dead stream is reaped on its own abort */
    }
  }
}
