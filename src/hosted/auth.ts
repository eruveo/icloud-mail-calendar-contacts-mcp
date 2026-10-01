import { extractBearerToken, hashToken, timingSafeEqualHex } from "./token.js";
import type { StoredUser, UserStore } from "./types.js";

export async function findUserByToken(store: UserStore, token: string): Promise<StoredUser | null> {
  const incomingHash = await hashToken(token);
  const users = await store.list();
  let matched: StoredUser | null = null;
  for (const user of users) {
    if (user.revokedAt !== null) {
      continue;
    }
    if (timingSafeEqualHex(user.tokenHash, incomingHash)) {
      matched = user;
    }
  }
  return matched;
}

export async function authenticateRequest(
  request: Request,
  store: UserStore,
): Promise<{ ok: true; user: StoredUser } | { ok: false; status: number; error: string }> {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return { ok: false, status: 401, error: "Missing Authorization Bearer token." };
  }
  const user = await findUserByToken(store, token);
  if (!user) {
    return { ok: false, status: 401, error: "Invalid or revoked bearer token." };
  }
  return { ok: true, user };
}
