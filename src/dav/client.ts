import { assertOk, type DavFetch, type DavRequest, type DavResponse } from "./http.js";
import {
  calendarDataOf,
  displayNameOf,
  ensureTrailingSlash,
  hrefFromProp,
  parseMultistatus,
  resolveHref,
  resourceTypesOf,
  supportedComponents,
  type DavPropstat,
} from "./xml.js";

export class DavClient {
  constructor(
    private readonly davFetch: DavFetch,
    readonly rootUrl: string,
  ) {}

  async request(request: DavRequest): Promise<DavResponse> {
    return this.davFetch(request);
  }

  async propfind(url: string, body: string, depth: "0" | "1"): Promise<DavPropstat[]> {
    const response = await this.davFetch({
      method: "PROPFIND",
      url,
      depth,
      body,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
    if (response.status === 404) {
      return [];
    }
    assertOk(response, `PROPFIND ${url}`);
    return parseMultistatus(response.text).map((item) => ({
      ...item,
      href: resolveHref(response.url, item.href || url),
    }));
  }

  async report(url: string, body: string): Promise<DavPropstat[]> {
    const response = await this.davFetch({
      method: "REPORT",
      url,
      depth: "1",
      body,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
    assertOk(response, `REPORT ${url}`);
    return parseMultistatus(response.text).map((item) => ({
      ...item,
      href: resolveHref(response.url, item.href || url),
    }));
  }

  async get(url: string): Promise<{ text: string; etag: string | null }> {
    const response = await this.davFetch({ method: "GET", url });
    assertOk(response, `GET ${url}`);
    return { text: response.text, etag: response.headers.etag ?? null };
  }

  async put(
    url: string,
    body: string,
    contentType: string,
    etag?: string,
  ): Promise<{ href: string; etag: string | null }> {
    const headers: Record<string, string> = { "Content-Type": contentType };
    if (etag === undefined) {
      headers["If-None-Match"] = "*";
    } else if (etag !== "*") {
      headers["If-Match"] = etag;
    }
    const response = await this.davFetch({ method: "PUT", url, body, headers });
    assertOk(response, `PUT ${url}`);
    return { href: response.url, etag: response.headers.etag ?? null };
  }

  async delete(url: string): Promise<void> {
    const response = await this.davFetch({ method: "DELETE", url });
    if (response.status === 404) {
      return;
    }
    assertOk(response, `DELETE ${url}`);
  }

  async mkcol(url: string, body?: string): Promise<string> {
    const response = await this.davFetch({
      method: "MKCOL",
      url,
      body,
      headers: body ? { "Content-Type": "application/xml; charset=utf-8" } : undefined,
    });
    assertOk(response, `MKCOL ${url}`);
    return response.url;
  }

  async mkcalendar(url: string, body: string): Promise<string> {
    const response = await this.davFetch({
      method: "MKCALENDAR",
      url,
      body,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
    assertOk(response, `MKCALENDAR ${url}`);
    return response.url;
  }

  async discoverHome(homeSetProp: "calendar-home-set" | "addressbook-home-set"): Promise<{
    principal: string;
    home: string;
    inbox: string | null;
  }> {
    const principalXml = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>`;
    const wellKnown =
      homeSetProp === "calendar-home-set"
        ? `${this.rootUrl}/.well-known/caldav`
        : `${this.rootUrl}/.well-known/carddav`;
    let principalProps = await this.propfind(this.rootUrl, principalXml, "0");
    if (!hrefFromProp(principalProps[0]?.props ?? {}, "current-user-principal")) {
      principalProps = await this.propfind(wellKnown, principalXml, "0");
    }
    const principalHref =
      hrefFromProp(principalProps[0]?.props ?? {}, "current-user-principal") ??
      principalProps[0]?.href;
    if (!principalHref) {
      throw new Error(
        `Could not discover current-user-principal from ${this.rootUrl}. Check the app-specific password and that iCloud ${
          homeSetProp === "calendar-home-set" ? "Calendar" : "Contacts"
        } is enabled.`,
      );
    }
    const principal = resolveHref(this.rootUrl + "/", principalHref);
    const ns =
      homeSetProp === "calendar-home-set"
        ? "xmlns:c=\"urn:ietf:params:xml:ns:caldav\""
        : "xmlns:c=\"urn:ietf:params:xml:ns:carddav\"";
    const tag =
      homeSetProp === "calendar-home-set" ? "c:calendar-home-set" : "c:addressbook-home-set";
    const homeXml = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" ${ns}>
  <d:prop>
    <${tag}/>
    <c:schedule-inbox-URL/>
  </d:prop>
</d:propfind>`;
    const homeProps = await this.propfind(principal, homeXml, "0");
    const homeHref = hrefFromProp(homeProps[0]?.props ?? {}, homeSetProp);
    if (!homeHref) {
      throw new Error(`Could not discover ${homeSetProp} for this iCloud account.`);
    }
    const inbox = hrefFromProp(homeProps[0]?.props ?? {}, "schedule-inbox-URL");
    return {
      principal,
      home: ensureTrailingSlash(resolveHref(principal, homeHref)),
      inbox: inbox ? ensureTrailingSlash(resolveHref(principal, inbox)) : null,
    };
  }
}

export function listCollectionEntries(
  props: DavPropstat[],
  kind: "calendar" | "addressbook",
): Array<{
  href: string;
  name: string;
  components: string[];
  types: string[];
  data?: string;
  etag?: string;
}> {
  const wanted = kind === "calendar" ? "calendar" : "addressbook";
  return props
    .map((item) => {
      const types = resourceTypesOf(item.props);
      return {
        href: ensureTrailingSlash(item.href),
        name: displayNameOf(item.props) || item.href,
        components: supportedComponents(item.props),
        types,
        data: calendarDataOf(item.props),
        etag:
          typeof item.props.getetag === "string"
            ? item.props.getetag
            : undefined,
      };
    })
    .filter((item) => item.types.includes(wanted) || item.types.includes("collection"));
}

export { calendarDataOf, displayNameOf, resourceTypesOf, supportedComponents };
