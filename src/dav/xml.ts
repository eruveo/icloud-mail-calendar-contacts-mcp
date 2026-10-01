import { XMLParser } from "fast-xml-parser";

export interface DavPropstat {
  href: string;
  status: number;
  props: Record<string, unknown>;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (name) =>
    [
      "response",
      "propstat",
      "href",
      "resourcetype",
      "comp",
      "calendar-home-set",
      "addressbook-home-set",
      "current-user-principal",
    ].includes(name),
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseStatus(status: unknown): number {
  if (typeof status !== "string") {
    return 200;
  }
  const match = status.match(/\s(\d{3})\s/u);
  return match ? Number.parseInt(match[1] ?? "200", 10) : 200;
}

function textContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: unknown })["#text"];
    return typeof text === "string" ? text : undefined;
  }
  return undefined;
}

function firstHref(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  const hrefs = asArray((value as { href?: unknown }).href);
  for (const href of hrefs) {
    const text = textContent(href) ?? (typeof href === "string" ? href : undefined);
    if (text) {
      return text;
    }
  }
  return textContent(value);
}

export function parseMultistatus(xml: string): DavPropstat[] {
  const parsed = parser.parse(xml) as {
    multistatus?: { response?: unknown };
  };
  const responses = asArray(parsed.multistatus?.response);
  const results: DavPropstat[] = [];
  for (const raw of responses) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const node = raw as { href?: unknown; propstat?: unknown };
    const href = firstHref({ href: node.href }) ?? "";
    const propstats = asArray(node.propstat);
    for (const propstat of propstats) {
      if (!propstat || typeof propstat !== "object") {
        continue;
      }
      const entry = propstat as { status?: unknown; prop?: Record<string, unknown> };
      results.push({
        href,
        status: parseStatus(entry.status),
        props: entry.prop ?? {},
      });
    }
  }
  return results;
}

export function hrefFromProp(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const href = firstHref(entry);
      if (href) {
        return href;
      }
    }
    return undefined;
  }
  return firstHref(value);
}

export function displayNameOf(props: Record<string, unknown>): string {
  return textContent(props.displayname) ?? "";
}

export function resourceTypesOf(props: Record<string, unknown>): string[] {
  const raw = props.resourcetype;
  const nodes = asArray(raw);
  const names: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    for (const key of Object.keys(node as Record<string, unknown>)) {
      if (key !== "#text") {
        names.push(key.toLowerCase());
      }
    }
  }
  return names;
}

export function supportedComponents(props: Record<string, unknown>): string[] {
  const raw = props["supported-calendar-component-set"] as
    | { comp?: Array<{ "@_name"?: string; name?: string }> }
    | undefined;
  const comps = asArray(raw?.comp);
  return comps
    .map((comp) => (comp["@_name"] ?? comp.name ?? "").toUpperCase())
    .filter(Boolean);
}

export function calendarDataOf(props: Record<string, unknown>): string | undefined {
  return textContent(props["calendar-data"]) ?? textContent(props["address-data"]);
}

export function resolveHref(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}

export function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
