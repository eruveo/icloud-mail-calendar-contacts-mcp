export type ImapCommandPolicy = "read-only" | "read-write";

/**
 * IMAP verbs that mutate mailbox or message state.
 */
export const MUTATING_IMAP_VERBS = [
  "APPEND",
  "CLOSE",
  "COPY",
  "CREATE",
  "DELETE",
  "EXPUNGE",
  "MOVE",
  "RENAME",
  "SELECT",
  "STORE",
  "SUBSCRIBE",
  "UNSUBSCRIBE",
] as const;

const MUTATING_VERB_SET = new Set<string>(MUTATING_IMAP_VERBS);

/** Allowed in read-write mode. CLOSE still blocked because it expunges \Deleted. */
const WRITE_ALLOWED = new Set([
  "APPEND",
  "COPY",
  "CREATE",
  "MOVE",
  "SELECT",
  "STORE",
  "SUBSCRIBE",
  "UNSUBSCRIBE",
  "EXPUNGE",
  "DELETE",
  "RENAME",
]);

const SEEN_SETTING_FETCH = /\b(?:BODY\[|BINARY\[|RFC822(?!\.(?:HEADER|SIZE))\b)/i;

export class ReadOnlyImapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyImapError";
  }
}

export function parseImapClientCommand(line: string): {
  uid: boolean;
  verb: string;
} | null {
  const trimmed = line.replace(/\r?\n$/u, "").trim();
  if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("+")) {
    return null;
  }
  const parts = trimmed.split(/\s+/u);
  if (parts.length < 2) {
    return null;
  }
  let index = 1;
  let uid = false;
  const maybeUid = parts[index]?.toUpperCase();
  if (maybeUid === "UID") {
    uid = true;
    index += 1;
  }
  const verb = parts[index]?.toUpperCase();
  if (!verb) {
    return null;
  }
  return { uid, verb };
}

export function assertImapCommand(raw: string, policy: ImapCommandPolicy): void {
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const parsed = parseImapClientCommand(line);
    if (!parsed) {
      continue;
    }
    if (policy === "read-only") {
      if (MUTATING_VERB_SET.has(parsed.verb)) {
        throw new ReadOnlyImapError(
          `Blocked mutating IMAP command: ${parsed.uid ? "UID " : ""}${parsed.verb}. ICLOUD_READ_ONLY (or mail writes disabled) is in effect.`,
        );
      }
      if (parsed.verb === "FETCH" && SEEN_SETTING_FETCH.test(line)) {
        throw new ReadOnlyImapError(
          "Blocked FETCH that would mark messages as \\Seen. Use BODY.PEEK / BINARY.PEEK only.",
        );
      }
      continue;
    }
    if (parsed.verb === "CLOSE") {
      throw new ReadOnlyImapError(
        "Blocked IMAP CLOSE (it expunges \\Deleted). Use LOGOUT or UNSELECT instead.",
      );
    }
    if (MUTATING_VERB_SET.has(parsed.verb) && !WRITE_ALLOWED.has(parsed.verb)) {
      throw new ReadOnlyImapError(`Blocked IMAP command: ${parsed.verb}`);
    }
  }
}

/** @deprecated use assertImapCommand(raw, "read-only") */
export function assertReadOnlyImapCommand(raw: string): void {
  assertImapCommand(raw, "read-only");
}

export function collectImapClientLines(chunk: Buffer | string): string[] {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  return text.split(/\r?\n/u).filter((line) => line.length > 0);
}
