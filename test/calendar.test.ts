import { describe, expect, it } from "vitest";
import { CalendarService } from "../src/calendar/service.js";
import { applyAttendeePartstat, buildEventIcs, expandCalendarData } from "../src/calendar/ics.js";
import { loadConfig } from "../src/config.js";
import { DavClient } from "../src/dav/client.js";
import type { DavFetch, DavRequest, DavResponse } from "../src/dav/http.js";

const WEEKLY = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:standup@icloud-mcp
DTSTART:20260302T000000Z
DTEND:20260302T003000Z
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Standup
END:VEVENT
END:VCALENDAR`;

function xml(href: string, inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>${inner}</d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
}

function mockCalDav(): { fetch: DavFetch; puts: DavRequest[]; deletes: string[] } {
  const puts: DavRequest[] = [];
  const deletes: string[] = [];
  const objects = new Map<string, string>([
    ["https://p1-caldav.icloud.com/123/calendars/home/standup.ics", WEEKLY],
  ]);
  const fetch: DavFetch = async (request) => {
    const ok = (status: number, text: string): DavResponse => ({
      url: request.url,
      status,
      headers: { etag: '"1"' },
      text,
    });
    if (request.method === "PROPFIND" && request.body?.includes("current-user-principal")) {
      return ok(
        207,
        xml("/", "<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>"),
      );
    }
    if (request.method === "PROPFIND" && request.body?.includes("calendar-home-set")) {
      return ok(
        207,
        xml(
          "/123/principal/",
          "<c:calendar-home-set><d:href>/123/calendars/</d:href></c:calendar-home-set><c:schedule-inbox-URL><d:href>/123/inbox/</d:href></c:schedule-inbox-URL>",
        ),
      );
    }
    if (request.method === "PROPFIND" && request.url.includes("/calendars/")) {
      return ok(
        207,
        xml(
          "/123/calendars/home/",
          `<d:displayname>Home</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
           <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>`,
        ),
      );
    }
    if (request.method === "REPORT") {
      const href = [...objects.keys()][0]!;
      const ics = objects.get(href)!;
      return ok(
        207,
        xml(
          "/123/calendars/home/standup.ics",
          `<d:getetag>"1"</d:getetag><c:calendar-data>${ics}</c:calendar-data>`,
        ),
      );
    }
    if (request.method === "GET") {
      const body = objects.get(request.url) ?? WEEKLY;
      return ok(200, body);
    }
    if (request.method === "PUT") {
      puts.push(request);
      objects.set(request.url, request.body ?? "");
      return ok(201, "");
    }
    if (request.method === "MKCALENDAR") {
      return ok(201, "");
    }
    if (request.method === "DELETE") {
      deletes.push(request.url);
      return ok(204, "");
    }
    return ok(500, "unexpected");
  };
  return { fetch, puts, deletes };
}

const env = {
  ICLOUD_EMAIL: "you@icloud.com",
  ICLOUD_APP_PASSWORD: "secret-pass",
  ICLOUD_SERVICES: "calendar",
  ICLOUD_ALLOW_DELETE: "true",
};

describe("calendar ICS", () => {
  it("expands weekly recurrences inside the window", () => {
    const occ = expandCalendarData(
      WEEKLY,
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-03-20T00:00:00Z"),
      "UTC",
    );
    expect(occ.length).toBeGreaterThanOrEqual(3);
    expect(occ[0]?.title).toBe("Standup");
    expect(occ.every((item) => item.recurring)).toBe(true);
  });

  it("builds invitations with attendees and applies RSVP", () => {
    const { ics } = buildEventIcs({
      title: "Review",
      start: "2026-03-15T10:00:00",
      timezone: "Australia/Sydney",
      organizerEmail: "you@icloud.com",
      attendees: [{ email: "dev@example.com", name: "Dev" }],
    });
    expect(ics).toMatch(/METHOD:REQUEST/);
    expect(ics).toMatch(/ATTENDEE/);
    const replied = applyAttendeePartstat(ics, "dev@example.com", "ACCEPTED");
    expect(replied).toMatch(/PARTSTAT=ACCEPTED/);
  });
});

describe("CalendarService with mocked CalDAV", () => {
  it("lists calendars, expands events, creates and deletes", async () => {
    const { fetch, puts, deletes } = mockCalDav();
    const config = loadConfig(env);
    const service = new CalendarService(config, new DavClient(fetch, config.caldavUrl));
    const calendars = await service.listCalendars();
    expect(calendars[0]?.name).toBe("Home");
    const events = await service.listEvents({
      start: "2026-03-01T00:00:00Z",
      end: "2026-03-31T00:00:00Z",
    });
    expect(events.length).toBeGreaterThan(1);
    const created = await service.createEvent({
      title: "Ship",
      start: "2026-03-20T15:00:00",
      attendees: [{ email: "qa@example.com" }],
    });
    expect(created.href).toMatch(/\.ics$/);
    expect(puts.at(-1)?.body).toMatch(/ATTENDEE/);
    await service.deleteEvent(created.href);
    expect(deletes).toContain(created.href);
  });

  it("refuses deletes when ICLOUD_ALLOW_DELETE is off", async () => {
    const { fetch } = mockCalDav();
    const config = loadConfig({ ...env, ICLOUD_ALLOW_DELETE: "false" });
    const service = new CalendarService(config, new DavClient(fetch, config.caldavUrl));
    await expect(service.deleteEvent("https://example/x.ics")).rejects.toThrow(
      /ICLOUD_ALLOW_DELETE/,
    );
  });
});
