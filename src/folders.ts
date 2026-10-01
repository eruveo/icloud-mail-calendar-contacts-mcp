/**
 * iCloud IMAP folder naming is closer to Apple Mail than Gmail:
 * INBOX, Sent Messages, Deleted Messages, Junk, Drafts, Archive, Notes.
 */
const ALIASES: Record<string, string[]> = {
  inbox: ["INBOX"],
  sent: ["Sent Messages", "Sent", "Sent Items"],
  trash: ["Deleted Messages", "Trash", "Bin"],
  deleted: ["Deleted Messages", "Trash"],
  junk: ["Junk", "Junk E-mail", "Spam"],
  spam: ["Junk", "Spam"],
  drafts: ["Drafts", "Draft"],
  archive: ["Archive", "Archived"],
  notes: ["Notes"],
};

export function lastPathSegment(path: string, delimiter = "/"): string {
  const parts = path.split(delimiter || "/").filter(Boolean);
  return parts.at(-1) ?? path;
}

export function resolveMailboxPath(
  requested: string | undefined,
  available: readonly string[],
): string {
  const name = (requested ?? "INBOX").trim();
  if (name.length === 0) {
    return "INBOX";
  }
  const exact = available.find((path) => path === name);
  if (exact) {
    return exact;
  }
  const caseInsensitive = available.find(
    (path) => path.toLowerCase() === name.toLowerCase(),
  );
  if (caseInsensitive) {
    return caseInsensitive;
  }
  const bySegment = available.find(
    (path) => lastPathSegment(path).toLowerCase() === name.toLowerCase(),
  );
  if (bySegment) {
    return bySegment;
  }
  const aliases = ALIASES[name.toLowerCase()] ?? [];
  for (const alias of aliases) {
    const match = available.find(
      (path) =>
        path.toLowerCase() === alias.toLowerCase() ||
        lastPathSegment(path).toLowerCase() === alias.toLowerCase(),
    );
    if (match) {
      return match;
    }
  }
  return name;
}
