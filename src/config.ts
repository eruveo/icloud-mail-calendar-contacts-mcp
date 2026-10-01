export const PACKAGE_NAME = "icloud-mail-calendar-contacts-mcp";
export const PACKAGE_VERSION = "0.1.0";

export const DEFAULT_IMAP_HOST = "imap.mail.me.com";
export const DEFAULT_IMAP_PORT = 993;
export const DEFAULT_SMTP_HOST = "smtp.mail.me.com";
export const DEFAULT_SMTP_PORT = 587;
export const DEFAULT_CALDAV_URL = "https://caldav.icloud.com";
export const DEFAULT_CARDDAV_URL = "https://contacts.icloud.com";
export const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;
export const DEFAULT_BODY_CHAR_LIMIT = 20_000;
export const MAX_BODY_CHAR_LIMIT = 80_000;
export const DEFAULT_EVENT_LIMIT = 100;
export const MAX_EVENT_LIMIT = 500;
export const DEFAULT_CONTACT_LIMIT = 50;
export const MAX_CONTACT_LIMIT = 200;
export const CONNECTION_TIMEOUT_MS = 20_000;
export const OPERATION_TIMEOUT_MS = 45_000;
export const DAV_TIMEOUT_MS = 30_000;

export const ALL_SERVICES = ["mail", "calendar", "contacts"] as const;
export type IcloudServiceName = (typeof ALL_SERVICES)[number];

export interface WritePermissions {
  /** Master switch. When true, every write capability is forced off. */
  readOnly: boolean;
  allowSend: boolean;
  allowMailWrite: boolean;
  allowCalendarWrite: boolean;
  allowContactsWrite: boolean;
  allowDelete: boolean;
  allowExpunge: boolean;
}

export interface IcloudConfig {
  email: string;
  appPassword: string;
  services: readonly IcloudServiceName[];
  timezone: string;
  mail: {
    host: string;
    port: number;
    secure: boolean;
  };
  smtp: {
    host: string;
    port: number;
  };
  caldavUrl: string;
  carddavUrl: string;
  attachmentRoot: string | null;
  allowFileAttachments: boolean;
  permissions: WritePermissions;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class PermissionDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDenied";
  }
}

export function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalised = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalised)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalised)) {
    return false;
  }
  throw new ConfigError(`Expected a boolean env value, got ${value}`);
}

export function parseServices(raw: string | undefined): IcloudServiceName[] {
  if (!raw || raw.trim() === "" || raw.trim() === "*") {
    return [...ALL_SERVICES];
  }
  const parts = raw
    .split(/[,\s]+/u)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const enabled: IcloudServiceName[] = [];
  for (const part of parts) {
    if (part === "reminders" || part === "tasks" || part === "vtodo") {
      throw new ConfigError(
        "Reminders are not supported. Apple moved modern Reminders lists off CalDAV/VTODO onto CloudKit, so app-specific-password clients cannot list or write them reliably. Enable mail, calendar, and/or contacts instead.",
      );
    }
    if (part === "mail" || part === "calendar" || part === "contacts") {
      if (!enabled.includes(part)) {
        enabled.push(part);
      }
      continue;
    }
    throw new ConfigError(
      `Unknown ICLOUD_SERVICES entry "${part}". Use a comma-separated list of: mail, calendar, contacts.`,
    );
  }
  if (enabled.length === 0) {
    throw new ConfigError("ICLOUD_SERVICES must include at least one of: mail, calendar, contacts.");
  }
  return enabled;
}

export function defaultWritePermissions(): WritePermissions {
  return {
    readOnly: false,
    allowSend: true,
    allowMailWrite: true,
    allowCalendarWrite: true,
    allowContactsWrite: true,
    allowDelete: false,
    allowExpunge: false,
  };
}

export function applyReadOnly(permissions: WritePermissions): WritePermissions {
  if (!permissions.readOnly) {
    return permissions;
  }
  return {
    readOnly: true,
    allowSend: false,
    allowMailWrite: false,
    allowCalendarWrite: false,
    allowContactsWrite: false,
    allowDelete: false,
    allowExpunge: false,
  };
}

export function parsePermissions(env: NodeJS.ProcessEnv): WritePermissions {
  const readOnly = parseBoolean(readEnv(env, "ICLOUD_READ_ONLY"), false);
  if (readOnly) {
    return {
      readOnly: true,
      allowSend: false,
      allowMailWrite: false,
      allowCalendarWrite: false,
      allowContactsWrite: false,
      allowDelete: false,
      allowExpunge: false,
    };
  }
  return {
    readOnly: false,
    allowSend: parseBoolean(readEnv(env, "ICLOUD_ALLOW_SEND"), true),
    allowMailWrite: parseBoolean(readEnv(env, "ICLOUD_ALLOW_MAIL_WRITE"), true),
    allowCalendarWrite: parseBoolean(readEnv(env, "ICLOUD_ALLOW_CALENDAR_WRITE"), true),
    allowContactsWrite: parseBoolean(readEnv(env, "ICLOUD_ALLOW_CONTACTS_WRITE"), true),
    allowDelete: parseBoolean(readEnv(env, "ICLOUD_ALLOW_DELETE"), false),
    allowExpunge: parseBoolean(readEnv(env, "ICLOUD_ALLOW_EXPUNGE"), false),
  };
}

