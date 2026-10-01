import {
  ALL_SERVICES,
  applyReadOnly,
  defaultWritePermissions,
  parseServices,
  type IcloudServiceName,
  type WritePermissions,
} from "../config.js";
import { encryptSecret } from "./crypto.js";
import { generateBearerToken, hashToken } from "./token.js";
import { toPublicUser, type PublicUser, type StoredUser, type UserStore } from "./types.js";

export interface UserPermissionFlags {
  readOnly?: boolean;
  allowSend?: boolean;
  allowMailWrite?: boolean;
  allowCalendarWrite?: boolean;
  allowContactsWrite?: boolean;
  allowDelete?: boolean;
  allowExpunge?: boolean;
}

export function permissionsFromFlags(flags: UserPermissionFlags = {}): WritePermissions {
  const base = defaultWritePermissions();
  return applyReadOnly({
    readOnly: flags.readOnly ?? base.readOnly,
    allowSend: flags.allowSend ?? base.allowSend,
    allowMailWrite: flags.allowMailWrite ?? base.allowMailWrite,
    allowCalendarWrite: flags.allowCalendarWrite ?? base.allowCalendarWrite,
    allowContactsWrite: flags.allowContactsWrite ?? base.allowContactsWrite,
    allowDelete: flags.allowDelete ?? base.allowDelete,
    allowExpunge: flags.allowExpunge ?? base.allowExpunge,
  });
}

function normaliseId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(trimmed)) {
    throw new Error("User id must be 1–64 characters: letters, digits, dot, underscore, hyphen.");
  }
  return trimmed;
}

export async function addUser(
  store: UserStore,
  key: CryptoKey,
  input: {
    id?: string;
    email: string;
    appPassword: string;
    services?: string;
    timezone?: string;
    permissions?: UserPermissionFlags;
    now?: number;
  },
): Promise<{ user: PublicUser; token: string }> {
  const email = input.email.trim();
  if (!email.includes("@")) {
    throw new Error("email must be a full iCloud address.");
  }
  const id = normaliseId(input.id ?? email.split("@")[0] ?? "user");
  const existing = await store.get(id);
  if (existing && existing.revokedAt === null) {
    throw new Error(`User "${id}" already exists. Revoke or rotate instead.`);
  }
  const token = generateBearerToken();
  const now = input.now ?? Date.now();
  const user: StoredUser = {
    id,
    email,
    tokenHash: await hashToken(token),
    encryptedAppPassword: await encryptSecret(input.appPassword, key),
    services: input.services ? parseServices(input.services) : [...ALL_SERVICES],
    timezone: input.timezone ?? "UTC",
    permissions: permissionsFromFlags(input.permissions),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revokedAt: null,
  };
  await store.put(user);
  return { user: toPublicUser(user), token };
}

export async function listUsers(store: UserStore): Promise<PublicUser[]> {
  const users = await store.list();
  return users.map(toPublicUser).sort((a, b) => a.id.localeCompare(b.id));
}

export async function revokeUser(store: UserStore, id: string, now = Date.now()): Promise<PublicUser> {
  const user = await store.get(normaliseId(id));
  if (!user) {
    throw new Error(`User "${id}" not found.`);
  }
  user.revokedAt = now;
  user.updatedAt = now;
  await store.put(user);
  return toPublicUser(user);
}

export async function rotateToken(
  store: UserStore,
  id: string,
  now = Date.now(),
): Promise<{ user: PublicUser; token: string }> {
  const user = await store.get(normaliseId(id));
  if (!user) {
    throw new Error(`User "${id}" not found.`);
  }
  const token = generateBearerToken();
  user.tokenHash = await hashToken(token);
  user.revokedAt = null;
  user.updatedAt = now;
  await store.put(user);
  return { user: toPublicUser(user), token };
}

export function enabledServices(user: StoredUser, mailSupported: boolean): IcloudServiceName[] {
  if (mailSupported) {
    return user.services;
  }
  return user.services.filter((name) => name !== "mail");
}
