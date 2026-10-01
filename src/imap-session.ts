import {
  CONNECTION_TIMEOUT_MS,
  OPERATION_TIMEOUT_MS,
  type MailAccount,
} from "./config.js";
import { formatImapError, redactError } from "./redact.js";
import { createImapFlowConnection } from "./imapflow-connection.js";
import type { ImapConnection, ImapConnectionFactory } from "./types.js";

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class ImapSession {
  private connection: ImapConnection | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly commands: string[] = [];

  constructor(
    private readonly account: MailAccount,
    private readonly factory: ImapConnectionFactory = createImapFlowConnection,
    private readonly commandPolicy: "read-only" | "read-write" = "read-write",
  ) {}

  get recordedCommands(): readonly string[] {
    return this.commands;
  }

  async withConnection<T>(fn: (client: ImapConnection) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const secrets = [this.account.appPassword];
      try {
        const client = await this.ensureConnected();
        return await withTimeout(fn(client), OPERATION_TIMEOUT_MS, "IMAP operation");
      } catch (error) {
        await this.reset();
        throw formatImapError(error, secrets);
      }
    };

    const next = this.queue.then(run, run);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async close(): Promise<void> {
    await this.reset();
  }

  private async ensureConnected(): Promise<ImapConnection> {
    if (this.connection) {
      return this.connection;
    }
    const client = this.factory({
      host: this.account.host,
      port: this.account.port,
      secure: this.account.secure,
      user: this.account.email,
      pass: this.account.appPassword,
      commandPolicy: this.commandPolicy,
      onClientCommand: (line) => {
        this.commands.push(line);
      },
    });
    await withTimeout(client.connect(), CONNECTION_TIMEOUT_MS, "IMAP connect");
    this.connection = client;
    return client;
  }

  private async reset(): Promise<void> {
    const existing = this.connection;
    this.connection = null;
    if (!existing) {
      return;
    }
    try {
      await withTimeout(existing.logout(), 5_000, "IMAP logout");
    } catch {
      // Already dropped; next call reconnects.
    }
  }
}

export async function withMailbox<T>(
  client: ImapConnection,
  path: string,
  readOnly: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await client.getMailboxLock(path, { readOnly });
  if (readOnly && !lock.readOnly) {
    lock.release();
    throw new Error("Refusing to use a read-write mailbox lock for a read operation.");
  }
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

export { redactError };
