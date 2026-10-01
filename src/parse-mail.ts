import { convert } from "html-to-text";
import PostalMime from "postal-mime";

export interface AddressField {
  name?: string;
  address?: string;
}

export interface ParsedAttachment {
  filename: string;
  size: number;
  contentType: string;
}

export interface ParsedMessage {
  text: string;
  html: string | null;
  attachments: ParsedAttachment[];
}

function formatAddress(entry: AddressField | undefined): string {
  if (!entry) {
    return "";
  }
  if (entry.name && entry.address) {
    return `${entry.name} <${entry.address}>`;
  }
  return entry.address ?? entry.name ?? "";
}

export function formatAddressList(
  list: AddressField[] | AddressField | undefined,
): string {
  if (!list) {
    return "";
  }
  const entries = Array.isArray(list) ? list : [list];
  return entries.map(formatAddress).filter(Boolean).join(", ");
}

export function htmlToReadableText(html: string): string {
  return convert(html, {
    wordwrap: 88,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      {
        selector: "a",
        options: { hideLinkHrefIfSameAsText: true, noAnchorUrl: true },
      },
    ],
  }).trim();
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function snippetFromText(text: string, maxLength = 240): string {
  const collapsed = collapseWhitespace(text);
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function truncateBody(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars).trimEnd()}\n\n[truncated: body was ${text.length} characters, showing first ${maxChars}]`,
    truncated: true,
  };
}

function attachmentSize(content: unknown): number {
  if (content instanceof ArrayBuffer) {
    return content.byteLength;
  }
  if (ArrayBuffer.isView(content)) {
    return content.byteLength;
  }
  if (typeof content === "string") {
    return Buffer.byteLength(content);
  }
  return 0;
}

export async function parseRfc822(source: Buffer | Uint8Array | string): Promise<ParsedMessage> {
  const parser = new PostalMime();
  const mail = await parser.parse(source);
  const html = mail.html?.trim() ? mail.html : null;
  const plain = mail.text?.trim() ? mail.text.trim() : "";
  const text = plain || (html ? htmlToReadableText(html) : "");
  const attachments: ParsedAttachment[] = (mail.attachments ?? []).map((part) => ({
    filename: part.filename?.trim() || "unnamed",
    size: attachmentSize(part.content),
    contentType: part.mimeType || "application/octet-stream",
  }));
  return { text, html, attachments };
}
