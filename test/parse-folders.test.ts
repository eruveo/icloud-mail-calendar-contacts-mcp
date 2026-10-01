import { describe, expect, it } from "vitest";
import { resolveMailboxPath } from "../src/folders.js";
import {
  htmlToReadableText,
  parseRfc822,
  snippetFromText,
  truncateBody,
} from "../src/parse-mail.js";

describe("iCloud folder aliases", () => {
  const folders = [
    "INBOX",
    "Sent Messages",
    "Deleted Messages",
    "Junk",
    "Drafts",
    "Archive",
  ];

  it("maps common names onto iCloud folder titles", () => {
    expect(resolveMailboxPath(undefined, folders)).toBe("INBOX");
    expect(resolveMailboxPath("sent", folders)).toBe("Sent Messages");
    expect(resolveMailboxPath("Trash", folders)).toBe("Deleted Messages");
    expect(resolveMailboxPath("spam", folders)).toBe("Junk");
    expect(resolveMailboxPath("INBOX", folders)).toBe("INBOX");
  });
});

describe("message parsing", () => {
  it("converts HTML to readable text", () => {
    const text = htmlToReadableText(
      "<html><body><p>Build 42 failed.</p><a href='https://example.com'>Open</a></body></html>",
    );
    expect(text).toContain("Build 42 failed.");
    expect(text).toContain("Open");
  });

  it("truncates long bodies with a note", () => {
    const { text, truncated } = truncateBody("abcdefghij", 4);
    expect(truncated).toBe(true);
    expect(text).toContain("truncated");
    expect(snippetFromText("  hello   \n world  ", 20)).toBe("hello world");
  });

  it("parses a multipart message and lists attachments without requiring download APIs", async () => {
    const rfc822 = [
      "From: App Store Connect <noreply@email.apple.com>",
      "To: you@icloud.com",
      "Subject: New TestFlight build",
      "MIME-Version: 1.0",
      "Content-Type: multipart/mixed; boundary=BOUND",
      "",
      "--BOUND",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Build <b>208</b> is ready.</p>",
      "--BOUND",
      "Content-Type: application/pdf; name=notes.pdf",
      "Content-Disposition: attachment; filename=notes.pdf",
      "Content-Transfer-Encoding: base64",
      "",
      "cGRm",
      "--BOUND--",
      "",
    ].join("\r\n");
    const parsed = await parseRfc822(rfc822);
    expect(parsed.text).toContain("Build 208 is ready.");
    expect(parsed.attachments[0]?.filename).toBe("notes.pdf");
    expect(parsed.attachments[0]?.contentType).toContain("pdf");
  });
});