export function serviceEnabled(config: IcloudConfig, name: IcloudServiceName): boolean {
  return config.services.includes(name);
}

export interface BuildConfigInput {
  email: string;
  appPassword: string;
  services?: readonly IcloudServiceName[];
  timezone?: string;
  permissions?: WritePermissions;
  allowFileAttachments?: boolean;
  env?: NodeJS.ProcessEnv;
}

export function parsePort(raw: string | undefined, fallback: number, name: string): number {
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new ConfigError(`${name} must be an integer between 1 and 65535.`);
  }
  return value;
}

export function buildConfig(input: BuildConfigInput): IcloudConfig {
  const env = input.env ?? {};
  return {
    email: input.email,
    appPassword: input.appPassword,
    services: input.services ?? parseServices(readEnv(env, "ICLOUD_SERVICES")),
    timezone: input.timezone ?? readEnv(env, "ICLOUD_TIMEZONE") ?? DEFAULT_TIMEZONE,
    mail: {
      host: readEnv(env, "IMAP_HOST") ?? DEFAULT_IMAP_HOST,
      port: parsePort(readEnv(env, "IMAP_PORT"), DEFAULT_IMAP_PORT, "IMAP_PORT"),
      secure: parseBoolean(readEnv(env, "IMAP_SECURE"), true),
    },
    smtp: {
      host: readEnv(env, "SMTP_HOST") ?? DEFAULT_SMTP_HOST,
      port: parsePort(readEnv(env, "SMTP_PORT"), DEFAULT_SMTP_PORT, "SMTP_PORT"),
    },
    caldavUrl: (readEnv(env, "ICLOUD_CALDAV_URL") ?? DEFAULT_CALDAV_URL).replace(/\/$/u, ""),
    carddavUrl: (readEnv(env, "ICLOUD_CARDDAV_URL") ?? DEFAULT_CARDDAV_URL).replace(/\/$/u, ""),
    attachmentRoot: readEnv(env, "ICLOUD_ATTACHMENT_ROOT") ?? null,
    allowFileAttachments: input.allowFileAttachments ?? true,
    permissions: applyReadOnly(input.permissions ?? parsePermissions(env)),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): IcloudConfig {
  const email = readEnv(env, "ICLOUD_EMAIL") ?? readEnv(env, "ICLOUD_USERNAME");
  const appPassword = readEnv(env, "ICLOUD_APP_PASSWORD");
  if (!email) {
    throw new ConfigError(
      "Missing ICLOUD_EMAIL (or ICLOUD_USERNAME). Set it to the full iCloud address, for example you@icloud.com.",
    );
  }
  if (!appPassword) {
    throw new ConfigError(
      "Missing ICLOUD_APP_PASSWORD. Create an app-specific password at https://account.apple.com — do not use your Apple ID password.",
    );
  }
  return buildConfig({ email, appPassword, env });
}

export function secretsFromConfig(config: IcloudConfig): string[] {
  return [config.appPassword];
}

export function mailAccountFromConfig(config: IcloudConfig): MailAccount {
  return {
    email: config.email,
    appPassword: config.appPassword,
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
  };
}

export interface MailAccount {
  email: string;
  appPassword: string;
  host: string;
  port: number;
  secure: boolean;
}

export function assertAllowed(
  permissions: WritePermissions,
  capability: keyof Omit<WritePermissions, "readOnly">,
  action: string,
): void {
  if (permissions.readOnly || !permissions[capability]) {
    const flag = envFlagFor(capability);
    throw new PermissionDenied(
      `Refusing to ${action}. ${
        permissions.readOnly
          ? "ICLOUD_READ_ONLY is set, so every write is disabled."
          : `Enable ${flag}=true (and do not set ICLOUD_READ_ONLY) to allow this.`
      }`,
    );
  }
}

function envFlagFor(capability: keyof Omit<WritePermissions, "readOnly">): string {
  switch (capability) {
    case "allowSend":
      return "ICLOUD_ALLOW_SEND";
    case "allowMailWrite":
      return "ICLOUD_ALLOW_MAIL_WRITE";
    case "allowCalendarWrite":
      return "ICLOUD_ALLOW_CALENDAR_WRITE";
    case "allowContactsWrite":
      return "ICLOUD_ALLOW_CONTACTS_WRITE";
    case "allowDelete":
      return "ICLOUD_ALLOW_DELETE";
    case "allowExpunge":
      return "ICLOUD_ALLOW_EXPUNGE";
  }
}
