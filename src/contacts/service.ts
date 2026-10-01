import {
  DEFAULT_CONTACT_LIMIT,
  MAX_CONTACT_LIMIT,
  assertAllowed,
  type IcloudConfig,
} from "../config.js";
import { DavClient } from "../dav/client.js";
import { calendarDataOf, resourceTypesOf } from "../dav/xml.js";
import { clampLimit } from "../mail-service.js";
import { buildVcard, mergeVcard, parseVcard, type ParsedContact } from "./vcard.js";

const LIST_PROPS = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

function addressbookQuery(filter?: string): string {
  const filterXml = filter
    ? `<c:prop-filter name="FN"><c:text-match collation="i;unicode-casemap" match-type="contains">${escapeXml(
        filter,
      )}</c:text-match></c:prop-filter>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag/>
    <c:address-data/>
  </d:prop>
  ${filterXml ? `<c:filter>${filterXml}</c:filter>` : ""}
</c:addressbook-query>`;
}

export interface AddressBookInfo {
  href: string;
  name: string;
}

export class ContactsService {
  private home: string | null = null;

  constructor(
    private readonly config: IcloudConfig,
    private readonly dav: DavClient,
  ) {}

  private async ensureHome(): Promise<string> {
    if (this.home) {
      return this.home;
    }
    const discovered = await this.dav.discoverHome("addressbook-home-set");
    this.home = discovered.home;
    return discovered.home;
  }

  async listAddressBooks(): Promise<AddressBookInfo[]> {
    const home = await this.ensureHome();
    const entries = await this.dav.propfind(home, LIST_PROPS, "1");
    return entries
      .filter((item) => resourceTypesOf(item.props).includes("addressbook"))
      .map((item) => ({
        href: item.href.endsWith("/") ? item.href : `${item.href}/`,
        name:
          (typeof item.props.displayname === "string" && item.props.displayname) ||
          "Contacts",
      }));
  }

  async defaultBook(): Promise<AddressBookInfo> {
    const books = await this.listAddressBooks();
    if (books.length === 0) {
      throw new Error("No CardDAV address books found on this iCloud account.");
    }
    return books[0]!;
  }

  async listContacts(input: {
    query?: string;
    limit?: number;
    groupsOnly?: boolean;
  }): Promise<ParsedContact[]> {
    const book = await this.defaultBook();
    const rows = await this.dav.report(book.href, addressbookQuery(input.query));
    const limit = clampLimit(input.limit, DEFAULT_CONTACT_LIMIT, MAX_CONTACT_LIMIT);
    const contacts: ParsedContact[] = [];
    for (const row of rows) {
      const data = calendarDataOf(row.props);
      if (!data) {
        continue;
      }
      const etag = typeof row.props.getetag === "string" ? row.props.getetag : undefined;
      const parsed = parseVcard(data, row.href, etag);
      if (input.groupsOnly && parsed.kind !== "group") {
        continue;
      }
      if (!input.groupsOnly && parsed.kind === "group") {
        continue;
      }
      if (
        input.query &&
        !parsed.fn.toLowerCase().includes(input.query.toLowerCase()) &&
        !parsed.emails.some((email) =>
          email.toLowerCase().includes(input.query!.toLowerCase()),
        )
      ) {
        continue;
      }
      contacts.push(parsed);
    }
    return contacts.slice(0, limit);
  }

  async getContact(input: { href?: string; uid?: string }): Promise<ParsedContact> {
    if (input.href) {
      const got = await this.dav.get(input.href);
      return parseVcard(got.text, input.href, got.etag ?? undefined);
    }
    if (!input.uid) {
      throw new Error("Provide href or uid.");
    }
    const all = await this.listContacts({ limit: MAX_CONTACT_LIMIT });
    const groups = await this.listContacts({ limit: MAX_CONTACT_LIMIT, groupsOnly: true });
    const match = [...all, ...groups].find((contact) => contact.uid === input.uid);
    if (!match) {
      throw new Error(`No contact with uid ${input.uid}.`);
    }
    return match;
  }

  async createContact(input: {
    fn: string;
    emails?: string[];
    phones?: string[];
    org?: string;
    note?: string;
  }): Promise<{ uid: string; href: string }> {
    assertAllowed(this.config.permissions, "allowContactsWrite", "create a contact");
    const book = await this.defaultBook();
    const built = buildVcard({ ...input, kind: "person" });
    const href = `${book.href}${encodeURIComponent(built.uid)}.vcf`;
    await this.dav.put(href, built.vcard, "text/vcard; charset=utf-8");
    return { uid: built.uid, href };
  }

  async updateContact(input: {
    href: string;
    fn?: string;
    emails?: string[];
    phones?: string[];
    org?: string;
    note?: string;
    members?: string[];
  }): Promise<{ href: string }> {
    assertAllowed(this.config.permissions, "allowContactsWrite", "update a contact");
    const got = await this.dav.get(input.href);
    const merged = mergeVcard(got.text, input);
    await this.dav.put(input.href, merged, "text/vcard; charset=utf-8", got.etag ?? "*");
    return { href: input.href };
  }

  async deleteContact(href: string): Promise<{ href: string; deleted: true }> {
    assertAllowed(this.config.permissions, "allowDelete", "delete a contact");
    await this.dav.delete(href);
    return { href, deleted: true };
  }

  async createGroup(input: {
    name: string;
    memberUids?: string[];
  }): Promise<{ uid: string; href: string }> {
    assertAllowed(this.config.permissions, "allowContactsWrite", "create a contact group");
    const book = await this.defaultBook();
    const built = buildVcard({
      fn: input.name,
      kind: "group",
      members: input.memberUids,
    });
    const href = `${book.href}${encodeURIComponent(built.uid)}.vcf`;
    await this.dav.put(href, built.vcard, "text/vcard; charset=utf-8");
    return { uid: built.uid, href };
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
