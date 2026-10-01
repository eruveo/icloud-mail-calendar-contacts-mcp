import { ConfigError } from "../config.js";

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const PREFIX = "v1:";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function parseEncryptionKeyBytes(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ConfigError(
      "Missing ICLOUD_MCP_ENCRYPTION_KEY. Generate one with: openssl rand -hex 32",
    );
  }
  if (/^[0-9a-fA-F]+$/u.test(trimmed) && trimmed.length === KEY_LENGTH * 2) {
    const bytes = new Uint8Array(KEY_LENGTH);
    for (let i = 0; i < KEY_LENGTH; i += 1) {
      bytes[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  try {
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    if (bytes.byteLength === KEY_LENGTH) {
      return bytes;
    }
  } catch {
    // fall through
  }
  throw new ConfigError(
    "ICLOUD_MCP_ENCRYPTION_KEY must be 32 bytes as 64 hex characters (preferred) or standard Base64.",
  );
}

export async function importEncryptionKey(raw: string): Promise<CryptoKey> {
  const bytes = parseEncryptionKeyBytes(raw);
  return crypto.subtle.importKey("raw", toArrayBuffer(bytes), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function encryptSecret(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(encoded),
    ),
  );
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return `${PREFIX}${bytesToBase64(packed)}`;
}

export async function decryptSecret(payload: string, key: CryptoKey): Promise<string> {
  if (!payload.startsWith(PREFIX)) {
    throw new Error("Encrypted credential has an unknown format.");
  }
  const packed = base64ToBytes(payload.slice(PREFIX.length));
  if (packed.byteLength <= IV_LENGTH + 16) {
    throw new Error("Encrypted credential is truncated.");
  }
  const iv = packed.slice(0, IV_LENGTH);
  const cipher = packed.slice(IV_LENGTH);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(cipher),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Failed to decrypt stored credentials. Check ICLOUD_MCP_ENCRYPTION_KEY.");
  }
}
