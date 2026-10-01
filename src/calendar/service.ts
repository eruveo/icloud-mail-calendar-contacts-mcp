import {
  DEFAULT_EVENT_LIMIT,
  MAX_EVENT_LIMIT,
  assertAllowed,
  type IcloudConfig,
} from "../config.js";
import { DavClient } from "../dav/client.js";
import { calendarDataOf, resourceTypesOf } from "../dav/xml.js";
import { clampLimit } from "../mail-service.js";
import {
  applyAttendeePartstat,
  buildEventIcs,
  caldavTimeRange,
  expandCalendarData,
  mergeEventIcs,
  parseEventDetails,
  type Attendee,
  type CalendarOccurrence,
  type CreateEventInput,
} from "./ics.js";

const LIST_PROPS = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:supported-calendar-component-set/>
    <c:schedule-inbox-URL/>
  </d:prop>
</d:propfind>`;

function calendarQueryXml(start: string, end: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${start}" end="${end}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
}

export interface CalendarInfo {
  href: string;
  name: string;
  components: string[];
  vevent: boolean;
}

export class CalendarService {
  private home: string | null = null;
  private inbox: string | null = null;

  constructor(
    private readonly config: IcloudConfig,
    private readonly dav: DavClient,
  ) {}

  private async ensureHome(): Promise<{ home: string; inbox: string | null }> {
    if (this.home) {
      return { home: this.home, inbox: this.inbox };
    }
    const discovered = await this.dav.discoverHome("calendar-home-set");
    this.home = discovered.home;
    this.inbox = discovered.inbox;
    return discovered;
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const { home } = await this.ensureHome();
    const entries = await this.dav.propfind(home, LIST_PROPS, "1");
    return entries
      .filter((item) => resourceTypesOf(item.props).includes("calendar"))
      .map((item) => {
        const comps = (() => {
          const raw = item.props["supported-calendar-component-set"] as
            | { comp?: Array<{ "@_name"?: string }> }
            | undefined;
          const list = raw?.comp ?? [];
          return list.map((comp) => (comp["@_name"] ?? "").toUpperCase()).filter(Boolean);
        })();
        return {
          href: item.href.endsWith("/") ? item.href : `${item.href}/`,
          name:
            (typeof item.props.displayname === "string" && item.props.displayname) ||
            item.href,
          components: comps,
          vevent: comps.length === 0 || comps.includes("VEVENT"),
        };
      })
      .filter((cal) => cal.vevent);
  }

  async resolveCalendar(nameOrHref?: string): Promise<CalendarInfo> {
    const calendars = await this.listCalendars();
    if (calendars.length === 0) {
      throw new Error("No VEVENT calendars found on this iCloud account.");
    }
    if (!nameOrHref) {
      const named = calendars.find((cal) => /home|personal|calendar/iu.test(cal.name));
      return named ?? calendars[0]!;
    }
    const needle = nameOrHref.trim().toLowerCase();
    const match = calendars.find(
      (cal) =>
        cal.href.toLowerCase() === needle ||
        cal.href.toLowerCase().includes(needle) ||
        cal.name.toLowerCase() === needle,
    );
    if (!match) {
      throw new Error(
        `Calendar "${nameOrHref}" not found. Known: ${calendars.map((cal) => cal.name).join(", ")}`,
      );
    }
    return match;
  }

  async listEvents(input: {
    calendar?: string;
    start: string;
    end: string;
    timezone?: string;
    limit?: number;
  }): Promise<CalendarOccurrence[]> {
    const cal = await this.resolveCalendar(input.calendar);
    const start = new Date(input.start);
    const end = new Date(input.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("start and end must be ISO-8601 datetimes.");
    }
    const range = caldavTimeRange(start, end);
    const zone = input.timezone ?? this.config.timezone;
    const rows = await this.dav.report(cal.href, calendarQueryXml(range.start, range.end));
    const limit = clampLimit(input.limit, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT);
    const expanded: CalendarOccurrence[] = [];
    for (const row of rows) {
      const ics = calendarDataOf(row.props);
      if (!ics) {
        continue;
      }
      const etag = typeof row.props.getetag === "string" ? row.props.getetag : undefined;
      expanded.push(...expandCalendarData(ics, start, end, zone, row.href, etag));
    }
    return expanded.slice(0, limit);
  }

  async getEvent(input: {
    href?: string;
    uid?: string;
    calendar?: string;
    timezone?: string;
  }): Promise<CalendarOccurrence> {
    const zone = input.timezone ?? this.config.timezone;
    if (input.href) {
      const got = await this.dav.get(input.href);
      const details = parseEventDetails(got.text, zone, input.href, got.etag ?? undefined);
      const found = details[0];
      if (!found) {
        throw new Error("No VEVENT in that resource.");
      }
      return found;
    }
    if (!input.uid) {
      throw new Error("Provide href or uid.");
    }
    const start = new Date("1970-01-01T00:00:00Z");
    const end = new Date("2100-01-01T00:00:00Z");
    const events = await this.listEvents({
      calendar: input.calendar,
      start: start.toISOString(),
      end: end.toISOString(),
      timezone: zone,
      limit: MAX_EVENT_LIMIT,
    });
    const match = events.find((event) => event.uid === input.uid);
    if (!match) {
      throw new Error(`No event with uid ${input.uid}.`);
    }
    return match;
  }

  async createEvent(
    input: Omit<CreateEventInput, "timezone" | "organizerEmail"> & {
      calendar?: string;
      timezone?: string;
    },
  ): Promise<{ uid: string; href: string }> {
    assertAllowed(this.config.permissions, "allowCalendarWrite", "create a calendar event");
    const cal = await this.resolveCalendar(input.calendar);
    const built = buildEventIcs({
      ...input,
      timezone: input.timezone ?? this.config.timezone,
      organizerEmail: this.config.email,
    });
    const href = `${cal.href}${encodeURIComponent(built.uid)}.ics`;
    await this.dav.put(href, built.ics, "text/calendar; charset=utf-8");
    return { uid: built.uid, href };
  }

  async updateEvent(input: {
    href: string;
    etag?: string;
    title?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
    timezone?: string;
    location?: string;
    notes?: string;
    attendees?: Attendee[];
  }): Promise<{ href: string }> {
    assertAllowed(this.config.permissions, "allowCalendarWrite", "update a calendar event");
    const got = await this.dav.get(input.href);
    const merged = mergeEventIcs(got.text, {
      timezone: input.timezone ?? this.config.timezone,
      title: input.title,
      start: input.start,
      end: input.end,
      allDay: input.allDay,
      location: input.location,
      notes: input.notes,
      attendees: input.attendees,
      organizerEmail: this.config.email,
    });
    await this.dav.put(
      input.href,
      merged,
      "text/calendar; charset=utf-8",
      input.etag ?? got.etag ?? "*",
    );
    return { href: input.href };
  }

  async deleteEvent(href: string): Promise<{ href: string; deleted: true }> {
    assertAllowed(this.config.permissions, "allowDelete", "delete a calendar event");
    await this.dav.delete(href);
    return { href, deleted: true };
  }

  async createCalendar(name: string): Promise<{ href: string; name: string }> {
    assertAllowed(this.config.permissions, "allowCalendarWrite", "create a calendar");
    const { home } = await this.ensureHome();
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "") || crypto.randomUUID();
    const href = `${home}${slug}/`;
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:displayname>${escapeXml(name)}</d:displayname>
      <c:supported-calendar-component-set>
        <c:comp name="VEVENT"/>
      </c:supported-calendar-component-set>
    </d:prop>
  </d:set>
</c:mkcalendar>`;
    await this.dav.mkcalendar(href, body);
    return { href, name };
  }

  async listInvitations(timezone?: string): Promise<CalendarOccurrence[]> {
    const { inbox, home } = await this.ensureHome();
    const target = inbox ?? home;
    const start = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const end = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    const range = caldavTimeRange(start, end);
    const zone = timezone ?? this.config.timezone;
    const rows = await this.dav.report(target, calendarQueryXml(range.start, range.end));
    const out: CalendarOccurrence[] = [];
    for (const row of rows) {
      const ics = calendarDataOf(row.props);
      if (!ics) {
        continue;
      }
      const etag = typeof row.props.getetag === "string" ? row.props.getetag : undefined;
      for (const event of parseEventDetails(ics, zone, row.href, etag)) {
        const needsAction = event.attendees.some(
          (attendee) =>
            attendee.email.toLowerCase() === this.config.email.toLowerCase() &&
            (attendee.partstat ?? "NEEDS-ACTION").toUpperCase() === "NEEDS-ACTION",
        );
        if (event.method === "REQUEST" || needsAction) {
          out.push(event);
        }
      }
    }
    return out;
  }

  async respondToInvitation(input: {
    href: string;
    partstat: "ACCEPTED" | "DECLINED" | "TENTATIVE";
  }): Promise<{ href: string; partstat: string }> {
    assertAllowed(this.config.permissions, "allowCalendarWrite", "respond to an invitation");
    const got = await this.dav.get(input.href);
    const replied = applyAttendeePartstat(got.text, this.config.email, input.partstat);
    await this.dav.put(input.href, replied, "text/calendar; charset=utf-8", got.etag ?? "*");
    return { href: input.href, partstat: input.partstat };
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
