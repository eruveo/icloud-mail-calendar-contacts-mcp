import { describe, expect, it } from "vitest";
import { ImapFlow } from "imapflow";
import { installImapCommandGuard } from "../src/imapflow-connection.js";
import { ReadOnlyImapError } from "../src/readonly-guard.js";

describe("ImapFlow write guard", () => {
  it("throws before a mutating command is written in read-only policy", () => {
    const client = new ImapFlow({
      host: "127.0.0.1",
      port: 1,
      auth: { user: "n", pass: "p" },
      logger: false,
    });
    const writes: string[] = [];
    const untyped = client as unknown as { write: (chunk: string) => boolean };
    untyped.write = (chunk: string) => {
      writes.push(chunk);
      return true;
    };
    installImapCommandGuard(client, "read-only");
    expect(() => untyped.write("A1 STORE 1:1 +FLAGS (\\Seen)\r\n")).toThrow(ReadOnlyImapError);
    expect(writes).toHaveLength(0);
    expect(() => untyped.write("A2 EXAMINE INBOX\r\n")).not.toThrow();
    expect(writes).toEqual(["A2 EXAMINE INBOX\r\n"]);
  });

  it("allows STORE when policy is read-write", () => {
    const client = new ImapFlow({
      host: "127.0.0.1",
      port: 1,
      auth: { user: "n", pass: "p" },
      logger: false,
    });
    const writes: string[] = [];
    const untyped = client as unknown as { write: (chunk: string) => boolean };
    untyped.write = (chunk: string) => {
      writes.push(chunk);
      return true;
    };
    installImapCommandGuard(client, "read-write");
    expect(() => untyped.write("A1 UID STORE 1 +FLAGS (\\Seen)\r\n")).not.toThrow();
    expect(writes).toHaveLength(1);
  });
});
