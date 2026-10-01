import type { StoredUser, UserStore } from "./types.js";

export class MemoryUserStore implements UserStore {
  private readonly users = new Map<string, StoredUser>();

  constructor(seed: StoredUser[] = []) {
    for (const user of seed) {
      this.users.set(user.id, structuredClone(user));
    }
  }

  async get(id: string): Promise<StoredUser | null> {
    const user = this.users.get(id);
    return user ? structuredClone(user) : null;
  }

  async list(): Promise<StoredUser[]> {
    return [...this.users.values()].map((user) => structuredClone(user));
  }

  async put(user: StoredUser): Promise<void> {
    this.users.set(user.id, structuredClone(user));
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }
}
