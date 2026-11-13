---
name: icloud-setup
description: Install, configure, lock down, or troubleshoot the icloud-mail-calendar-contacts-mcp server, which gives an agent iCloud Mail, Calendar, and Contacts. Use when the user wants to connect their iCloud or Apple email, calendar, or contacts to an agent, when the iCloud tools are missing, or when they fail with authentication, permission, or connection errors.
license: MIT
metadata:
  mcp-server: icloud-mail-calendar-contacts-mcp
  repository: https://github.com/eruveo/icloud-mail-calendar-contacts-mcp
---

# Set up the iCloud MCP server

The server runs locally over stdio. It signs in to Apple with an **app-specific password**, never the Apple Account password. Credentials go to Apple's IMAP/SMTP, CalDAV, and CardDAV servers and nowhere else.

## Never handle the password in chat

Don't ask the user to paste the app-specific password into the conversation, and don't write it into a file in a git repository. Have them set it themselves:

- in their shell profile or a secret manager, as `ICLOUD_APP_PASSWORD`;
- in the client's own MCP config file, which they edit;
- or through a secure secret prompt, if the client offers one.

If the user pastes it anyway, use it only for the config they asked for, and suggest generating a new one afterwards.

## 1. Get an app-specific password (the user does this)

1. Turn on two-factor authentication for the Apple Account. Apple requires it for app-specific passwords.
2. Go to account.apple.com, then **Sign-In and Security**, then **App-Specific Passwords**, and generate one labelled for this agent.
3. Note the **full** iCloud address (`name@icloud.com`, `@me.com`, or `@mac.com`). A custom-domain alias won't sign in.
4. Make sure iCloud Mail, Calendar, and Contacts are turned on for the account.

Revoking that password at account.apple.com cuts off access immediately.

## 2. Pick a permission preset

Ask what the agent may do, then set the matching environment variables:

| Preset | Variables | Good for |
| --- | --- | --- |
| Read-only | `ICLOUD_READ_ONLY=true` | Trying it out, summaries, search |
| Assistant (server default) | none | Sending mail, drafts, filing, events, contacts. Delete stays off. |
| No sending | `ICLOUD_ALLOW_SEND=false` | Drafts only: the agent writes and the user sends |
| Full | `ICLOUD_ALLOW_DELETE=true` | Trash, plus event and contact deletion. Add `ICLOUD_ALLOW_EXPUNGE=true` only if permanent mail deletion is truly needed. |

Other variables: `ICLOUD_TIMEZONE` (IANA zone, default `UTC`; always set it), `ICLOUD_SERVICES` (subset of `mail,calendar,contacts`), and `ICLOUD_ATTACHMENT_ROOT` (the only directory `send_email` may attach files from).

## 3. Install

Node.js 20 or newer is required (`node --version`).

**Claude Code plugin** (bundles the server and these skills):

```bash
claude plugin marketplace add eruveo/icloud-mail-calendar-contacts-mcp
claude plugin install icloud@icloud-mcp
```

Claude Code asks for the iCloud address, the app-specific password, the time zone, and three switches: read-only, allow sending, and allow delete. It keeps the password in its secure storage. To change any of them later, the user runs `/plugin configure icloud@icloud-mcp` and restarts. The first start downloads and builds the server, which can take a minute.

**Any other MCP client** (Cursor, Claude Desktop, VS Code, Windsurf, Codex, and others): add a stdio server. The `command`/`args` pair is the same everywhere. Only the config file differs.

```json
{
  "mcpServers": {
    "icloud": {
      "command": "npx",
      "args": ["-y", "github:eruveo/icloud-mail-calendar-contacts-mcp"],
      "env": {
        "ICLOUD_EMAIL": "name@icloud.com",
        "ICLOUD_APP_PASSWORD": "xxxx-xxxx-xxxx-xxxx",
        "ICLOUD_TIMEZONE": "Europe/London"
      }
    }
  }
}
```

The user fills in the real values themselves. To run from a clone instead: `git clone`, `npm ci`, `npm run build`, then use `"command": "node"` with `"args": ["/absolute/path/dist/index.js"]`.

For a hosted, multi-user setup over Streamable HTTP, follow `docs/setup-hosted.md` in the repository.

## 4. Verify

After the client restarts, call `list_mailboxes`, then `list_events` for today, then `list_contacts` with `limit: 1`. Check that the tool list matches the chosen preset. For example, with Read-only there should be no `send_email`.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No iCloud tools at all | Server not started, wrong path, or Node older than 20 | Check the client's MCP logs. Run the command by hand to see the error. |
| `Missing ICLOUD_EMAIL` or a similar config error at start | Variables not passed to the server | Put them in the server's `env` block, or export them before starting the client |
| IMAP `AUTHENTICATIONFAILED` or DAV `HTTP 401` | Apple Account password used, short username, typo, or revoked password | Generate a new app-specific password and use the full address |
| Mail works but Calendar or Contacts fails | `ICLOUD_SERVICES` excludes it, or that service is off in iCloud settings | Check both |
| A write tool is missing | Expected: the preset disables it | Change the variables and restart the client |
| `File attachments are only available in local stdio mode` | Hosted mode | Expected. Attach nothing, or run locally. |
| Calendar shows no to-dos | Reminders live in CloudKit | Not supported |
| Mail tools missing on Cloudflare Workers | Workers can't open raw IMAP/SMTP sockets | Host on Node, Docker, or Vercel for mail |

Never print `ICLOUD_APP_PASSWORD` while debugging. The server redacts it from its own output. Do the same.
