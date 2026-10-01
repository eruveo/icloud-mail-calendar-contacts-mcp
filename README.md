# icloud-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) stdio server for an iCloud account. It talks to Apple over the same **app-specific password** APIs that Mail.app / Calendar.app use — IMAP + SMTP for mail, CalDAV for calendar, CardDAV for contacts — so you do not have to drive icloud.com in a browser (and fight 2FA / sign-outs).

There is no official Apple MCP. This one is small, MIT-licensed, and intended to be published as open source.

## What it can do

| Service | Protocol | Reads | Writes |
| --- | --- | --- | --- |
| Mail | IMAP `imap.mail.me.com:993` + SMTP `smtp.mail.me.com:587` STARTTLS | List folders, search, fetch bodies (never implicitly marked seen) | Send, reply/forward threading, drafts, flags, move, create folders, trash |
| Calendar | CalDAV `https://caldav.icloud.com` (discovers your `pNN` shard + calendar-home) | List calendars, list/get events with timezones and expanded recurrences, list invitations | Create calendars, create/update events, attendees (iCloud sends the invites), RSVP |
| Contacts | CardDAV `https://contacts.icloud.com` | Search/list/get, list groups | Create/update contacts and groups |

**Delete** (mail → Trash, calendar DELETE, contact DELETE) is off unless you set `ICLOUD_ALLOW_DELETE=true`. **Permanent IMAP expunge** is a separate opt-in (`ICLOUD_ALLOW_EXPUNGE`).

## What it cannot do

These iCloud products have **no app-specific-password API** suitable for a third-party MCP:

- **Photos** — CloudKit / private web APIs, not IMAP/DAV.
- **iCloud Drive** — CloudKit / Finder sync, not WebDAV in any supported way for app passwords.
- **Notes** — not exposed as IMAP or CalDAV for modern notes.
- **Passwords / iCloud Keychain** — end-to-end encrypted; Apple does not give app-specific passwords a decryption key.

### Reminders

**Not implemented.** Since iOS 13 / macOS 10.15, Apple moved Reminders onto CloudKit. Legacy lists sometimes still appear as CalDAV `VTODO` collections, but **modern Reminders lists are not a reliable VTODO surface**. Discovery often fails (`current-user-principal` / empty home). This server refuses `ICLOUD_SERVICES=reminders` rather than pretend.

## Safety / permission model

Writes are real. Defaults are meant for a personal assistant that should send mail and create events, but not destroy data:

| Variable | Default | Effect |
| --- | --- | --- |
| `ICLOUD_READ_ONLY` | `false` | Master switch. `true` disables **every** write and omits write tools from `tools/list`. |
| `ICLOUD_ALLOW_SEND` | `true` | SMTP `send_email`. |
| `ICLOUD_ALLOW_MAIL_WRITE` | `true` | Flags, move, create mailbox, save draft. |
| `ICLOUD_ALLOW_CALENDAR_WRITE` | `true` | Create/update events and calendars, RSVP. |
| `ICLOUD_ALLOW_CONTACTS_WRITE` | `true` | Create/update contacts and groups. |
| `ICLOUD_ALLOW_DELETE` | **`false`** | `trash_message`, `delete_event`, `delete_contact`. |
| `ICLOUD_ALLOW_EXPUNGE` | **`false`** | `expunge_message` (permanent). Prefer Trash. |

`ICLOUD_READ_ONLY=true` wins over every `ICLOUD_ALLOW_*` flag.

Every write tool description starts with **`[WRITE]`**.

IMAP **reads** still open mailboxes with `EXAMINE` and fetch `BODY.PEEK`, so searching mail does not flip `\Seen`. Flag changes are explicit `mark_message` calls.

Optional `ICLOUD_ATTACHMENT_ROOT` confines `send_email` attachment paths to that directory.

## Apple app-specific password

