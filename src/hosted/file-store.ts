import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredUser, UserStore } from "./types.js";

interface FileShape {
  users: StoredUser[];
}

export class FileUserStore implements UserStore {
  constructor(private readonly filePath: string) {}

  async get(id: string): Promise<StoredUser | null> {
    const users = await this.read();
    return users.find((user) => user.id === id) ?? null;
  }

  async list(): Promise<StoredUser[]> {
    return this.read();
  }

  async put(user: StoredUser): Promise<void> {
    const users = await this.read();
    const index = users.findIndex((entry) => entry.id === user.id);
    if (index === -1) {
      users.push(user);
    } else {
      users[index] = user;
    }
    await this.write(users);
  }

  async delete(id: string): Promise<void> {
    const users = (await this.read()).filter((user) => user.id !== id);
    await this.write(users);
  }

  private async read(): Promise<StoredUser[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      return Array.isArray(parsed.users) ? parsed.users : [];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async write(users: StoredUser[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ users }, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.filePath);
  }
}
