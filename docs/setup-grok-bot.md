# Run it in Grok Bot

Grok Bot is a desktop AI assistant whose bots share one always-on Linux cloud computer, called **the box**. You can run this MCP server on your own box as a Local (stdio) connector. Every one of your bots then gets iCloud Mail, Calendar, and Contacts tools.

> This project is not affiliated with, endorsed by, or supported by Apple or Grok Bot.

## What you get

- **Mail, Calendar, and Contacts tools** (the full list is in the [README](../README.md#tools)) in every Grok Bot bot you have, because they all share the same box.
- **No hosting and no extra cost.** The server runs on the box you already have as a plain `node` process. There's no web endpoint, no tokens, and no third-party service in between.
- **Your Apple password stays on your box.** The app-specific password is kept as a secret on the box and passed to the server as an environment variable. It goes only to Apple's own servers (IMAP/SMTP, CalDAV, CardDAV). The server never logs it or returns it in tool results.

## Before you start: an Apple app-specific password

1. Your Apple Account must have **two-factor authentication** turned on. Apple won't create app-specific passwords without it.
2. Go to [account.apple.com](https://account.apple.com) (formerly appleid.apple.com) → **Sign-In and Security** → **App-Specific Passwords**, and generate a new one. A label like `grok-bot-icloud` makes it easy to find later.
3. Copy the `xxxx-xxxx-xxxx-xxxx` password. Use this one, **not** your regular Apple Account password.
4. Note your **primary iCloud Mail address** (`you@icloud.com` or `you@me.com`). That address goes in `ICLOUD_EMAIL`.
5. Make sure iCloud Mail, Calendar, and Contacts are turned on for the account.

Revoking that app-specific password at account.apple.com cuts off access right away, whatever happens on the box.

## Easiest path: ask your bot to install it

Paste this into a Grok Bot chat. Fill in your address and your [IANA time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) (for example `Europe/London` or `America/New_York`) first:

```text
Install the iCloud MCP from github.com/eruveo/icloud-mail-calendar-contacts-mcp on your
computer as a local connector named icloud.

1. Clone it to /home/box/mcp/icloud-mail-calendar-contacts-mcp, then run npm ci and
   npm run build there (Node 20 or newer).
2. Ask me for my Apple app-specific password with a secure secret request, saved as
   ICLOUD_APP_PASSWORD. Never ask me to paste it in chat.
3. Add a stdio connector named icloud that runs
   node /home/box/mcp/icloud-mail-calendar-contacts-mcp/dist/index.js
   with these environment variables:
     ICLOUD_EMAIL=<your iCloud address>
     ICLOUD_APP_PASSWORD=<from the ICLOUD_APP_PASSWORD secret>
     ICLOUD_SERVICES=mail,calendar,contacts
     ICLOUD_TIMEZONE=<your IANA time zone>
     ICLOUD_ALLOW_DELETE=false
     ICLOUD_ALLOW_EXPUNGE=false
4. Test it by listing my mailboxes and today's calendar events.
5. Set connector instructions: always show me a draft before sending any email, and never
   move, mark, or delete mail unless I ask.
```

When the bot gets to the password, it shows a **secure, masked input** in the app instead of asking in chat. Paste the app-specific password there. The bot saves it as a secret on your box and passes it to the connector, so the password never appears in the conversation.

When the bot is done, try asking things like "what's on my calendar tomorrow?" or "find the last email from my landlord" from any of your bots.

## What the bot does (manual steps)

If you'd rather do it yourself, or want to check what the bot did, these are the steps.

### 1. Clone and build

The box needs **Node.js 20 or newer** (`node --version`).

```bash
mkdir -p /home/box/mcp
git clone https://github.com/eruveo/icloud-mail-calendar-contacts-mcp.git /home/box/mcp/icloud-mail-calendar-contacts-mcp
cd /home/box/mcp/icloud-mail-calendar-contacts-mcp
npm ci
npm run build
```

The build produces `dist/index.js`. With no arguments it runs in **Local mode** (stdio), which is the mode you want here. (The `serve` subcommand and the Cloud options in [setup-hosted.md](setup-hosted.md) aren't needed for Grok Bot.)

### 2. Environment variables

The server reads its settings from environment variables only. Local mode has no CLI flags.

Required:

| Variable | Meaning |
| --- | --- |
| `ICLOUD_EMAIL` (or `ICLOUD_USERNAME`) | Your full iCloud address, for example `you@icloud.com` |
| `ICLOUD_APP_PASSWORD` | The app-specific password. The server reads exactly this name. |

Recommended:

| Variable | Default | Suggested | Meaning |
| --- | --- | --- | --- |
| `ICLOUD_SERVICES` | `mail,calendar,contacts` | `mail,calendar,contacts` | Comma-separated subset of `mail`, `calendar`, `contacts` |
| `ICLOUD_TIMEZONE` | `UTC` | your IANA zone | Time zone for showing and creating calendar events |
| `ICLOUD_ALLOW_DELETE` | `false` | `false` | `trash_message`, `delete_event`, `delete_contact` |
| `ICLOUD_ALLOW_EXPUNGE` | `false` | `false` | `expunge_message` (permanent mail deletion) |

The other write switches (`ICLOUD_READ_ONLY`, `ICLOUD_ALLOW_SEND`, `ICLOUD_ALLOW_MAIL_WRITE`, `ICLOUD_ALLOW_CALENDAR_WRITE`, `ICLOUD_ALLOW_CONTACTS_WRITE`) are covered in [Safety](#safety-recommendations) below. Boolean values accept `true`/`false`, `1`/`0`, `yes`/`no`, or `on`/`off`. The full list of variables is in [setup-local.md](setup-local.md#3-environment).

**About the password:** keep it as a box secret named `ICLOUD_APP_PASSWORD` and have the connector pass it through as the `ICLOUD_APP_PASSWORD` environment variable. Don't type it into a config file, a script, or the chat. If `ICLOUD_EMAIL` or `ICLOUD_APP_PASSWORD` is missing, the server exits at startup with a message naming the missing variable.

### 3. The stdio connector

Add a Local stdio connector (named `icloud`, for example) in Grok Bot with:

- **Command:** `node`
- **Arguments:** `/home/box/mcp/icloud-mail-calendar-contacts-mcp/dist/index.js`
- **Environment:** the variables above, with `ICLOUD_APP_PASSWORD` coming from the box secret

To check the server by hand first, from the clone (with `ICLOUD_APP_PASSWORD` already in your shell from the box secret):

```bash
ICLOUD_EMAIL=you@icloud.com node dist/index.js
```

It waits silently for MCP messages on stdin. Press Ctrl+C to stop it. If it exits right away, the error message tells you why.

## Safety recommendations

The bot can call every tool the server exposes, so decide up front what it should be able to do. Out of the box the server can **read**, **send mail**, change flags/folders/drafts, and **create or update** events and contacts. It **can't delete** anything unless you opt in.

- **Keep delete and expunge off.** `ICLOUD_ALLOW_DELETE=false` and `ICLOUD_ALLOW_EXPUNGE=false` are the defaults. Setting them explicitly makes your intent obvious. When a switch is off, the server doesn't offer the matching tools to the bot at all.
- **Decide about sending.** You have two reasonable options:
  - Turn sending off with `ICLOUD_ALLOW_SEND=false`. The `send_email` tool goes away, but the bot can still read mail and save drafts (`save_draft`, which needs `ICLOUD_ALLOW_MAIL_WRITE`) for you to send yourself.
  - Keep sending on, but add connector instructions telling the bot to **always show you a draft and wait for your OK** before calling `send_email`. Note that the server doesn't enforce this; it relies on the bot following the instructions.
- **Read-only mode.** `ICLOUD_READ_ONLY=true` is a master switch. It turns off every write, including send, mail changes, calendar, contacts, delete, and expunge, and removes the write tools entirely. It overrides every other switch.
- **Narrower writes.** `ICLOUD_ALLOW_MAIL_WRITE=false` stops flags, moves, new mailboxes, and drafts. `ICLOUD_ALLOW_CALENDAR_WRITE=false` and `ICLOUD_ALLOW_CONTACTS_WRITE=false` do the same for calendar and contacts writes.
- **Calendar invites are real.** When the bot creates an event with attendees, iCloud sends real invitations to those people. Ask the bot to confirm attendees before it creates or updates an event.
- **Limit services.** If you only want calendar and contacts, set `ICLOUD_SERVICES=calendar,contacts` and the mail tools won't be loaded.
- Write tools are marked with `[WRITE]` at the start of their descriptions, and reading mail never marks it as read.

See [SECURITY.md](../SECURITY.md) for the full security model.

## Updating

```bash
cd /home/box/mcp/icloud-mail-calendar-contacts-mcp
git pull
npm ci
npm run build
```

Then restart the connector so it loads the new build. You can also just ask your bot: "Update the icloud connector (git pull, npm ci, npm run build) and restart its MCP server."

## Troubleshooting

**"iCloud authentication failed" / "iCloud DAV authentication failed"**

- Check that `ICLOUD_EMAIL` is your **full** primary iCloud address, not a phone number or a third-party email you use to sign in.
- Make sure you used an **app-specific password**, not your regular Apple Account password.
- App-specific passwords stop working if you revoke them, and Apple also revokes all of them when you change your main Apple Account password. Generate a new one at account.apple.com, then ask the bot to update the `ICLOUD_APP_PASSWORD` secret (through the secure input again) and restart the connector.
- Check that iCloud Mail, Calendar, and Contacts are enabled for the account.

**The server exits at startup**

- `Missing ICLOUD_EMAIL` / `Missing ICLOUD_APP_PASSWORD`: the connector isn't passing that variable. Check the connector's environment and that the secret exists.
- `Unknown ICLOUD_SERVICES entry`: only `mail`, `calendar`, and `contacts` are valid. Reminders aren't supported.
- `Expected a boolean env value`: one of the `ICLOUD_ALLOW_*` / `ICLOUD_READ_ONLY` values is misspelled.

**Timeouts or connection errors**

- The box must be able to reach `imap.mail.me.com:993`, `smtp.mail.me.com:587`, `caldav.icloud.com`, and `contacts.icloud.com`.
- In stdio mode the server keeps a single IMAP connection, runs mail commands one at a time, and reconnects after an error. It does **not** retry failed requests automatically.

**Rate limits**

Apple doesn't publish limits for IMAP, CalDAV, or CardDAV, and this server has no rate limiting or backoff of its own in stdio mode. If you get repeated connection failures, timeouts, or `… failed (HTTP 4xx/5xx)` errors after heavy use (for example, a bot looping over hundreds of messages), wait a few minutes. Then ask for smaller batches; most list and search tools take a `limit`.

**Tools don't show up in a bot**

Make sure the connector is enabled and has been restarted since the last build, and that `dist/index.js` exists. Run `npm run build` again if it doesn't.