1. Enable two-factor authentication on your Apple Account.
2. Open [https://account.apple.com](https://account.apple.com) → **Sign-In and Security** → **App-Specific Passwords** → generate one (label it `icloud-mcp`).
3. Use the **full iCloud address** as the username (`you@icloud.com`, `@me.com`, or `@mac.com`).
4. Use the generated `xxxx-xxxx-xxxx-xxxx` password — **not** your Apple ID password.
5. Confirm iCloud Mail, Calendar, and Contacts are turned on for the account.

Revoking the app-specific password at account.apple.com is the kill switch.

## Configuration (env only)

Required:

- `ICLOUD_EMAIL` or `ICLOUD_USERNAME`
- `ICLOUD_APP_PASSWORD`

Optional:

- `ICLOUD_SERVICES` — `mail,calendar,contacts` (default all). Comma-separated.
- `ICLOUD_TIMEZONE` — IANA zone for calendar display/create (default `UTC`).
- `IMAP_HOST` / `IMAP_PORT` / `IMAP_SECURE` — IMAP overrides (tests).
- `SMTP_HOST` / `SMTP_PORT` — SMTP overrides (default `smtp.mail.me.com:587`).
- `ICLOUD_CALDAV_URL` / `ICLOUD_CARDDAV_URL` — DAV roots (do not hard-code a `pNN` shard).
- `ICLOUD_ATTACHMENT_ROOT` — sandbox for attachment file paths.

The process **never logs or returns the app-specific password**. Auth failures tell you to check the app-specific password without echoing it.

## Run as a stdio MCP server

Node 20+. After `npm install && npm run build`:

```bash
export ICLOUD_EMAIL=you@icloud.com
export ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
node dist/index.js
```

Same binary via npx once published (`npx -y icloud-mcp`) or a local path.

No CLI arguments. Credentials and toggles are **environment variables only**.

### Cursor (`mcp.json`)

```json
{
  "mcpServers": {
    "icloud": {
      "command": "node",
      "args": ["/absolute/path/to/icloud-mcp/dist/index.js"],
      "env": {
        "ICLOUD_EMAIL": "you@icloud.com",
        "ICLOUD_APP_PASSWORD": "xxxx-xxxx-xxxx-xxxx",
        "ICLOUD_TIMEZONE": "Australia/Sydney",
        "ICLOUD_ALLOW_DELETE": "false"
      }
    }
  }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "icloud": {
      "command": "npx",
      "args": ["-y", "icloud-mcp"],
      "env": {
        "ICLOUD_EMAIL": "you@icloud.com",
        "ICLOUD_APP_PASSWORD": "xxxx-xxxx-xxxx-xxxx"
      }
    }
  }
}
```

Lock it down:

```json
"env": {
  "ICLOUD_EMAIL": "you@icloud.com",
  "ICLOUD_APP_PASSWORD": "xxxx-xxxx-xxxx-xxxx",
  "ICLOUD_READ_ONLY": "true"
}
```

## Tools (names)

Mail: `list_mailboxes`, `search_messages`, `list_recent_messages`, `get_message`, `send_email`, `mark_message`, `move_message`, `create_mailbox`, `save_draft`, `trash_message`, `expunge_message`.

Calendar: `list_calendars`, `list_events`, `get_event`, `list_invitations`, `create_calendar`, `create_event`, `update_event`, `respond_to_invitation`, `delete_event`.

Contacts: `list_contacts`, `list_contact_groups`, `get_contact`, `create_contact`, `update_contact`, `create_contact_group`, `delete_contact`.

`send_email` threading: pass `replyToMessageId` (and `references`) from `get_message`'s `messageId` / `headers`.

## Develop

```bash
npm install
npm test
npm run lint
npm run build
```

Tests mock IMAP, SMTP, and DAV. They do not need a live iCloud account.

## Security notes

- Treat the app-specific password like a mailbox + calendar + contacts credential. Prefer OS secret storage in your MCP client, not a committed `.env`.
- `ICLOUD_ALLOW_EXPUNGE` permanently destroys mail. Leave it off.
- Attachment paths are read from the machine running the server. Set `ICLOUD_ATTACHMENT_ROOT` if the agent should not read arbitrary files.
- This is not an Apple product. IMAP/CalDAV/CardDAV can change; iCloud folder names (`Sent Messages`, `Deleted Messages`) are quirky by design.

## License

MIT
