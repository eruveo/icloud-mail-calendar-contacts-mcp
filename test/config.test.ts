import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAP_HOST,
  loadConfig,
  parsePermissions,
  parseServices,
} from "../src/config.js";
import { formatImapError, redactSecrets } from "../src/redact.js";

const creds = {
  ICLOUD_EMAIL: "dev@icloud.com",
  ICLOUD_APP_PASSWORD: "abcd-efgh-ijkl-mnop",
};

describe("config", () => {
  it("loads iCloud defaults with write permissions on and delete off", () => {
    const config = loadConfig(creds);
    expect(config.mail.host).toBe(DEFAULT_IMAP_HOST);
    expect(config.smtp.host).toBe("smtp.mail.me.com");
    expect(config.smtp.port).toBe(587);
    expect(config.allowFileAttachments).toBe(true);
    expect(config.permissions).toEqual({
      readOnly: false,
      allowSend: true,
      allowMailWrite: true,
      allowCalendarWrite: true,
      allowContactsWrite: true,
      allowDelete: false,
      allowExpunge: false,
    });
  });

  it("ICLOUD_READ_ONLY wins over allow flags", () => {
    const permissions = parsePermissions({
      ICLOUD_READ_ONLY: "true",
      ICLOUD_ALLOW_SEND: "true",
      ICLOUD_ALLOW_DELETE: "true",
    });
    expect(permissions.readOnly).toBe(true);
    expect(permissions.allowSend).toBe(false);
    expect(permissions.allowDelete).toBe(false);
  });

  it("rejects reminders as a service", () => {
    expect(() => parseServices("mail,reminders")).toThrow(/Reminders are not supported/);
  });
});

describe("redaction", () => {
  it("never leaves the app password in strings or errors", () => {
    const password = "super-secret-app-specific";
    expect(redactSecrets(`LOGIN user ${password}`, [password])).toBe("LOGIN user [redacted]");
    const error = formatImapError(new Error(`Authentication failed: ${password}`), [password]);
    expect(error.message).not.toContain(password);
    expect(error.message).toMatch(/app-specific password/);
  });
});
