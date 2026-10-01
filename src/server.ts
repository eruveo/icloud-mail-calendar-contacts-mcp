import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CalendarService } from "./calendar/service.js";
import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  loadConfig,
  mailAccountFromConfig,
  serviceEnabled,
  type IcloudConfig,
} from "./config.js";
import { ContactsService } from "./contacts/service.js";
import { DavClient } from "./dav/client.js";
import { createDavFetch, type DavFetch } from "./dav/http.js";
import { ImapSession } from "./imap-session.js";
import { IcloudMailService } from "./mail-service.js";
import type { IcloudApp } from "./mcp/app-types.js";
import { registerCalendarTools, registerContactTools } from "./mcp/dav-tools.js";
import { registerMailTools } from "./mcp/mail-tools.js";
import { SmtpMailer, type MailSender } from "./smtp.js";
import type { ImapConnectionFactory } from "./types.js";

export type { IcloudApp } from "./mcp/app-types.js";

export interface AppDependencies {
  env?: NodeJS.ProcessEnv;
  config?: IcloudConfig;
  imapFactory?: ImapConnectionFactory;
  davFetch?: DavFetch;
  cardDavFetch?: DavFetch;
  mailSender?: MailSender;
  /** When false, skip IMAP/SMTP even if mail is in ICLOUD_SERVICES (Workers). */
  mailSupported?: boolean;
}

export interface FullIcloudApp extends IcloudApp {
  mail?: IcloudMailService;
  smtp?: SmtpMailer;
  calendar?: CalendarService;
  contacts?: ContactsService;
}

export function createApp(deps: AppDependencies = {}): FullIcloudApp {
  const config = deps.config ?? loadConfig(deps.env ?? process.env);
  const mailSupported = deps.mailSupported ?? true;
  const server = new McpServer({ name: PACKAGE_NAME, version: PACKAGE_VERSION });
  const app: FullIcloudApp = { server, config };

  if (mailSupported && serviceEnabled(config, "mail")) {
    const policy =
      config.permissions.readOnly ||
      (!config.permissions.allowMailWrite &&
        !config.permissions.allowDelete &&
        !config.permissions.allowExpunge)
        ? "read-only"
        : "read-write";
    const session = new ImapSession(mailAccountFromConfig(config), deps.imapFactory, policy);
    const mail = new IcloudMailService(session, config.permissions);
    const smtp = new SmtpMailer(config, deps.mailSender);
    app.session = session;
    app.mail = mail;
    app.smtp = smtp;
    registerMailTools(server, mail, smtp, config);
  }

  if (serviceEnabled(config, "calendar")) {
    const dav = new DavClient(
      deps.davFetch ??
        createDavFetch({
          username: config.email,
          password: config.appPassword,
          timeoutMs: 30_000,
          userAgent: `${PACKAGE_NAME}/${PACKAGE_VERSION}`,
        }),
      config.caldavUrl,
    );
    const calendar = new CalendarService(config, dav);
    app.calendar = calendar;
    registerCalendarTools(server, calendar, config);
  }

  if (serviceEnabled(config, "contacts")) {
    const dav = new DavClient(
      deps.cardDavFetch ??
        deps.davFetch ??
        createDavFetch({
          username: config.email,
          password: config.appPassword,
          timeoutMs: 30_000,
          userAgent: `${PACKAGE_NAME}/${PACKAGE_VERSION}`,
        }),
      config.carddavUrl,
    );
    const contacts = new ContactsService(config, dav);
    app.contacts = contacts;
    registerContactTools(server, contacts, config);
  }

  return app;
}

export async function startStdioServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { server, session } = createApp({ env });
  const transport = new StdioServerTransport();
  const shutdown = async () => {
    await session?.close();
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  await server.connect(transport);
}
