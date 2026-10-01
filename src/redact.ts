const REDACTED = "[redacted]";

export function redactSecrets(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    result = result.split(secret).join(REDACTED);
  }
  return result;
}

export function redactError(error: unknown, secrets: readonly string[]): Error {
  if (error instanceof Error) {
    const copy = new Error(redactSecrets(error.message, secrets));
    copy.name = error.name;
    if (typeof error.stack === "string") {
      copy.stack = redactSecrets(error.stack, secrets);
    }
    return copy;
  }
  return new Error(redactSecrets(String(error), secrets));
}

export function formatImapError(error: unknown, secrets: readonly string[]): Error {
  const redacted = redactError(error, secrets);
  const lower = redacted.message.toLowerCase();
  if (
    lower.includes("auth") ||
    lower.includes("login") ||
    lower.includes("invalid credentials") ||
    lower.includes("authentication failed")
  ) {
    return new Error(
      "iCloud authentication failed. Use an Apple app-specific password from https://account.apple.com (Sign-In and Security → App-Specific Passwords), not your regular Apple ID password. Confirm iCloud Mail/Calendar/Contacts are enabled and ICLOUD_EMAIL is the full address.",
    );
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return new Error(
      `Connection timed out (${redacted.message}). Check network access to imap.mail.me.com:993 / smtp.mail.me.com:587 / caldav.icloud.com.`,
    );
  }
  if (lower.includes("enotfound") || lower.includes("econnrefused")) {
    return new Error(
      `Could not reach Apple's servers (${redacted.message}). Check IMAP_HOST, SMTP_HOST, or ICLOUD_CALDAV_URL.`,
    );
  }
  return redacted;
}
