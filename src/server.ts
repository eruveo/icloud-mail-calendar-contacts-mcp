import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CalendarService } from "./calendar/service.js";
import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  loadConfig,
  mailAccountFromConfig,
  serviceEnabled,
  type IcloudConfig,
} from "./config.js";
import { ContactsService } from "./contacts/service.js";
import { DavClient } from "./dav/client.js";
import { createDavFetch } from "./dav/http.js";
import { ImapSession } from "./imap-session.js";
import { IcloudMailService } from "./mail-service.js";
import { SmtpMailer, type MailSender } from "./smtp.js";
import type { DavFetch } from "./dav/http.js";
import type { ImapConnectionFactory } from "./types.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

const mailboxArg = z
  .string()
  .min(1)
  .optional()
  .describe("Mailbox path. Defaults to INBOX. Aliases: Sent, Trash, Junk, Drafts.");

export interface AppDependencies {
  env?: NodeJS.ProcessEnv;
  imapFactory?: ImapConnectionFactory;
  davFetch?: DavFetch;
  cardDavFetch?: DavFetch;
  mailSender?: MailSender;
}

export interface IcloudApp {
  server: McpServer;
  config: IcloudConfig;
  mail?: IcloudMailService;
  smtp?: SmtpMailer;
  calendar?: CalendarService;
  contacts?: ContactsService;
  session?: ImapSession;
}

export function createApp(deps: AppDependencies = {}): IcloudApp {
  const config = loadConfig(deps.env ?? process.env);
  const server = new McpServer({ name: PACKAGE_NAME, version: PACKAGE_VERSION });
  const app: IcloudApp = { server, config };

  if (serviceEnabled(config, "mail")) {
    const policy =
      config.permissions.readOnly ||
      (!config.permissions.allowMailWrite &&
        !config.permissions.allowDelete &&
        !config.permissions.allowExpunge)
        ? "read-only"
        : "read-write";
    const session = new ImapSession(
      mailAccountFromConfig(config),
      deps.imapFactory,
      policy,
    );
    const mail = new IcloudMailService(session, config.permissions);
    const smtp = new SmtpMailer(config, deps.mailSender);
    app.session = session;
    app.mail = mail;
    app.smtp = smtp;
    registerMailTools(server, mail, smtp, config);
  }

  if (serviceEnabled(config, "calendar")) {
    const dav = new DavClient(
      deps.davFetch ??
        createDavFetch({
          username: config.email,
          password: config.appPassword,
          timeoutMs: 30_000,
          userAgent: `${PACKAGE_NAME}/${PACKAGE_VERSION}`,
        }),
      config.caldavUrl,
    );
    const calendar = new CalendarService(config, dav);
    app.calendar = calendar;
    registerCalendarTools(server, calendar, config);
  }

  if (serviceEnabled(config, "contacts")) {
    const dav = new DavClient(
      deps.cardDavFetch ??
        deps.davFetch ??
        createDavFetch({
          username: config.email,
          password: config.appPassword,
          timeoutMs: 30_000,
          userAgent: `${PACKAGE_NAME}/${PACKAGE_VERSION}`,
        }),
      config.carddavUrl,
    );
    const contacts = new ContactsService(config, dav);
    app.contacts = contacts;
    registerContactTools(server, contacts, config);
  }

  return app;
}

