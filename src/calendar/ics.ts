import { DateTime } from "luxon";
import ICAL from "ical.js";

export interface Attendee {
  email: string;
  name?: string;
  role?: string;
  partstat?: string;
  rsvp?: boolean;
}

export interface CalendarOccurrence {
  uid: string;
  href?: string;
  etag?: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  timezone: string;
  location: string | null;
  notes: string | null;
  recurrenceId: string | null;
  rrule: string | null;
  recurring: boolean;
  organizer: string | null;
  attendees: Attendee[];
  method: string | null;
}

export interface CreateEventInput {
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  timezone: string;
  location?: string;
  notes?: string;
  alarmMinutesBefore?: number;
  organizerEmail?: string;
  attendees?: Attendee[];
  uid?: string;
}

const PRODID = "-//icloud-mail-calendar-contacts-mcp//EN";
const MAX_OCCURRENCES = 500;

function registerTimezones(vcalendar: ICAL.Component): void {
  for (const tz of vcalendar.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      // Ignore malformed VTIMEZONE blocks from the server.
    }
  }
}

function formatIcalTime(time: ICAL.Time, displayZone: string): string {
  if (time.isDate) {
    const year = String(time.year).padStart(4, "0");
    const month = String(time.month).padStart(2, "0");
    const day = String(time.day).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const js = time.toJSDate();
  return DateTime.fromJSDate(js, { zone: "utc" }).setZone(displayZone).toISO({
    suppressMilliseconds: true,
  }) ?? js.toISOString();
}

function overlaps(
  start: ICAL.Time,
  end: ICAL.Time | null,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  const startMs = start.toJSDate().getTime();
  const endMs = end ? end.toJSDate().getTime() : startMs;
  return startMs < rangeEnd.getTime() && endMs > rangeStart.getTime();
}

function eventNotes(event: ICAL.Event): string | null {
  const description = event.description?.trim();
  return description ? description : null;
}

function parseAttendees(event: ICAL.Event): Attendee[] {
  const props = event.component.getAllProperties("attendee");
  return props.map((prop) => {
    const calAddress = String(prop.getFirstValue() ?? "").replace(/^mailto:/iu, "");
    return {
      email: calAddress,
      name: prop.getParameter("cn") ? String(prop.getParameter("cn")) : undefined,
      role: prop.getParameter("role") ? String(prop.getParameter("role")) : undefined,
      partstat: prop.getParameter("partstat")
        ? String(prop.getParameter("partstat"))
        : undefined,
      rsvp: String(prop.getParameter("rsvp") ?? "").toUpperCase() === "TRUE",
    };
  });
}

function occurrenceFromEvent(
  event: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time | null,
  displayZone: string,
  href?: string,
  etag?: string,
  recurrenceId?: ICAL.Time | null,
  method?: string | null,
): CalendarOccurrence {
  const zone =
    (!start.isDate && start.zone?.tzid && start.zone.tzid !== "UTC"
      ? start.zone.tzid
      : displayZone) || displayZone;
  const organizerRaw = event.organizer ? String(event.organizer) : "";
  return {
    uid: event.uid,
    href,
    etag,
    title: event.summary || "(no title)",
    start: formatIcalTime(start, zone),
    end: end ? formatIcalTime(end, zone) : null,
    allDay: start.isDate,
    timezone: start.isDate ? "floating" : zone,
    location: event.location?.trim() || null,
    notes: eventNotes(event),
    recurrenceId: recurrenceId ? formatIcalTime(recurrenceId, zone) : null,
    rrule: event.component.getFirstPropertyValue("rrule")
      ? String(event.component.getFirstPropertyValue("rrule"))
      : null,
    recurring: event.isRecurring(),
    organizer: organizerRaw.replace(/^mailto:/iu, "") || null,
    attendees: parseAttendees(event),
    method: method ?? null,
  };
}

export function expandCalendarData(
  ics: string,
  rangeStart: Date,
  rangeEnd: Date,
  displayZone: string,
  href?: string,
  etag?: string,
): CalendarOccurrence[] {
  const parsed = ICAL.parse(ics);
  const vcalendar = new ICAL.Component(parsed);
  registerTimezones(vcalendar);
  const method = vcalendar.getFirstPropertyValue("method")
    ? String(vcalendar.getFirstPropertyValue("method"))
    : null;
  const results: CalendarOccurrence[] = [];
  const vevents = vcalendar.getAllSubcomponents("vevent");
  const masters = vevents.filter((comp) => !comp.getFirstPropertyValue("recurrence-id"));

  const consider = (event: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null, rid?: ICAL.Time | null) => {
    if (!overlaps(start, end, rangeStart, rangeEnd)) {
      return;
    }
    results.push(occurrenceFromEvent(event, start, end, displayZone, href, etag, rid, method));
  };

  for (const vevent of masters) {
    const event = new ICAL.Event(vevent);
    if (!event.isRecurring()) {
      consider(event, event.startDate, event.endDate ?? null);
      continue;
    }
    const iterator = event.iterator();
    let next = iterator.next();
    let count = 0;
    while (next && count < MAX_OCCURRENCES) {
      if (next.toJSDate().getTime() >= rangeEnd.getTime()) {
        break;
      }
      const details = event.getOccurrenceDetails(next);
      consider(event, details.startDate, details.endDate ?? null, details.recurrenceId);
      next = iterator.next();
      count += 1;
    }
  }
  results.sort((a, b) => a.start.localeCompare(b.start));
  return results;
}

export function parseEventDetails(
  ics: string,
  displayZone: string,
  href?: string,
  etag?: string,
): CalendarOccurrence[] {
  const parsed = ICAL.parse(ics);
  const vcalendar = new ICAL.Component(parsed);
  registerTimezones(vcalendar);
  const method = vcalendar.getFirstPropertyValue("method")
    ? String(vcalendar.getFirstPropertyValue("method"))
    : null;
  return vcalendar.getAllSubcomponents("vevent").map((vevent) => {
    const event = new ICAL.Event(vevent);
    return occurrenceFromEvent(
      event,
      event.startDate,
      event.endDate ?? null,
      displayZone,
      href,
      etag,
      event.component.getFirstPropertyValue("recurrence-id") as ICAL.Time | null,
      method,
    );
  });
}

export function applyAttendeePartstat(
  ics: string,
  attendeeEmail: string,
  partstat: "ACCEPTED" | "DECLINED" | "TENTATIVE",
): string {
  const vcalendar = new ICAL.Component(ICAL.parse(ics));
  vcalendar.updatePropertyWithValue("method", "REPLY");
  const needle = attendeeEmail.trim().toLowerCase();
  for (const vevent of vcalendar.getAllSubcomponents("vevent")) {
    for (const prop of vevent.getAllProperties("attendee")) {
      const value = String(prop.getFirstValue() ?? "")
        .replace(/^mailto:/iu, "")
        .toLowerCase();
      if (value === needle) {
        prop.setParameter("partstat", partstat);
      }
    }
  }
  return vcalendar.toString();
}

function icalDate(date: DateTime, allDay: boolean): ICAL.Time {
  if (allDay) {
    const time = ICAL.Time.fromDateString(date.toISODate() ?? "");
    time.isDate = true;
    return time;
  }
  return ICAL.Time.fromJSDate(date.toUTC().toJSDate(), true);
}

function addAttendees(vevent: ICAL.Component, input: CreateEventInput): void {
  if (input.organizerEmail) {
    const organizer = vevent.addPropertyWithValue(
      "organizer",
      `mailto:${input.organizerEmail}`,
    );
    organizer.setParameter("cn", input.organizerEmail);
  }
  for (const attendee of input.attendees ?? []) {
    const prop = vevent.addPropertyWithValue("attendee", `mailto:${attendee.email}`);
    if (attendee.name) {
      prop.setParameter("cn", attendee.name);
    }
    prop.setParameter("role", attendee.role ?? "REQ-PARTICIPANT");
    prop.setParameter("partstat", attendee.partstat ?? "NEEDS-ACTION");
    prop.setParameter("rsvp", attendee.rsvp === false ? "FALSE" : "TRUE");
  }
}

export function buildEventIcs(input: CreateEventInput): { uid: string; ics: string } {
  const uid = input.uid ?? `${crypto.randomUUID()}@icloud-mail-calendar-contacts-mcp`;
  const calendar = new ICAL.Component(["vcalendar", [], []]);
  calendar.updatePropertyWithValue("prodid", PRODID);
  calendar.updatePropertyWithValue("version", "2.0");
  calendar.updatePropertyWithValue("calscale", "GREGORIAN");
  calendar.updatePropertyWithValue("x-wr-timezone", input.timezone);
  if (input.attendees && input.attendees.length > 0) {
    calendar.updatePropertyWithValue("method", "REQUEST");
  }

  const vevent = new ICAL.Component("vevent");
  vevent.updatePropertyWithValue("uid", uid);
  vevent.updatePropertyWithValue("summary", input.title);
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  vevent.updatePropertyWithValue("transp", input.allDay ? "TRANSPARENT" : "OPAQUE");

  const startLocal = DateTime.fromISO(input.start, { zone: input.timezone });
  if (!startLocal.isValid) {
    throw new Error(`Invalid start datetime "${input.start}". Use ISO-8601.`);
  }
  const endLocal = input.end
    ? DateTime.fromISO(input.end, { zone: input.timezone })
    : input.allDay
      ? startLocal.plus({ days: 1 })
      : startLocal.plus({ hours: 1 });
  if (!endLocal.isValid) {
    throw new Error(`Invalid end datetime "${input.end}". Use ISO-8601.`);
  }
  if (endLocal <= startLocal) {
    throw new Error("Event end must be after start.");
  }

  vevent.updatePropertyWithValue("dtstart", icalDate(startLocal, input.allDay === true));
  vevent.updatePropertyWithValue("dtend", icalDate(endLocal, input.allDay === true));
  if (input.location) {
    vevent.updatePropertyWithValue("location", input.location);
  }
  if (input.notes) {
    vevent.updatePropertyWithValue("description", input.notes);
  }
  addAttendees(vevent, input);
  if (input.alarmMinutesBefore !== undefined) {
    if (input.alarmMinutesBefore < 0) {
      throw new Error("alarmMinutesBefore must be zero or a positive number of minutes.");
    }
    const alarm = new ICAL.Component("valarm");
    alarm.updatePropertyWithValue("action", "DISPLAY");
    alarm.updatePropertyWithValue("description", input.title);
    alarm.updatePropertyWithValue("trigger", `-PT${input.alarmMinutesBefore}M`);
    vevent.addSubcomponent(alarm);
  }
  calendar.addSubcomponent(vevent);
  return { uid, ics: calendar.toString() };
}

export function mergeEventIcs(
  existing: string,
  patch: Partial<CreateEventInput> & { timezone: string },
): string {
  const calendar = new ICAL.Component(ICAL.parse(existing));
  const vevent = calendar.getFirstSubcomponent("vevent");
  if (!vevent) {
    throw new Error("Existing calendar object has no VEVENT.");
  }
  if (patch.title) {
    vevent.updatePropertyWithValue("summary", patch.title);
  }
  if (patch.location !== undefined) {
    vevent.updatePropertyWithValue("location", patch.location);
  }
  if (patch.notes !== undefined) {
    vevent.updatePropertyWithValue("description", patch.notes);
  }
  if (patch.start) {
    const startLocal = DateTime.fromISO(patch.start, { zone: patch.timezone });
    if (!startLocal.isValid) {
      throw new Error(`Invalid start datetime "${patch.start}".`);
    }
    const endLocal = patch.end
      ? DateTime.fromISO(patch.end, { zone: patch.timezone })
      : startLocal.plus({ hours: patch.allDay ? 24 : 1 });
    vevent.updatePropertyWithValue("dtstart", icalDate(startLocal, patch.allDay === true));
    vevent.updatePropertyWithValue("dtend", icalDate(endLocal, patch.allDay === true));
  }
  if (patch.attendees) {
    vevent.removeAllProperties("attendee");
    addAttendees(vevent, {
      title: patch.title ?? "",
      start: patch.start ?? "",
      timezone: patch.timezone,
      organizerEmail: patch.organizerEmail,
      attendees: patch.attendees,
    });
    if (patch.attendees.length > 0) {
      calendar.updatePropertyWithValue("method", "REQUEST");
    }
  }
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  return calendar.toString();
}

export function caldavTimeRange(start: Date, end: Date): { start: string; end: string } {
  const fmt = (date: Date) =>
    `${date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z")}`;
  return { start: fmt(start), end: fmt(end) };
}
