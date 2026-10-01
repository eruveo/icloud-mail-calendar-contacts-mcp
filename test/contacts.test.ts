import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ContactsService } from "../src/contacts/service.js";
import { buildVcard, parseVcard } from "../src/contacts/vcard.js";
import { DavClient } from "../src/dav/client.js";
import type { DavFetch, DavResponse } from "../src/dav/http.js";

const PERSON = `BEGIN:VCARD
VERSION:3.0
UID:jane
FN:Jane Citizen
EMAIL:jane@example.com
TEL:+61400000000
ORG:ACME
END:VCARD`;

const GROUP = `BEGIN:VCARD
VERSION:3.0
UID:family
FN:Family
X-ADDRESSBOOKSERVER-KIND:group
X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:jane
END:VCARD`;

function xml(href: string, inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>${inner}</d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
}

function mockCardDav(): { fetch: DavFetch; puts: string[] } {
  const puts: string[] = [];
  const objects = new Map([
    ["/123/carddavhome/card/jane.vcf", PERSON],
    ["/123/carddavhome/card/family.vcf", GROUP],
  ]);
  const fetch: DavFetch = async (request) => {
    const ok = (status: number, text: string): DavResponse => ({
      url: request.url,
      status,
      headers: { etag: '"c1"' },
      text,
    });
    if (request.body?.includes("current-user-principal")) {
      return ok(
        207,
        xml("/", "<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>"),
      );
    }
    if (request.body?.includes("addressbook-home-set")) {
      return ok(
        207,
        xml(
          "/123/principal/",
          "<c:addressbook-home-set><d:href>/123/carddavhome/</d:href></c:addressbook-home-set>",
        ),
      );
    }
    if (request.method === "PROPFIND") {
      return ok(
        207,
        xml(
          "/123/carddavhome/card/",
          "<d:displayname>Contacts</d:displayname><d:resourcetype><d:collection/><c:addressbook/></d:resourcetype>",
        ),
      );
    }
    if (request.method === "REPORT") {
      const responses = [...objects.entries()]
        .map(
          ([href, vcard]) => `<d:response>
            <d:href>${href}</d:href>
            <d:propstat>
              <d:prop><d:getetag>"c1"</d:getetag><c:address-data>${vcard}</c:address-data></d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>`,
        )
        .join("");
      return ok(
        207,
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">${responses}</d:multistatus>`,
      );
    }
    if (request.method === "PUT") {
      puts.push(request.url);
      return ok(201, "");
    }
    if (request.method === "GET") {
      return ok(200, PERSON);
    }
    if (request.method === "DELETE") {
      return ok(204, "");
    }
    return ok(500, "unexpected");
  };
  return { fetch, puts };
}

describe("vCard", () => {
  it("parses people and iCloud groups", () => {
    const person = parseVcard(PERSON);
    expect(person.fn).toBe("Jane Citizen");
    expect(person.emails).toContain("jane@example.com");
    const group = parseVcard(GROUP);
    expect(group.kind).toBe("group");
    expect(group.members).toContain("jane");
    const built = buildVcard({ fn: "Sam", emails: ["sam@example.com"] });
    expect(built.vcard).toMatch(/FN:Sam/);
  });
});

describe("ContactsService with mocked CardDAV", () => {
  it("lists people vs groups and creates a contact", async () => {
    const { fetch, puts } = mockCardDav();
    const config = loadConfig({
      ICLOUD_EMAIL: "you@icloud.com",
      ICLOUD_APP_PASSWORD: "secret-pass",
      ICLOUD_SERVICES: "contacts",
    });
    const service = new ContactsService(config, new DavClient(fetch, config.carddavUrl));
    const people = await service.listContacts({ query: "Jane" });
    expect(people[0]?.fn).toBe("Jane Citizen");
    const groups = await service.listContacts({ groupsOnly: true });
    expect(groups[0]?.kind).toBe("group");
    const created = await service.createContact({ fn: "New Person", emails: ["n@e.com"] });
    expect(created.href).toMatch(/\.vcf$/);
    expect(puts.length).toBe(1);
  });
});
