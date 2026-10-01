import { ImapSession } from "../src/imap-session.js";
import type {
  FetchedMessage,
  ImapConnection,
  ListedMailbox,
  MailboxLock,
  SearchQuery,
  StatusResult,
} from "../src/types.js";
import { parsePermissions } from "../src/config.js";

export interface MockMessage extends FetchedMessage {
  mailbox: string;
}

export class MockImapConnection implements ImapConnection {
  readonly issued: string[] = [];
  failAuth = false;
  appended: Array<{ path: string; flags?: string[]; source: Buffer | string }> = [];

  constructor(
    readonly boxes: ListedMailbox[],
    readonly messages: MockMessage[],
  ) {}

  async connect(): Promise<void> {
    this.issued.push("CONNECT");
    if (this.failAuth) {
      throw new Error("AUTHENTICATIONFAILED Invalid credentials (secret-pass)");
    }
  }

  async logout(): Promise<void> {
    this.issued.push("LOGOUT");
  }

  async list(): Promise<ListedMailbox[]> {
    this.issued.push('LIST "" "*"');
    return this.boxes;
  }

  async status(path: string): Promise<StatusResult> {
    this.issued.push(`STATUS ${path} (MESSAGES UNSEEN RECENT)`);
    const box = this.boxes.find((item) => item.path === path);
    return {
      messages: box?.status?.messages,
      unseen: box?.status?.unseen,
      recent: box?.status?.recent,
    };
  }

  async getMailboxLock(
    path: string,
    options: { readOnly: boolean },
  ): Promise<MailboxLock> {
    this.issued.push(options.readOnly ? `EXAMINE ${path}` : `SELECT ${path}`);
    return {
      path,
      readOnly: options.readOnly,
      release: () => {
        this.issued.push(`UNSELECT ${path}`);
      },
    };
  }

  async mailboxCreate(path: string): Promise<void> {
    this.issued.push(`CREATE ${path}`);
    this.boxes.push({ path, name: path, delimiter: "/" });
  }

  async search(query: SearchQuery): Promise<number[]> {
    this.issued.push(`UID SEARCH ${JSON.stringify(query)}`);
    return this.messages
      .filter((message) => {
        if (query.from && !formatFrom(message).includes(query.from)) {
          return false;
        }
        if (query.subject && !(message.envelope?.subject ?? "").includes(query.subject)) {
          return false;
        }
        if (query.seen === false && flagsOf(message).includes("\\Seen")) {
          return false;
        }
        if (query.body && !(message.source?.toString("utf8") ?? "").includes(query.body)) {
          return false;
        }
        return true;
      })
      .map((message) => message.uid);
  }

  fetch(range: number[]): AsyncIterable<FetchedMessage> {
    this.issued.push(
      `UID FETCH ${range.join(",")} (UID FLAGS ENVELOPE INTERNALDATE BODY.PEEK[]<0.12288>)`,
    );
    const selected = this.messages.filter((message) => range.includes(message.uid));
    return {
      async *[Symbol.asyncIterator]() {
        for (const message of selected) {
          yield message;
        }
      },
    };
  }

  async fetchOne(range: string | number): Promise<FetchedMessage | false> {
    const uid = Number(range);
    this.issued.push(
      `UID FETCH ${uid} (UID FLAGS ENVELOPE BODY.PEEK[] BODY.PEEK[HEADER] BODYSTRUCTURE)`,
    );
    return this.messages.find((message) => message.uid === uid) ?? false;
  }

  async messageFlagsAdd(uid: number, flags: string[]): Promise<void> {
    this.issued.push(`UID STORE ${uid} +FLAGS (${flags.join(" ")})`);
    const message = this.messages.find((item) => item.uid === uid);
    if (message) {
      const set = new Set(flagsOf(message));
      for (const flag of flags) {
        set.add(flag);
      }
      message.flags = set;
    }
  }

  async messageFlagsRemove(uid: number, flags: string[]): Promise<void> {
    this.issued.push(`UID STORE ${uid} -FLAGS (${flags.join(" ")})`);
    const message = this.messages.find((item) => item.uid === uid);
    if (message) {
      const set = new Set(flagsOf(message));
      for (const flag of flags) {
        set.delete(flag);
      }
      message.flags = set;
    }
  }

