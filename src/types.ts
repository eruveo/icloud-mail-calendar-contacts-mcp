export interface MailboxListEntry {
  path: string;
  name: string;
  delimiter: string;
  specialUse?: string;
  messages: number | null;
  unseen: number | null;
  recent: number | null;
}

export interface MessageSummary {
  uid: number;
  mailbox: string;
  date: string | null;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  flags: string[];
}

export interface MessageAttachment {
  filename: string;
  size: number;
  contentType: string;
}

export interface MessageDetail {
  uid: number;
  mailbox: string;
  date: string | null;
  from: string;
  to: string;
  cc: string;
  subject: string;
  flags: string[];
  headers: Record<string, string>;
  messageId: string | null;
  body: string;
  truncated: boolean;
  attachments: MessageAttachment[];
}

export interface SearchMessagesInput {
  mailbox?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  since?: string;
  before?: string;
  unread?: boolean;
  limit?: number;
}

export interface GetMessageInput {
  uid: number;
  mailbox?: string;
  maxBodyChars?: number;
}

export interface ListRecentInput {
  mailbox?: string;
  limit?: number;
  since?: string;
}

export interface EnvelopeAddress {
  name?: string;
  address?: string;
}

export interface ImapEnvelope {
  date?: Date | string | null;
  subject?: string | null;
  from?: EnvelopeAddress[];
  to?: EnvelopeAddress[];
  cc?: EnvelopeAddress[];
}

export interface FetchedMessage {
  uid: number;
  flags?: Set<string> | string[];
  envelope?: ImapEnvelope;
  internalDate?: Date | string | null;
  source?: Buffer;
  headers?: Buffer | Record<string, string | string[]>;
  bodyParts?: Map<string, Buffer>;
}

export interface ListedMailbox {
  path: string;
  name?: string;
  delimiter?: string;
  specialUse?: string | null;
  status?: {
    messages?: number;
    unseen?: number;
    recent?: number;
  };
}

export interface MailboxLock {
  path: string;
  readOnly: boolean;
  release(): void;
}

export interface StatusResult {
  messages?: number;
  unseen?: number;
  recent?: number;
}

export interface SearchQuery {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  seen?: boolean;
  since?: Date;
  before?: Date;
}

export interface ImapConnection {
  connect(): Promise<void>;
  logout(): Promise<void>;
  list(options?: {
    statusQuery?: { messages?: boolean; unseen?: boolean; recent?: boolean };
  }): Promise<ListedMailbox[]>;
  status(
    path: string,
    query: { messages: boolean; unseen: boolean; recent: boolean },
  ): Promise<StatusResult>;
  getMailboxLock(
    path: string,
    options: { readOnly: boolean },
  ): Promise<MailboxLock>;
  mailboxCreate(path: string): Promise<void>;
  search(query: SearchQuery, options: { uid: true }): Promise<number[] | false>;
  fetch(
    range: number[],
    query: Record<string, unknown>,
    options: { uid: true },
  ): AsyncIterable<FetchedMessage>;
  fetchOne(
    range: string | number,
    query: Record<string, unknown>,
    options: { uid: true },
  ): Promise<FetchedMessage | false>;
  messageFlagsAdd(
    uid: number,
    flags: string[],
    options: { uid: true },
  ): Promise<void>;
  messageFlagsRemove(
    uid: number,
    flags: string[],
    options: { uid: true },
  ): Promise<void>;
  messageMove(
    uid: number,
    destination: string,
    options: { uid: true },
  ): Promise<void>;
  append(
    path: string,
    source: Buffer | string,
    flags?: string[],
  ): Promise<void>;
  messageDelete(uid: number, options: { uid: true }): Promise<void>;
}

export interface ImapConnectionFactory {
  (options: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    commandPolicy: "read-only" | "read-write";
    onClientCommand?: (line: string) => void;
  }): ImapConnection;
}
