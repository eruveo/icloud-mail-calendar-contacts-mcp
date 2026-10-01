const SENSITIVE =
  /app[-_]?password|authorization|bearer\s+\S+|icloud_mcp_encryption_key|tokenHash|encryptedAppPassword/giu;

export interface LogFields {
  [key: string]: unknown;
}

export function structuredLog(message: string, fields: LogFields = {}): void {
  const record: LogFields = { msg: message, ts: new Date().toISOString(), ...fields };
  console.error(JSON.stringify(record, redactReplacer));
}

function redactReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(SENSITIVE, "[redacted]");
  }
  if (_key.toLowerCase().includes("password") || _key.toLowerCase().includes("token") || _key.toLowerCase().includes("authorization") || _key.toLowerCase().includes("secret") || _key.toLowerCase().includes("key")) {
    return "[redacted]";
  }
  return value;
}
