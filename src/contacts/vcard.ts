export interface ParsedContact {
  uid: string;
  href?: string;
  etag?: string;
  fn: string;
  emails: string[];
  phones: string[];
  org: string | null;
  note: string | null;
  kind: "person" | "group";
  members: string[];
}

function unfold(vcard: string): string[] {
  return vcard.replace(/\r\n[ \t]/gu, "").replace(/\n[ \t]/gu, "").split(/\r?\n/u);
}

function parseLine(line: string): { name: string; params: string; value: string } | null {
  const idx = line.indexOf(":");
  if (idx < 0) {
    return null;
  }
  const meta = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const [name, ...rest] = meta.split(";");
  return { name: (name ?? "").toUpperCase(), params: rest.join(";"), value };
}

export function parseVcard(vcard: string, href?: string, etag?: string): ParsedContact {
  const emails: string[] = [];
  const phones: string[] = [];
  const members: string[] = [];
  let uid = "";
  let fn = "";
  let org: string | null = null;
  let note: string | null = null;
  let kind: "person" | "group" = "person";
  for (const line of unfold(vcard)) {
    const parsed = parseLine(line);
    if (!parsed) {
      continue;
    }
    switch (parsed.name) {
      case "UID":
        uid = parsed.value;
        break;
      case "FN":
        fn = parsed.value;
        break;
      case "EMAIL":
        emails.push(parsed.value);
        break;
      case "TEL":
        phones.push(parsed.value);
        break;
      case "ORG":
        org = parsed.value;
        break;
      case "NOTE":
        note = parsed.value.replace(/\\n/gu, "\n");
        break;
      case "X-ADDRESSBOOKSERVER-KIND":
        if (parsed.value.toLowerCase() === "group") {
          kind = "group";
        }
        break;
      case "X-ADDRESSBOOKSERVER-MEMBER":
        members.push(parsed.value.replace(/^urn:uuid:/iu, ""));
        break;
      default:
        break;
    }
  }
  return {
    uid: uid || href || crypto.randomUUID(),
    href,
    etag,
    fn: fn || emails[0] || "(no name)",
    emails,
    phones,
    org,
    note,
    kind,
    members,
  };
}

export function buildVcard(input: {
  uid?: string;
  fn: string;
  emails?: string[];
  phones?: string[];
  org?: string;
  note?: string;
  kind?: "person" | "group";
  members?: string[];
}): { uid: string; vcard: string } {
  const uid = input.uid ?? crypto.randomUUID();
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `UID:${uid}`,
    `FN:${escapeVcard(input.fn)}`,
    `N:${escapeVcard(input.fn)};;;;`,
  ];
  for (const email of input.emails ?? []) {
    lines.push(`EMAIL;TYPE=INTERNET:${escapeVcard(email)}`);
  }
  for (const phone of input.phones ?? []) {
    lines.push(`TEL:${escapeVcard(phone)}`);
  }
  if (input.org) {
    lines.push(`ORG:${escapeVcard(input.org)}`);
  }
  if (input.note) {
    lines.push(`NOTE:${escapeVcard(input.note.replace(/\n/gu, "\\n"))}`);
  }
  if (input.kind === "group") {
    lines.push("X-ADDRESSBOOKSERVER-KIND:group");
    for (const member of input.members ?? []) {
      lines.push(`X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:${member}`);
    }
  }
  lines.push("END:VCARD");
  return { uid, vcard: `${lines.join("\r\n")}\r\n` };
}

function escapeVcard(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/,/gu, "\\,").replace(/;/gu, "\\;");
}

export function mergeVcard(
  existing: string,
  patch: Partial<{
    fn: string;
    emails: string[];
    phones: string[];
    org: string;
    note: string;
    members: string[];
  }>,
): string {
  const parsed = parseVcard(existing);
  return buildVcard({
    uid: parsed.uid,
    fn: patch.fn ?? parsed.fn,
    emails: patch.emails ?? parsed.emails,
    phones: patch.phones ?? parsed.phones,
    org: patch.org ?? parsed.org ?? undefined,
    note: patch.note ?? parsed.note ?? undefined,
    kind: parsed.kind,
    members: patch.members ?? parsed.members,
  }).vcard;
}
