import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CalendarService } from "../calendar/service.js";
import type { IcloudConfig } from "../config.js";
import type { ContactsService } from "../contacts/service.js";
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  errorResult,
  jsonResult,
} from "./common.js";

export function registerCalendarTools(
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
          attendees: z.array(z.object({ email: z.string(), name: z.string().optional() })).optional(),
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

export function registerContactTools(
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
      description: "List CardDAV groups (X-ADDRESSBOOKSERVER-KIND: group) when the address book has them.",
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
