import fs from "node:fs";
import path from "node:path";
import { deletedUsers } from "../deleted-users";

/** An APNs device token for one of a user's devices. */
export interface DeviceToken {
  token: string;
  env: string; // "sandbox" | "production" — selects the APNs host
  addedAt: string;
}

/** A Live Activity push token, scoped to one activity id. */
export interface ActivityToken {
  activityId: string;
  token: string;
  env: string;
  addedAt: string;
}

interface PushData {
  devices: DeviceToken[];
  activities: ActivityToken[];
}

/**
 * Per-user push registry, persisted at data/push/<userId>.json. Load on
 * construct, save on mutate. (Ported from the previous daemon; `projectId`
 * generalized to `activityId` since the new backend has no project store.)
 */
export class PushStore {
  private data: PushData = { devices: [], activities: [] };

  constructor(private file: string) {
    if (fs.existsSync(file)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(file, "utf8"));
        this.data = { devices: loaded.devices ?? [], activities: loaded.activities ?? [] };
      } catch {
        // Corrupt file — start clean; it'll be rewritten on the next mutation.
      }
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  devices(): DeviceToken[] {
    return this.data.devices;
  }

  addDevice(token: string, env: string): void {
    this.data.devices = this.data.devices.filter((d) => d.token !== token);
    this.data.devices.push({ token, env, addedAt: new Date().toISOString() });
    this.save();
  }

  removeDevice(token: string): void {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((d) => d.token !== token);
    if (this.data.devices.length !== before) this.save();
  }

  activitiesFor(activityId: string): ActivityToken[] {
    return this.data.activities.filter((a) => a.activityId === activityId);
  }

  addActivity(activityId: string, token: string, env: string): void {
    this.data.activities = this.data.activities.filter(
      (a) => !(a.activityId === activityId && a.token === token)
    );
    this.data.activities.push({ activityId, token, env, addedAt: new Date().toISOString() });
    this.save();
  }

  removeActivitiesFor(activityId: string): void {
    const before = this.data.activities.length;
    this.data.activities = this.data.activities.filter((a) => a.activityId !== activityId);
    if (this.data.activities.length !== before) this.save();
  }

  /** Drop a token APNs reported as dead (410 / Unregistered), wherever it lives. */
  prune(token: string): void {
    const before = this.data.devices.length + this.data.activities.length;
    this.data.devices = this.data.devices.filter((d) => d.token !== token);
    this.data.activities = this.data.activities.filter((a) => a.token !== token);
    if (this.data.devices.length + this.data.activities.length !== before) this.save();
  }
}

/** Per-user PushStore cache, rooted under <root>/data/push. */
export class PushStores {
  private stores = new Map<string, PushStore>();
  constructor(private root: string) {}

  for(userId: string): PushStore {
    // Never create stores for deleted users
    if (deletedUsers.isDeleted(userId)) {
      throw new Error("user deleted");
    }
    let store = this.stores.get(userId);
    if (!store) {
      store = new PushStore(path.join(this.root, "data", "push", `${userId}.json`));
      this.stores.set(userId, store);
    }
    return store;
  }

  /**
   * Evict a user's push store from the cache and delete their push file.
   * MUST be called before deleting the user to prevent mutations from
   * recreating the file.
   */
  evict(userId: string): void {
    this.stores.delete(userId);
    const file = path.join(this.root, "data", "push", `${userId}.json`);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.error(`[PushStores] failed to delete push file for ${userId}:`, err);
    }
  }
}
