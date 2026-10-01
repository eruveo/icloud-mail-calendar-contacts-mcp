import { ImapFlow } from "imapflow";
import { assertImapCommand, type ImapCommandPolicy } from "./readonly-guard.js";
import type { ImapConnection } from "./types.js";

interface WritableTarget {
  write?: (chunk: Buffer | Uint8Array | string, ...rest: unknown[]) => unknown;
}

function wrapWrite(
  target: WritableTarget,
  onCommand: (line: string) => void,
  policy: ImapCommandPolicy,
): void {
  const original = target.write;
  if (typeof original !== "function") {
    return;
  }
  target.write = (chunk: Buffer | Uint8Array | string, ...rest: unknown[]) => {
    const text =
      typeof chunk === "string"
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : Buffer.from(chunk).toString("utf8");
    for (const line of text.split(/\r?\n/u)) {
      if (line.length === 0) {
        continue;
      }
      onCommand(line);
      assertImapCommand(line, policy);
    }
    return original.call(target, chunk, ...rest);
  };
}

export function installImapCommandGuard(
  client: ImapFlow,
  policy: ImapCommandPolicy,
  onCommand?: (line: string) => void,
): () => void {
  const notify = onCommand ?? (() => undefined);
  const untyped = client as unknown as {
    write?: WritableTarget["write"];
    streamer?: WritableTarget;
    socket?: WritableTarget;
    _socket?: WritableTarget;
  };

  wrapWrite(untyped, notify, policy);
  if (untyped.streamer) {
    wrapWrite(untyped.streamer, notify, policy);
  }

  const tryWrapSocket = () => {
    if (untyped.socket) {
      wrapWrite(untyped.socket, notify, policy);
    }
    if (untyped._socket) {
      wrapWrite(untyped._socket, notify, policy);
    }
  };
  tryWrapSocket();
  return tryWrapSocket;
}

export function createImapFlowConnection(options: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  commandPolicy: ImapCommandPolicy;
  onClientCommand?: (line: string) => void;
}): ImapConnection {
  const client = new ImapFlow({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: {
      user: options.user,
      pass: options.pass,
    },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: {
      minVersion: "TLSv1.2",
    },
  });

  const wrapSocket = installImapCommandGuard(
    client,
    options.commandPolicy,
    options.onClientCommand,
  );

  return {
    connect: async () => {
      await client.connect();
      wrapSocket();
    },
    logout: async () => {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    },
    list: (listOptions) => client.list(listOptions),
    status: (path, query) => client.status(path, query),
    getMailboxLock: async (path, lockOptions) => {
      const lock = await client.getMailboxLock(path, {
        readOnly: lockOptions.readOnly,
      });
      return {
        path: lock.path,
        readOnly: lockOptions.readOnly,
        release: () => lock.release(),
      };
    },
    mailboxCreate: async (path) => {
      await client.mailboxCreate(path);
    },
    search: (query, searchOptions) => client.search(query, searchOptions),
    fetch: (range, query, fetchOptions) =>
      client.fetch(range, query, fetchOptions),
    fetchOne: (range, query, fetchOptions) =>
      client.fetchOne(String(range), query, fetchOptions),
    messageFlagsAdd: async (uid, flags, flagOptions) => {
      await client.messageFlagsAdd(String(uid), flags, flagOptions);
    },
    messageFlagsRemove: async (uid, flags, flagOptions) => {
      await client.messageFlagsRemove(String(uid), flags, flagOptions);
    },
    messageMove: async (uid, destination, moveOptions) => {
      await client.messageMove(String(uid), destination, moveOptions);
    },
    append: async (path, source, flags) => {
      await client.append(path, source, flags);
    },
    messageDelete: async (uid, deleteOptions) => {
      await client.messageDelete(String(uid), deleteOptions);
    },
  };
}
