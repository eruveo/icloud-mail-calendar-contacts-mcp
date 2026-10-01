#!/usr/bin/env node
import { isCliCommand, runAdminCommand } from "./hosted/cli.js";
import { startHostedNodeServer } from "./hosted/serve.js";
import { startStdioServer } from "./server.js";

function usage(): string {
  return `icloud-mail-calendar-contacts-mcp

Local stdio (option 1):
  ICLOUD_EMAIL=... ICLOUD_APP_PASSWORD=... icloud-mail-calendar-contacts-mcp

Hosted HTTP (option 2):
  icloud-mail-calendar-contacts-mcp serve
  icloud-mail-calendar-contacts-mcp add-user --email you@icloud.com --app-password xxxx-xxxx-xxxx-xxxx
  icloud-mail-calendar-contacts-mcp list-users
  icloud-mail-calendar-contacts-mcp rotate-token --id you
  icloud-mail-calendar-contacts-mcp revoke-user --id you
`;
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command === "-h" || command === "--help") {
    process.stdout.write(usage());
    return;
  }
  if (command === "serve") {
    await startHostedNodeServer();
    return;
  }
  if (isCliCommand(command)) {
    await runAdminCommand(argv);
    return;
  }
  if (command) {
    throw new Error(usage());
  }
  await startStdioServer();
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
