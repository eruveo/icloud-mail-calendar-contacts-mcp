import type { KvLike, StoredUser, UserStore } from "./types.js";

const INDEX_KEY = "users:index";
const USER_PREFIX = "user:";

export class KvUserStore implements UserStore {
  constructor(private readonly kv: KvLike) {}

  async get(id: string): Promise<StoredUser | null> {
    const raw = await this.kv.get(`${USER_PREFIX}${id}`);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as StoredUser;
  }

  async list(): Promise<StoredUser[]> {
    const ids = await this.readIndex();
    const users: StoredUser[] = [];
    for (const id of ids) {
      const user = await this.get(id);
      if (user) {
        users.push(user);
      }
    }
    return users;
  }

  async put(user: StoredUser): Promise<void> {
    await this.kv.put(`${USER_PREFIX}${user.id}`, JSON.stringify(user));
    const ids = await this.readIndex();
    if (!ids.includes(user.id)) {
      ids.push(user.id);
      await this.kv.put(INDEX_KEY, JSON.stringify(ids));
    }
  }

  async delete(id: string): Promise<void> {
    await this.kv.delete(`${USER_PREFIX}${id}`);
    const ids = (await this.readIndex()).filter((entry) => entry !== id);
    await this.kv.put(INDEX_KEY, JSON.stringify(ids));
  }

  private async readIndex(): Promise<string[]> {
    const raw = await this.kv.get(INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === "string");
      }
    }
    if (this.kv.list) {
      const keys = await this.kv.list(USER_PREFIX);
      return keys.map((key) => key.slice(USER_PREFIX.length)).filter(Boolean);
    }
    return [];
  }
}

export function cloudflareKv(binding: {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string }): Promise<{ keys: Array<{ name: string }> }>;
}): KvLike {
  return {
    get: (key) => binding.get(key),
    put: (key, value) => binding.put(key, value),
    delete: (key) => binding.delete(key),
    list: async (prefix) => {
      const result = await binding.list({ prefix });
      return result.keys.map((entry) => entry.name);
    },
  };
}

export function restKv(options: { baseUrl: string; token: string; fetchImpl?: typeof fetch }): KvLike {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/u, "");

  async function redis(command: unknown[]): Promise<unknown> {
    const response = await fetchImpl(base, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!response.ok) {
      throw new Error(`KV request failed (HTTP ${response.status})`);
    }
    const payload = (await response.json()) as { result: unknown };
    return payload.result;
  }

  return {
    async get(key) {
      const result = await redis(["GET", key]);
      return typeof result === "string" ? result : null;
    },
    async put(key, value) {
      await redis(["SET", key, value]);
    },
    async delete(key) {
      await redis(["DEL", key]);
    },
    async list(prefix) {
      const result = await redis(["KEYS", `${prefix}*`]);
      return Array.isArray(result) ? result.filter((entry): entry is string => typeof entry === "string") : [];
    },
  };
}

export class MemoryKv implements KvLike {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((key) => key.startsWith(prefix));
  }
}
