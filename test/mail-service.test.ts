import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { IcloudMailService } from "../src/mail-service.js";
import { assertReadOnlyImapCommand } from "../src/readonly-guard.js";
import { createApp } from "../src/server.js";
import { SmtpMailer } from "../src/smtp.js";
import {
  allowAllWrites,
  MockImapConnection,
  sampleDataset,
  sessionForMock,
} from "./mock-imap.js";
import { parsePermissions } from "../src/config.js";

describe("IcloudMailService with mocked IMAP", () => {
  it("lists mailboxes and searches without mutating", async () => {
    const { boxes, messages } = sampleDataset();
    const mock = new MockImapConnection(boxes, messages);
    const service = new IcloudMailService(
      sessionForMock(mock, "read-only"),
      parsePermissions({ ICLOUD_READ_ONLY: "true" }),
    );
    const listed = await service.listMailboxes();
    expect(listed.map((box) => box.path)).toContain("Sent Messages");
    const unread = await service.searchMessages({ unread: true });
    expect(unread).toHaveLength(1);
    expect(unread[0]?.uid).toBe(101);
    expect(unread[0]?.snippet).toMatch(/TestFlight/i);
    for (const line of mock.issued) {
      expect(() => assertReadOnlyImapCommand(`A1 ${line}`)).not.toThrow();
    }
    expect(mock.issued.join("\n")).toMatch(/BODY\.PEEK/);
    expect(mock.issued.join("\n")).not.toMatch(/\bSELECT\b/);
  });

  it("returns Message-ID for threading", async () => {
    const { boxes, messages } = sampleDataset();
    const mock = new MockImapConnection(boxes, messages);
    const service = new IcloudMailService(sessionForMock(mock), allowAllWrites);
    const detail = await service.getMessage({ uid: 101 });
    expect(detail.messageId).toBe("<tf-208@apple.com>");
  });

  it("marks, moves, drafts, trash and expunge through IMAP writes", async () => {
    const { boxes, messages } = sampleDataset();
    const mock = new MockImapConnection(boxes, messages);
    const service = new IcloudMailService(sessionForMock(mock), allowAllWrites);
    await service.markMessage({ uid: 101, seen: true, flagged: false });
    await service.createMailbox("Projects");
    await service.moveMessage({ uid: 99, to: "Projects" });
    await service.saveDraft("From: a\r\nSubject: draft\r\n\r\nHi");
    await service.trashMessage({ uid: 101 });
    await service.expungeMessage({ uid: 99, mailbox: "Projects" });
    expect(mock.issued.some((line) => line.startsWith("SELECT"))).toBe(true);
    expect(mock.issued.join("\n")).toMatch(/UID STORE/);
    expect(mock.issued.join("\n")).toMatch(/CREATE Projects/);
    expect(mock.issued.join("\n")).toMatch(/UID MOVE 101 Deleted Messages/);
    expect(mock.issued.join("\n")).toMatch(/UID EXPUNGE 99/);
    expect(mock.appended[0]?.path).toBe("Drafts");
  });

  it("blocks writes when read-only", async () => {
    const { boxes, messages } = sampleDataset();
    const mock = new MockImapConnection(boxes, messages);
    const service = new IcloudMailService(
      sessionForMock(mock, "read-only"),
      parsePermissions({ ICLOUD_READ_ONLY: "true" }),
    );
    await expect(service.markMessage({ uid: 101, seen: true })).rejects.toThrow(
      /ICLOUD_READ_ONLY/,
    );
    await expect(service.trashMessage({ uid: 101 })).rejects.toThrow(/ICLOUD_READ_ONLY/);
  });

  it("redacts the app password from auth failures", async () => {
    const { boxes, messages } = sampleDataset();
    const mock = new MockImapConnection(boxes, messages);
    mock.failAuth = true;
    const service = new IcloudMailService(sessionForMock(mock), allowAllWrites);
    await expect(service.listMailboxes()).rejects.toThrow(/app-specific password/);
    await expect(service.listMailboxes()).rejects.not.toThrow(/secret-pass/);
  });
});

describe("SMTP send (mocked transporter)", () => {
  it("sends with In-Reply-To and refuses when send is disabled", async () => {
    const sent: unknown[] = [];
    const env = {
      ICLOUD_EMAIL: "you@icloud.com",
      ICLOUD_APP_PASSWORD: "secret-pass",
      ICLOUD_SERVICES: "mail",
    };
    const { config } = createApp({ env, imapFactory: () => new MockImapConnection([], []) });
    const mailer = new SmtpMailer(config, {
      send: async (mail) => {
        sent.push(mail);
        return { messageId: "<out@icloud.com>" };
      },
    });
    const result = await mailer.send({
      to: "reviewer@example.com",
      subject: "Re: build",
      text: "Thanks",
      replyToMessageId: "<tf-208@apple.com>",
      references: "<tf-208@apple.com>",
    });
    expect(result.messageId).toBe("<out@icloud.com>");
    expect(sent[0]).toMatchObject({
      inReplyTo: "<tf-208@apple.com>",
      subject: "Re: build",
    });

    const locked = new SmtpMailer(
      createApp({
        env: { ...env, ICLOUD_READ_ONLY: "true" },
        imapFactory: () => new MockImapConnection([], []),
      }).config,
      { send: async () => ({ messageId: "x" }) },
    );
    await expect(
      locked.send({ to: "a@b.c", subject: "nope", text: "x" }),
    ).rejects.toThrow(/ICLOUD_READ_ONLY/);
  });
});

describe("MCP tool surface", () => {
  it("hides write tools when ICLOUD_READ_ONLY=true", async () => {
    const { boxes, messages } = sampleDataset();
    const mock = new MockImapConnection(boxes, messages);
    const { server } = createApp({
      env: {
        ICLOUD_EMAIL: "you@icloud.com",
        ICLOUD_APP_PASSWORD: "secret-pass",
        ICLOUD_SERVICES: "mail",
        ICLOUD_READ_ONLY: "true",
      },
      imapFactory: () => mock,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_mailboxes",
        "search_messages",
        "get_message",
        "list_recent_messages",
      ]),
    );
    expect(names).not.toContain("send_email");
    expect(names).not.toContain("trash_message");
    expect(names).not.toContain("expunge_message");
    await client.close();
  });

  it("advertises send/write tools by default and delete only when opted in", async () => {
    const { boxes, messages } = sampleDataset();
    const { server } = createApp({
      env: {
        ICLOUD_EMAIL: "you@icloud.com",
        ICLOUD_APP_PASSWORD: "secret-pass",
        ICLOUD_SERVICES: "mail",
        ICLOUD_ALLOW_DELETE: "true",
        ICLOUD_ALLOW_EXPUNGE: "true",
      },
      imapFactory: () => new MockImapConnection(boxes, messages),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "send_email",
        "mark_message",
        "move_message",
        "save_draft",
        "trash_message",
        "expunge_message",
      ]),
    );
    const send = tools.find((tool) => tool.name === "send_email");
    expect(send?.description).toMatch(/\[WRITE\]/);
    expect(send?.annotations?.readOnlyHint).toBe(false);
    await client.close();
  });
});
