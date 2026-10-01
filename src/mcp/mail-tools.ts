import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IcloudConfig } from "../config.js";
import type { IcloudMailService } from "../mail-service.js";
import type { SmtpMailer } from "../smtp.js";
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  errorResult,
  jsonResult,
} from "./common.js";

const mailboxArg = z
  .string()
  .min(1)
  .optional()
  .describe("Mailbox path. Defaults to INBOX. Aliases: Sent, Trash, Junk, Drafts.");

export function registerMailTools(
  server: McpServer,
  mail: IcloudMailService,
  smtp: SmtpMailer,
  config: IcloudConfig,
): void {
  server.registerTool(
    "list_mailboxes",
    {
      title: "List iCloud mailboxes",
      description:
        "List folders in iCloud Mail (INBOX, Sent Messages, Deleted Messages, Drafts, …) with message counts.",
      inputSchema: z.object({}),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        return jsonResult({ mailboxes: await mail.listMailboxes() });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_messages",
    {
      title: "Search iCloud messages",
      description:
        "Search a mailbox (default INBOX) by from, to, subject, body, dates, and unread. Newest first. Reads use EXAMINE + BODY.PEEK so they do not mark messages seen.",
      inputSchema: z.object({
        mailbox: mailboxArg,
        from: z.string().optional(),
        to: z.string().optional(),
        subject: z.string().optional(),
        body: z.string().optional(),
        since: z.string().optional(),
        before: z.string().optional(),
        unread: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        const messages = await mail.searchMessages(args);
        return jsonResult({ count: messages.length, messages });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_recent_messages",
    {
      title: "List recent iCloud messages",
      description: "Newest messages in a mailbox, optionally since a date.",
      inputSchema: z.object({
        mailbox: mailboxArg,
        limit: z.number().int().min(1).max(100).optional(),
        since: z.string().optional(),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        const messages = await mail.listRecentMessages(args);
        return jsonResult({ count: messages.length, messages });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_message",
    {
      title: "Get one iCloud message",
      description:
        "Fetch one message by IMAP UID. Returns headers (including Message-ID for replies), plain-text body, and attachment names/sizes without downloading files. Does not mark the message as seen.",
      inputSchema: z.object({
        uid: z.number().int().positive(),
        mailbox: mailboxArg,
        maxBodyChars: z.number().int().min(1).max(80_000).optional(),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        return jsonResult(await mail.getMessage(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  if (config.permissions.allowSend) {
    server.registerTool(
      "send_email",
      {
        title: "Send iCloud email",
        description:
          "[WRITE] Send an email via iCloud SMTP (smtp.mail.me.com:587 STARTTLS). Supports to/cc/bcc, plain text, optional HTML, In-Reply-To/References threading, and attachments from local file paths. Requires allow-send (default true unless read-only).",
        inputSchema: z.object({
          to: z.union([z.string(), z.array(z.string())]).describe("To recipients."),
          cc: z.union([z.string(), z.array(z.string())]).optional(),
          bcc: z.union([z.string(), z.array(z.string())]).optional(),
          subject: z.string(),
          text: z.string().describe("Plain-text body."),
          html: z.string().optional(),
          replyToMessageId: z
            .string()
            .optional()
            .describe("Original Message-ID for In-Reply-To (from get_message)."),
          references: z.string().optional(),
          attachmentPaths: z.array(z.string()).optional(),
        }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await smtp.send(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }

  if (config.permissions.allowMailWrite) {
    server.registerTool(
      "mark_message",
      {
        title: "Mark message read/unread or flagged",
        description: "[WRITE] Set or clear \\Seen and/or \\Flagged. Requires allow-mail-write.",
        inputSchema: z.object({
          uid: z.number().int().positive(),
          mailbox: mailboxArg,
          seen: z.boolean().optional(),
          flagged: z.boolean().optional(),
        }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await mail.markMessage(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
    server.registerTool(
      "move_message",
      {
        title: "Move a message between folders",
        description: "[WRITE] IMAP MOVE. Requires allow-mail-write.",
        inputSchema: z.object({
          uid: z.number().int().positive(),
          from: mailboxArg,
          to: z.string().min(1),
        }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await mail.moveMessage(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
    server.registerTool(
      "create_mailbox",
      {
        title: "Create an iCloud mailbox",
        description: "[WRITE] Create a new IMAP folder. Requires allow-mail-write.",
        inputSchema: z.object({ name: z.string().min(1) }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await mail.createMailbox(args.name));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
    server.registerTool(
      "save_draft",
      {
        title: "Save a draft to iCloud Drafts",
        description: "[WRITE] APPEND to Drafts with \\Draft. Requires allow-mail-write.",
        inputSchema: z.object({
          to: z.union([z.string(), z.array(z.string())]).optional(),
          cc: z.union([z.string(), z.array(z.string())]).optional(),
          bcc: z.union([z.string(), z.array(z.string())]).optional(),
          subject: z.string(),
          text: z.string(),
          html: z.string().optional(),
        }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          const raw = await smtp.composeDraft({
            to: args.to ?? config.email,
            cc: args.cc,
            bcc: args.bcc,
            subject: args.subject,
            text: args.text,
            html: args.html,
          });
          return jsonResult(await mail.saveDraft(raw));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }

  if (config.permissions.allowDelete) {
    server.registerTool(
      "trash_message",
      {
        title: "Move a message to Trash",
        description:
          "[WRITE] Moves the message to Deleted Messages. Requires allow-delete (default false).",
        inputSchema: z.object({
          uid: z.number().int().positive(),
          mailbox: mailboxArg,
        }),
        annotations: DESTRUCTIVE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await mail.trashMessage(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }

  if (config.permissions.allowExpunge) {
    server.registerTool(
      "expunge_message",
      {
        title: "Permanently expunge a message",
        description: "[WRITE] Irreversible IMAP expunge. Requires allow-expunge (default false).",
        inputSchema: z.object({
          uid: z.number().int().positive(),
          mailbox: mailboxArg,
        }),
        annotations: DESTRUCTIVE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await mail.expungeMessage(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }
}