  async messageMove(uid: number, destination: string): Promise<void> {
    this.issued.push(`UID MOVE ${uid} ${destination}`);
    const message = this.messages.find((item) => item.uid === uid);
    if (message) {
      message.mailbox = destination;
    }
  }

  async append(path: string, source: Buffer | string, flags?: string[]): Promise<void> {
    this.issued.push(`APPEND ${path}`);
    this.appended.push({ path, source, flags });
  }

  async messageDelete(uid: number): Promise<void> {
    this.issued.push(`UID EXPUNGE ${uid}`);
    const index = this.messages.findIndex((item) => item.uid === uid);
    if (index >= 0) {
      this.messages.splice(index, 1);
    }
  }
}

function flagsOf(message: FetchedMessage): string[] {
  return message.flags ? [...message.flags] : [];
}

function formatFrom(message: FetchedMessage): string {
  return (message.envelope?.from ?? [])
    .map((entry) => `${entry.name ?? ""} ${entry.address ?? ""}`)
    .join(" ");
}

export function sampleDataset(): {
  boxes: ListedMailbox[];
  messages: MockMessage[];
} {
  const tfBuild = Buffer.from(
    [
      "From: App Store Connect <noreply@email.apple.com>",
      "To: you@icloud.com",
      "Message-ID: <tf-208@apple.com>",
      "Subject: Your app has been approved",
      "",
      "Congratulations, build 208 is ready for TestFlight.",
    ].join("\r\n"),
  );
  const playMail = Buffer.from(
    [
      "From: Google Play <googleplay-developer-noreply@google.com>",
      "To: you@icloud.com",
      "Subject: Production rollout",
      "",
      "Your production release is now 10% rolled out.",
    ].join("\r\n"),
  );
  return {
    boxes: [
      {
        path: "INBOX",
        name: "INBOX",
        delimiter: "/",
        specialUse: "\\Inbox",
        status: { messages: 2, unseen: 1, recent: 0 },
      },
      {
        path: "Sent Messages",
        name: "Sent Messages",
        delimiter: "/",
        specialUse: "\\Sent",
        status: { messages: 0, unseen: 0, recent: 0 },
      },
      {
        path: "Deleted Messages",
        name: "Deleted Messages",
        delimiter: "/",
        specialUse: "\\Trash",
      },
      {
        path: "Drafts",
        name: "Drafts",
        delimiter: "/",
        specialUse: "\\Drafts",
      },
    ],
    messages: [
      {
        mailbox: "INBOX",
        uid: 101,
        flags: new Set(["\\Flagged"]),
        envelope: {
          date: new Date("2026-03-02T10:00:00Z"),
          subject: "Your app has been approved",
          from: [{ name: "App Store Connect", address: "noreply@email.apple.com" }],
          to: [{ address: "you@icloud.com" }],
        },
        internalDate: new Date("2026-03-02T10:00:00Z"),
        source: tfBuild,
        headers: Buffer.from(
          "Subject: Your app has been approved\r\nFrom: App Store Connect <noreply@email.apple.com>\r\nMessage-ID: <tf-208@apple.com>\r\n",
        ),
      },
      {
        mailbox: "INBOX",
        uid: 99,
        flags: new Set(["\\Seen"]),
        envelope: {
          date: new Date("2026-03-01T08:00:00Z"),
          subject: "Production rollout",
          from: [{ name: "Google Play", address: "googleplay-developer-noreply@google.com" }],
          to: [{ address: "you@icloud.com" }],
        },
        internalDate: new Date("2026-03-01T08:00:00Z"),
        source: playMail,
      },
    ],
  };
}

export function sessionForMock(
  mock: MockImapConnection,
  commandPolicy: "read-only" | "read-write" = "read-write",
): ImapSession {
  return new ImapSession(
    {
      email: "you@icloud.com",
      appPassword: "secret-pass",
      host: "127.0.0.1",
      port: 1143,
      secure: false,
    },
    () => mock,
    commandPolicy,
  );
}

export const allowAllWrites = parsePermissions({
  ICLOUD_ALLOW_DELETE: "true",
  ICLOUD_ALLOW_EXPUNGE: "true",
});