function registerMailTools(
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
          "[WRITE] Send an email via iCloud SMTP (smtp.mail.me.com:587 STARTTLS). Supports to/cc/bcc, plain text, optional HTML, In-Reply-To/References threading, and attachments from local file paths. Requires ICLOUD_ALLOW_SEND (default true unless ICLOUD_READ_ONLY).",
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
          references: z
            .string()
            .optional()
            .describe("References header; typically prior References plus the original Message-ID."),
          attachmentPaths: z
            .array(z.string())
            .optional()
            .describe("Absolute local file paths. Restricted to ICLOUD_ATTACHMENT_ROOT when that env is set."),
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
        description:
          "[WRITE] Set or clear \\Seen and/or \\Flagged on a message. Requires ICLOUD_ALLOW_MAIL_WRITE.",
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
        description: "[WRITE] Move a message to another mailbox (IMAP MOVE). Requires ICLOUD_ALLOW_MAIL_WRITE.",
        inputSchema: z.object({
          uid: z.number().int().positive(),
          from: mailboxArg,
          to: z.string().min(1).describe("Destination mailbox (name or path)."),
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
        description: "[WRITE] Create a new IMAP folder. Requires ICLOUD_ALLOW_MAIL_WRITE.",
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
        description:
          "[WRITE] APPEND a draft RFC822 to the Drafts folder with the \\Draft flag. Requires ICLOUD_ALLOW_MAIL_WRITE.",
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
          "[WRITE] Delete means moving the message to iCloud's Deleted Messages folder, not expunging it. Requires ICLOUD_ALLOW_DELETE (default false).",
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
        description:
          "[WRITE] Permanently delete a message (IMAP UID EXPUNGE). Irreversible. Requires ICLOUD_ALLOW_EXPUNGE (default false). Prefer trash_message.",
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

function registerCalendarTools(
  server: McpServer,
  calendar: CalendarService,
  config: IcloudConfig,
): void {
  const calendarArg = z
    .string()
    .optional()
    .describe("Calendar display name or href. Defaults to the primary VEVENT calendar.");

  server.registerTool(
    "list_calendars",
    {
      title: "List iCloud calendars",
      description: "List CalDAV calendars that hold VEVENT objects (not Reminders/VTODO).",
      inputSchema: z.object({}),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        return jsonResult({ calendars: await calendar.listCalendars() });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_events",
    {
      title: "List calendar events",
      description:
        "List events in a date range. Recurring events are expanded. Times are converted into ICLOUD_TIMEZONE unless you pass timezone.",
      inputSchema: z.object({
        calendar: calendarArg,
        start: z.string().describe("Range start (ISO-8601)."),
        end: z.string().describe("Range end (ISO-8601)."),
        timezone: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        const events = await calendar.listEvents(args);
        return jsonResult({ count: events.length, events });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_event",
    {
      title: "Get a calendar event",
      description: "Fetch one event by href (preferred) or uid.",
      inputSchema: z.object({
        href: z.string().optional(),
        uid: z.string().optional(),
        calendar: calendarArg,
        timezone: z.string().optional(),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        return jsonResult(await calendar.getEvent(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_invitations",
    {
      title: "List calendar invitations",
      description:
        "List scheduling REQUEST objects / NEEDS-ACTION attendees from the CalDAV schedule inbox when iCloud exposes it.",
      inputSchema: z.object({ timezone: z.string().optional() }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        return jsonResult({ invitations: await calendar.listInvitations(args.timezone) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  if (config.permissions.allowCalendarWrite) {
    server.registerTool(
      "create_calendar",
      {
        title: "Create an iCloud calendar",
        description: "[WRITE] MKCALENDAR a new VEVENT calendar. Requires ICLOUD_ALLOW_CALENDAR_WRITE.",
        inputSchema: z.object({ name: z.string().min(1) }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await calendar.createCalendar(args.name));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
    server.registerTool(
      "create_event",
      {
        title: "Create a calendar event",
        description:
          "[WRITE] Create a VEVENT via CalDAV PUT. Optional attendees (mailto) are written as ATTENDEE with RSVP=TRUE; iCloud CalDAV scheduling sends the invites. Requires ICLOUD_ALLOW_CALENDAR_WRITE.",
        inputSchema: z.object({
          calendar: calendarArg,
          title: z.string().min(1),
          start: z.string(),
          end: z.string().optional(),
          allDay: z.boolean().optional(),
          timezone: z.string().optional(),
          location: z.string().optional(),
          notes: z.string().optional(),
          alarmMinutesBefore: z.number().int().min(0).optional(),
          attendees: z
            .array(
              z.object({
                email: z.string(),
                name: z.string().optional(),
              }),
            )
            .optional(),
        }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await calendar.createEvent(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
    server.registerTool(
      "update_event",
      {
        title: "Update a calendar event",
        description: "[WRITE] PATCH fields on an existing VEVENT (CalDAV PUT). Requires ICLOUD_ALLOW_CALENDAR_WRITE.",
        inputSchema: z.object({
          href: z.string(),
          etag: z.string().optional(),
          title: z.string().optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          allDay: z.boolean().optional(),
          timezone: z.string().optional(),
          location: z.string().optional(),
          notes: z.string().optional(),
          attendees: z
            .array(z.object({ email: z.string(), name: z.string().optional() }))
            .optional(),
        }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await calendar.updateEvent(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
    server.registerTool(
      "respond_to_invitation",
      {
        title: "RSVP to a calendar invitation",
        description:
          "[WRITE] Set your ATTENDEE PARTSTAT to ACCEPTED, DECLINED, or TENTATIVE on the invitation resource. Requires ICLOUD_ALLOW_CALENDAR_WRITE.",
        inputSchema: z.object({
          href: z.string(),
          partstat: z.enum(["ACCEPTED", "DECLINED", "TENTATIVE"]),
        }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await calendar.respondToInvitation(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }

  if (config.permissions.allowDelete) {
    server.registerTool(
      "delete_event",
      {
        title: "Delete a calendar event",
        description: "[WRITE] DELETE a VEVENT resource. Requires ICLOUD_ALLOW_DELETE (default false).",
        inputSchema: z.object({ href: z.string() }),
        annotations: DESTRUCTIVE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await calendar.deleteEvent(args.href));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }
}

function registerContactTools(
  server: McpServer,
  contacts: ContactsService,
  config: IcloudConfig,
): void {
  server.registerTool(
    "list_contacts",
    {
      title: "List iCloud contacts",
      description: "Search/list CardDAV contacts (people, not groups). Optional FN/email substring filter.",
      inputSchema: z.object({
        query: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        return jsonResult({ contacts: await contacts.listContacts(args) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    "list_contact_groups",
    {
      title: "List iCloud contact groups",
      description:
        "List CardDAV groups (X-ADDRESSBOOKSERVER-KIND: group) when the address book has them.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).optional() }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        return jsonResult({
          groups: await contacts.listContacts({ ...args, groupsOnly: true }),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    "get_contact",
    {
      title: "Get a contact",
      description: "Fetch one vCard by href or uid.",
      inputSchema: z.object({
        href: z.string().optional(),
        uid: z.string().optional(),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      try {
        return jsonResult(await contacts.getContact(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  if (config.permissions.allowContactsWrite) {
    server.registerTool(
      "create_contact",
      {
        title: "Create a contact",
        description: "[WRITE] PUT a new vCard into the iCloud address book. Requires ICLOUD_ALLOW_CONTACTS_WRITE.",
        inputSchema: z.object({
          fn: z.string().min(1).describe("Full name."),
          emails: z.array(z.string()).optional(),
          phones: z.array(z.string()).optional(),
          org: z.string().optional(),
          note: z.string().optional(),
        }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await contacts.createContact(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
    server.registerTool(
      "update_contact",
      {
        title: "Update a contact or group",
        description: "[WRITE] Replace fields on an existing vCard. Requires ICLOUD_ALLOW_CONTACTS_WRITE.",
        inputSchema: z.object({
          href: z.string(),
          fn: z.string().optional(),
          emails: z.array(z.string()).optional(),
          phones: z.array(z.string()).optional(),
          org: z.string().optional(),
          note: z.string().optional(),
          members: z.array(z.string()).optional().describe("Group member UIDs."),
        }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await contacts.updateContact(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
    server.registerTool(
      "create_contact_group",
      {
        title: "Create a contact group",
        description:
          "[WRITE] Create an iCloud CardDAV group (X-ADDRESSBOOKSERVER-KIND). Requires ICLOUD_ALLOW_CONTACTS_WRITE.",
        inputSchema: z.object({
          name: z.string().min(1),
          memberUids: z.array(z.string()).optional(),
        }),
        annotations: WRITE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await contacts.createGroup(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }

  if (config.permissions.allowDelete) {
    server.registerTool(
      "delete_contact",
      {
        title: "Delete a contact or group",
        description: "[WRITE] DELETE a vCard resource. Requires ICLOUD_ALLOW_DELETE (default false).",
        inputSchema: z.object({ href: z.string() }),
        annotations: DESTRUCTIVE_ANNOTATIONS,
      },
      async (args) => {
        try {
          return jsonResult(await contacts.deleteContact(args.href));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }
}

export async function startStdioServer(): Promise<void> {
  const { server, session } = createApp();
  const transport = new StdioServerTransport();
  const shutdown = async () => {
    await session?.close();
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  await server.connect(transport);
}
