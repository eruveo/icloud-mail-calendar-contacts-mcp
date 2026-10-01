# icloud-mail-calendar-contacts-mcp

MIT-licensed [Model Context Protocol](https://modelcontextprotocol.io) server for one iCloud account (or a handful, in hosted mode). It talks to Apple with an **app-specific password** over IMAP + SMTP, CalDAV, and CardDAV — the same third-party surface Mail.app / Calendar.app use.

There is no official Apple MCP. This is a small open-source one.

**GitHub:** [eruveo/icloud-mail-calendar-contacts-mcp](https://github.com/eruveo/icloud-mail-calendar-contacts-mcp)  
**Author:** Michal Sevcik ([@eruveo](https://github.com/eruveo))  
**License:** MIT

## Two ways to run it

| | Option 1 — local stdio | Option 2 — hosted HTTP |
| --- | --- | --- |
| Who | You, on your machine | You plus a few friends |
| Transport | MCP stdio (Claude Desktop, Cursor, any local client) | Streamable HTTP at `/mcp` (current MCP spec) |
| Credentials | Env vars in the client config | Per-user iCloud login, encrypted at rest; friends authenticate with a bearer token |
| Docs | [docs/setup-local.md](docs/setup-local.md) | [docs/setup-hosted.md](docs/setup-hosted.md) |

Keep stdio as the default. Hosted mode is opt-in (`serve` + a user-admin CLI).

**Using Grok Bot?** Run option 1 on your bot's own always-on computer (the box): no hosting, no cost, and every one of your bots gets the tools. See [docs/setup-grok-bot.md](docs/setup-grok-bot.md).

Once this package is on npm you will be able to run:

```bash
npx -y icloud-mail-calendar-contacts-mcp
```

This repository does **not** publish to npm as part of development. Until then, `npm install && npm run build && node dist/index.js`.

## What it can do

| Service | Protocol | Reads | Writes |
| --- | --- | --- | --- |
| Mail | IMAP `imap.mail.me.com:993` + SMTP `smtp.mail.me.com:587` STARTTLS | List folders, search, fetch bodies (never implicitly marked seen) | Send, reply/forward threading, drafts, flags, move, create folders, trash |
| Calendar | CalDAV `https://caldav.icloud.com` | List calendars, list/get events with timezones and expanded recurrences, list invitations | Create calendars, create/update events, attendees (iCloud sends the invites), RSVP |
| Contacts | CardDAV `https://contacts.icloud.com` | Search/list/get, list groups | Create/update contacts and groups |

**Delete** is off unless you opt in (`ICLOUD_ALLOW_DELETE` locally, or `--allow-delete` per hosted user). **Permanent IMAP expunge** is a separate opt-in.

## What it cannot do

No app-specific-password API suitable for a third-party MCP:

- **Photos**, **iCloud Drive**, **Notes**, **Passwords / iCloud Keychain**
- **Reminders** — modern lists live on CloudKit, not reliable CalDAV `VTODO`. `ICLOUD_SERVICES=reminders` is rejected.

### Platform limits (hosted)

| Host | Calendar / Contacts | Mail (IMAP/SMTP) |
| --- | --- | --- |
| **Node / Docker / VPS** | Yes | Yes |
| **Vercel** (Node serverless) | Yes | Yes (new TCP connection per request; fine for light use) |
| **Cloudflare Workers** | Yes (`fetch` to CalDAV/CardDAV) | **No.** `imapflow` and `nodemailer` need Node `net`/`tls`. Workers `cloudflare:sockets` `connect()` is not a drop-in for those libraries. |

Put **Cloudflare Access** (email allowlist) or **Tailscale** in front of any public URL. Bearer tokens are necessary, not sufficient, if the endpoint is on the internet. See [SECURITY.md](SECURITY.md).

## Permission model

Defaults suit a personal assistant that may send mail and create events, but must not destroy data:

| Flag | Default | Effect |
| --- | --- | --- |
| `ICLOUD_READ_ONLY` / `--read-only` | `false` | Master switch. Disables every write and omits write tools. |
| `ICLOUD_ALLOW_SEND` / `--allow-send` | `true` | SMTP `send_email`. |
| `ICLOUD_ALLOW_MAIL_WRITE` / `--allow-mail-write` | `true` | Flags, move, create mailbox, save draft. |
| `ICLOUD_ALLOW_CALENDAR_WRITE` / `--allow-calendar-write` | `true` | Create/update events and calendars, RSVP. |
| `ICLOUD_ALLOW_CONTACTS_WRITE` / `--allow-contacts-write` | `true` | Create/update contacts and groups. |
| `ICLOUD_ALLOW_DELETE` / `--allow-delete` | **`false`** | `trash_message`, `delete_event`, `delete_contact`. |
| `ICLOUD_ALLOW_EXPUNGE` / `--allow-expunge` | **`false`** | `expunge_message` (permanent). |

`read-only` wins. Write tool descriptions start with **`[WRITE]`**. IMAP reads still use `EXAMINE` + `BODY.PEEK`.

## Tools

Mail: `list_mailboxes`, `search_messages`, `list_recent_messages`, `get_message`, `send_email`, `mark_message`, `move_message`, `create_mailbox`, `save_draft`, `trash_message`, `expunge_message`.

Calendar: `list_calendars`, `list_events`, `get_event`, `list_invitations`, `create_calendar`, `create_event`, `update_event`, `respond_to_invitation`, `delete_event`.

Contacts: `list_contacts`, `list_contact_groups`, `get_contact`, `create_contact`, `update_contact`, `create_contact_group`, `delete_contact`.

## Develop

Node 20+.

```bash
npm install
npm test
npm run lint
npm run build
```

Tests mock IMAP, SMTP, and DAV. They do not need a live iCloud account.

## License

MIT © Michal Sevcik
