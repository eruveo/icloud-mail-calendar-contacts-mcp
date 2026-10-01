import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CalendarService } from "../calendar/service.js";
import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  serviceEnabled,
  type IcloudConfig,
} from "../config.js";
import { ContactsService } from "../contacts/service.js";
import { DavClient } from "../dav/client.js";
import { createDavFetch, type DavFetch } from "../dav/http.js";
import type { IcloudApp } from "./app-types.js";
import { registerCalendarTools, registerContactTools } from "./dav-tools.js";

export interface DavAppDependencies {
  config: IcloudConfig;
  davFetch?: DavFetch;
  cardDavFetch?: DavFetch;
}

/** Calendar + Contacts only. Safe to import from Cloudflare Workers (no IMAP/SMTP). */
export function createDavApp(deps: DavAppDependencies): IcloudApp {
  const { config } = deps;
  const server = new McpServer({ name: PACKAGE_NAME, version: PACKAGE_VERSION });
  const app: IcloudApp = { server, config };

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
    registerCalendarTools(server, new CalendarService(config, dav), config);
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
    registerContactTools(server, new ContactsService(config, dav), config);
  }

  return app;
}
