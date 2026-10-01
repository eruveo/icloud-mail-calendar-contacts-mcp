import type { IcloudServiceName, WritePermissions } from "../config.js";

export interface StoredUser {
  id: string;
  /** iCloud address. Visible to the server operator. */
  email: string;
  tokenHash: string;
  encryptedAppPassword: string;
  services: IcloudServiceName[];
  timezone: string;
  permissions: WritePermissions;
  createdAt: number;
  updatedAt: number;
  revokedAt: number | null;
}

export interface PublicUser {
  id: string;
  email: string;
  services: IcloudServiceName[];
  timezone: string;
  permissions: WritePermissions;
  createdAt: number;
  updatedAt: number;
  revoked: boolean;
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    services: user.services,
    timezone: user.timezone,
    permissions: user.permissions,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    revoked: user.revokedAt !== null,
  };
}

export interface UserStore {
  get(id: string): Promise<StoredUser | null>;
  list(): Promise<StoredUser[]>;
  put(user: StoredUser): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list?(prefix: string): Promise<string[]>;
}
