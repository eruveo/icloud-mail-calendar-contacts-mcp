import {
  DEFAULT_BODY_CHAR_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_BODY_CHAR_LIMIT,
  MAX_SEARCH_LIMIT,
  assertAllowed,
  type WritePermissions,
} from "./config.js";
import { lastPathSegment, resolveMailboxPath } from "./folders.js";
import { ImapSession, withMailbox } from "./imap-session.js";
import {
  formatAddressList,
  parseRfc822,
  snippetFromText,
  truncateBody,
} from "./parse-mail.js";
import type {
  FetchedMessage,
  GetMessageInput,
  ImapConnection,
  ListRecentInput,
  ListedMailbox,
  MailboxListEntry,
  MessageDetail,
  MessageSummary,
  SearchMessagesInput,
  SearchQuery,
} from "./types.js";

function flagsToArray(flags: FetchedMessage["flags"]): string[] {
  if (!flags) {
    return [];
  }
  return [...flags];
}

function dateToIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function parseDateInput(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Invalid date "${value}". Use ISO-8601 (2026-03-01 or 2026-03-01T00:00:00Z).`,
    );
  }
  return date;
}

export function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  const value = limit ?? fallback;
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`limit must be between 1 and ${max}`);
  }
  return Math.min(Math.floor(value), max);
}

async function listAvailablePaths(client: ImapConnection): Promise<string[]> {
  const boxes = await client.list();
  const paths = boxes.map((box) => box.path);
  if (!paths.some((path) => path.toUpperCase() === "INBOX")) {
    paths.unshift("INBOX");
  }
  return paths;
}

async function resolvePath(
  client: ImapConnection,
  requested: string | undefined,
): Promise<string> {
  const paths = await listAvailablePaths(client);
  return resolveMailboxPath(requested, paths);
}

function toMailboxEntry(box: ListedMailbox): MailboxListEntry {
  return {
    path: box.path,
    name: box.name || lastPathSegment(box.path, box.delimiter ?? "/"),
    delimiter: box.delimiter ?? "/",
    specialUse: box.specialUse ?? undefined,
    messages: box.status?.messages ?? null,
    unseen: box.status?.unseen ?? null,
    recent: box.status?.recent ?? null,
  };
}

async function fillStatus(
  client: ImapConnection,
  entry: MailboxListEntry,
): Promise<MailboxListEntry> {
  if (entry.messages !== null && entry.unseen !== null) {
    return entry;
  }
  try {
    const status = await client.status(entry.path, {
      messages: true,
      unseen: true,
      recent: true,
    });
    return {
      ...entry,
      messages: status.messages ?? entry.messages,
      unseen: status.unseen ?? entry.unseen,
      recent: status.recent ?? entry.recent,
    };
  } catch {
    return entry;
  }
}

function headersFromFetched(message: FetchedMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  if (message.headers && !(message.headers instanceof Buffer)) {
    for (const [key, value] of Object.entries(message.headers)) {
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
  }
  const envelope = message.envelope;
  if (envelope) {
    if (!headers.subject && envelope.subject) {
      headers.subject = envelope.subject;
    }
    if (!headers.from && envelope.from) {
      headers.from = formatAddressList(envelope.from);
    }
    if (!headers.to && envelope.to) {
      headers.to = formatAddressList(envelope.to);
    }
    if (!headers.cc && envelope.cc) {
      headers.cc = formatAddressList(envelope.cc);
    }
    if (!headers.date && envelope.date) {
      const iso = dateToIso(envelope.date);
      if (iso) {
        headers.date = iso;
      }
    }
  }
  return headers;
}

function mergeRawHeaders(headers: Record<string, string>, raw: Buffer): void {
  for (const line of raw.toString("utf8").split(/\r?\n/u)) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (key && !(key in headers)) {
        headers[key] = value;
      }
    }
  }
}

async function summaryFromFetched(
  mailbox: string,
  message: FetchedMessage,
): Promise<MessageSummary> {
  const envelope = message.envelope;
  let snippet = "";
  if (message.source) {
    const parsed = await parseRfc822(message.source);
    snippet = snippetFromText(parsed.text);
  } else if (message.bodyParts?.has("TEXT")) {
    snippet = snippetFromText(message.bodyParts.get("TEXT")?.toString("utf8") ?? "");
  } else {
    snippet = snippetFromText(envelope?.subject ?? "");
  }
  return {
    uid: message.uid,
    mailbox,
    date: dateToIso(envelope?.date ?? message.internalDate),
    from: formatAddressList(envelope?.from),
    to: formatAddressList(envelope?.to),
    subject: envelope?.subject ?? "(no subject)",
    snippet,
    flags: flagsToArray(message.flags),
  };
}

async function collectFetch(
  client: ImapConnection,
  uids: number[],
): Promise<FetchedMessage[]> {
  if (uids.length === 0) {
    return [];
  }
  const collected: FetchedMessage[] = [];
  for await (const message of client.fetch(
    uids,
    {
      uid: true,
      flags: true,
      envelope: true,
      internalDate: true,
      source: { start: 0, maxLength: 12_288 },
    },
    { uid: true },
  )) {
    collected.push(message);
  }
  collected.sort((a, b) => b.uid - a.uid);
  return collected;
}

export class IcloudMailService {
  constructor(
    private readonly session: ImapSession,
    private readonly permissions: WritePermissions,
  ) {}

  async listMailboxes(): Promise<MailboxListEntry[]> {
    return this.session.withConnection(async (client) => {
      const listed = await client.list({
        statusQuery: { messages: true, unseen: true, recent: true },
      });
      const entries = listed.map(toMailboxEntry);
      return Promise.all(entries.map((entry) => fillStatus(client, entry)));
    });
  }

  async searchMessages(input: SearchMessagesInput): Promise<MessageSummary[]> {
    const limit = clampLimit(input.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    return this.session.withConnection(async (client) => {
      const mailbox = await resolvePath(client, input.mailbox);
      return withMailbox(client, mailbox, true, async () => {
        const query: SearchQuery = {};
        if (input.from) {
          query.from = input.from;
        }
        if (input.to) {
          query.to = input.to;
        }
        if (input.subject) {
          query.subject = input.subject;
        }
        if (input.body) {
          query.body = input.body;
        }
        if (input.unread === true) {
          query.seen = false;
        }
        const since = parseDateInput(input.since);
        const before = parseDateInput(input.before);
        if (since) {
          query.since = since;
        }
        if (before) {
          query.before = before;
        }
        const found = (await client.search(query, { uid: true })) || [];
        const newest = [...found].sort((a, b) => b - a).slice(0, limit);
        const fetched = await collectFetch(client, newest);
        return Promise.all(fetched.map((message) => summaryFromFetched(mailbox, message)));
      });
    });
  }

  async listRecentMessages(input: ListRecentInput): Promise<MessageSummary[]> {
    return this.searchMessages({
      mailbox: input.mailbox,
      limit: input.limit,
      since: input.since,
    });
  }

  async getMessage(input: GetMessageInput): Promise<MessageDetail> {
    const maxBodyChars = clampLimit(
      input.maxBodyChars,
      DEFAULT_BODY_CHAR_LIMIT,
      MAX_BODY_CHAR_LIMIT,
    );
    if (!Number.isInteger(input.uid) || input.uid < 1) {
      throw new Error("uid must be a positive integer from search_messages or list_recent_messages.");
    }
    return this.session.withConnection(async (client) => {
      const mailbox = await resolvePath(client, input.mailbox);
      return withMailbox(client, mailbox, true, async () => {
        const message = await client.fetchOne(
          input.uid,
          {
            uid: true,
            flags: true,
            envelope: true,
            internalDate: true,
            headers: true,
            bodyStructure: true,
            source: true,
          },
          { uid: true },
        );
        if (!message) {
          throw new Error(`No message with uid ${input.uid} in ${mailbox}.`);
        }
        const parsed = message.source
          ? await parseRfc822(message.source)
          : { text: "", html: null, attachments: [] };
        const body = truncateBody(parsed.text || "(empty body)", maxBodyChars);
        const headers = headersFromFetched(message);
        if (message.headers instanceof Buffer) {
          mergeRawHeaders(headers, message.headers);
        }
        return {
          uid: message.uid,
          mailbox,
          date: dateToIso(message.envelope?.date ?? message.internalDate),
          from: formatAddressList(message.envelope?.from),
          to: formatAddressList(message.envelope?.to),
          cc: formatAddressList(message.envelope?.cc),
          subject: message.envelope?.subject ?? headers.subject ?? "(no subject)",
          flags: flagsToArray(message.flags),
          headers,
          messageId: headers["message-id"] ?? null,
          body: body.text,
          truncated: body.truncated,
          attachments: parsed.attachments,
        };
      });
    });
  }

  async markMessage(input: {
    uid: number;
    mailbox?: string;
    seen?: boolean;
    flagged?: boolean;
  }): Promise<{ uid: number; mailbox: string; flagsChanged: string[] }> {
    assertAllowed(this.permissions, "allowMailWrite", "change message flags");
    const changed: string[] = [];
    return this.session.withConnection(async (client) => {
      const mailbox = await resolvePath(client, input.mailbox);
      return withMailbox(client, mailbox, false, async () => {
        if (input.seen === true) {
          await client.messageFlagsAdd(input.uid, ["\\Seen"], { uid: true });
          changed.push("\\Seen");
        } else if (input.seen === false) {
          await client.messageFlagsRemove(input.uid, ["\\Seen"], { uid: true });
          changed.push("-\\Seen");
        }
        if (input.flagged === true) {
          await client.messageFlagsAdd(input.uid, ["\\Flagged"], { uid: true });
          changed.push("\\Flagged");
        } else if (input.flagged === false) {
          await client.messageFlagsRemove(input.uid, ["\\Flagged"], { uid: true });
          changed.push("-\\Flagged");
        }
        if (changed.length === 0) {
          throw new Error("Provide seen and/or flagged (true or false).");
        }
        return { uid: input.uid, mailbox, flagsChanged: changed };
      });
    });
  }

  async moveMessage(input: {
    uid: number;
    from?: string;
    to: string;
  }): Promise<{ uid: number; from: string; to: string }> {
    assertAllowed(this.permissions, "allowMailWrite", "move a message");
    return this.session.withConnection(async (client) => {
      const from = await resolvePath(client, input.from);
      const to = await resolvePath(client, input.to);
      return withMailbox(client, from, false, async () => {
        await client.messageMove(input.uid, to, { uid: true });
        return { uid: input.uid, from, to };
      });
    });
  }

  async createMailbox(name: string): Promise<{ path: string }> {
    assertAllowed(this.permissions, "allowMailWrite", "create a mailbox");
    const path = name.trim();
    if (!path) {
      throw new Error("Mailbox name is required.");
    }
    return this.session.withConnection(async (client) => {
      await client.mailboxCreate(path);
      return { path };
    });
  }

  async saveDraft(rawRfc822: Buffer | string): Promise<{ mailbox: string }> {
    assertAllowed(this.permissions, "allowMailWrite", "save a draft");
    return this.session.withConnection(async (client) => {
      const mailbox = await resolvePath(client, "Drafts");
      await client.append(mailbox, rawRfc822, ["\\Draft", "\\Seen"]);
      return { mailbox };
    });
  }

  async trashMessage(input: {
    uid: number;
    mailbox?: string;
  }): Promise<{ uid: number; from: string; to: string }> {
    assertAllowed(this.permissions, "allowDelete", "move a message to Trash");
    return this.session.withConnection(async (client) => {
      const from = await resolvePath(client, input.mailbox);
      const to = await resolvePath(client, "Trash");
      return withMailbox(client, from, false, async () => {
        await client.messageMove(input.uid, to, { uid: true });
        return { uid: input.uid, from, to };
      });
    });
  }

  async expungeMessage(input: {
    uid: number;
    mailbox?: string;
  }): Promise<{ uid: number; mailbox: string; expunged: true }> {
    assertAllowed(this.permissions, "allowExpunge", "permanently expunge a message");
    return this.session.withConnection(async (client) => {
      const mailbox = await resolvePath(client, input.mailbox);
      return withMailbox(client, mailbox, false, async () => {
        await client.messageDelete(input.uid, { uid: true });
        return { uid: input.uid, mailbox, expunged: true as const };
      });
    });
  }
}
