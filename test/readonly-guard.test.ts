import { describe, expect, it } from "vitest";
import {
  assertImapCommand,
  MUTATING_IMAP_VERBS,
  parseImapClientCommand,
  ReadOnlyImapError,
} from "../src/readonly-guard.js";

describe("IMAP command policy", () => {
  it("allows login, examine, peek fetch in read-only mode", () => {
    const allowed = [
      "A1 LOGIN user@icloud.com secret-password",
      "A7 EXAMINE INBOX",
      "A9 UID FETCH 12:20 (UID FLAGS ENVELOPE INTERNALDATE BODY.PEEK[]<0.12288>)",
      "A12 LOGOUT",
    ];
    for (const line of allowed) {
      expect(() => assertImapCommand(line, "read-only")).not.toThrow();
    }
  });

  it("blocks mutating verbs in read-only mode", () => {
    for (const verb of MUTATING_IMAP_VERBS) {
      expect(() => assertImapCommand(`A1 ${verb} INBOX`, "read-only")).toThrow(
        ReadOnlyImapError,
      );
    }
  });

  it("allows SELECT/STORE/APPEND/MOVE in read-write mode but still blocks CLOSE", () => {
    expect(() => assertImapCommand("A1 SELECT INBOX", "read-write")).not.toThrow();
    expect(() => assertImapCommand("A1 UID STORE 1 +FLAGS (\\Seen)", "read-write")).not.toThrow();
    expect(() => assertImapCommand("A1 APPEND Drafts {12}", "read-write")).not.toThrow();
    expect(() => assertImapCommand("A1 CLOSE", "read-write")).toThrow(/CLOSE/);
  });

  it("parses UID vs untagged verbs", () => {
    expect(parseImapClientCommand("A12 UID FETCH 1 BODY.PEEK[]")).toEqual({
      uid: true,
      verb: "FETCH",
    });
  });
});
