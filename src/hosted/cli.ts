import { ConfigError, readEnv } from "../config.js";
import { importEncryptionKey } from "./crypto.js";
import { FileUserStore } from "./file-store.js";
import { cloudflareKv, KvUserStore, restKv } from "./kv-store.js";
import { addUser, listUsers, revokeUser, rotateToken, type UserPermissionFlags } from "./users.js";
import type { UserStore } from "./types.js";

export const CLI_COMMANDS = ["serve", "add-user", "list-users", "revoke-user", "rotate-token"] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

export function isCliCommand(value: string | undefined): value is CliCommand {
  return CLI_COMMANDS.includes(value as CliCommand);
}

export interface ParsedCli {
  command: CliCommand;
  flags: Record<string, string | boolean>;
}

export function parseCli(argv: string[]): ParsedCli {
  const [command, ...rest] = argv;
  if (!isCliCommand(command)) {
    throw new Error(
      `Unknown command "${command ?? ""}". Use serve | add-user | list-users | revoke-user | rotate-token.`,
    );
  }
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags[body] = next;
      i += 1;
      continue;
    }
    flags[body] = true;
  }
  return { command, flags };
}

function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function flagBool(flags: Record<string, string | boolean>, name: string): boolean | undefined {
  if (flags[`no-${name}`] === true) {
    return false;
  }
  if (flags[name] === true) {
    return true;
  }
  if (typeof flags[name] === "string") {
    return ["1", "true", "yes", "on"].includes(String(flags[name]).toLowerCase());
  }
  return undefined;
}

export function permissionFlagsFromCli(flags: Record<string, string | boolean>): UserPermissionFlags {
  return {
    readOnly: flagBool(flags, "read-only"),
    allowSend: flagBool(flags, "allow-send"),
    allowMailWrite: flagBool(flags, "allow-mail-write"),
    allowCalendarWrite: flagBool(flags, "allow-calendar-write"),
    allowContactsWrite: flagBool(flags, "allow-contacts-write"),
    allowDelete: flagBool(flags, "allow-delete"),
    allowExpunge: flagBool(flags, "allow-expunge"),
  };
}

export function defaultUsersFile(env: NodeJS.ProcessEnv = process.env): string {
  return readEnv(env, "ICLOUD_MCP_USERS_FILE") ?? "./data/users.json";
}

export function openUserStore(env: NodeJS.ProcessEnv = process.env): UserStore {
  const restUrl = readEnv(env, "UPSTASH_REDIS_REST_URL") ?? readEnv(env, "ICLOUD_MCP_KV_REST_URL");
  const restToken = readEnv(env, "UPSTASH_REDIS_REST_TOKEN") ?? readEnv(env, "ICLOUD_MCP_KV_REST_TOKEN");
  if (restUrl && restToken) {
    return new KvUserStore(restKv({ baseUrl: restUrl, token: restToken }));
  }
  return new FileUserStore(defaultUsersFile(env));
}

export async function openEncryptionKey(env: NodeJS.ProcessEnv = process.env): Promise<CryptoKey> {
  const raw = readEnv(env, "ICLOUD_MCP_ENCRYPTION_KEY");
  if (!raw) {
    throw new ConfigError("Missing ICLOUD_MCP_ENCRYPTION_KEY. Generate one with: openssl rand -hex 32");
  }
  return importEncryptionKey(raw);
}

function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

export async function runAdminCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const parsed = parseCli(argv);
  const store = openUserStore(env);
  const key = await openEncryptionKey(env);

  if (parsed.command === "list-users") {
    const users = await listUsers(store);
    writeLine(JSON.stringify(users, null, 2));
    return;
  }

  if (parsed.command === "add-user") {
    const email = flagString(parsed.flags, "email");
    const appPassword = flagString(parsed.flags, "app-password");
    if (!email || !appPassword) {
      throw new Error("add-user requires --email and --app-password.");
    }
    const result = await addUser(store, key, {
      id: flagString(parsed.flags, "id"),
      email,
      appPassword,
      services: flagString(parsed.flags, "services"),
      timezone: flagString(parsed.flags, "timezone"),
      permissions: permissionFlagsFromCli(parsed.flags),
    });
    writeLine("User created. Store this bearer token now; it cannot be retrieved later:");
    writeLine(result.token);
    writeLine(JSON.stringify(result.user, null, 2));
    return;
  }

  if (parsed.command === "revoke-user") {
    const id = flagString(parsed.flags, "id");
    if (!id) {
      throw new Error("revoke-user requires --id.");
    }
    const user = await revokeUser(store, id);
    writeLine(JSON.stringify(user, null, 2));
    return;
  }

  if (parsed.command === "rotate-token") {
    const id = flagString(parsed.flags, "id");
    if (!id) {
      throw new Error("rotate-token requires --id.");
    }
    const result = await rotateToken(store, id);
    writeLine("New bearer token (shown once):");
    writeLine(result.token);
    writeLine(JSON.stringify(result.user, null, 2));
  }
}

export { KvUserStore, cloudflareKv, restKv };
