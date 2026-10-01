# Local (your machine)

Run the MCP server as a subprocess of Claude Desktop, Cursor, or any other MCP client. Credentials stay on your machine as environment variables. This is the default binary behaviour (no CLI subcommand).

## 1. App-specific password

1. Turn on two-factor authentication for your Apple Account.
2. Open [https://account.apple.com](https://account.apple.com) → **Sign-In and Security** → **App-Specific Passwords** → generate one. Label it `icloud-mail-calendar-contacts-mcp`.
3. Use the **full iCloud address** as the username (`you@icloud.com`, `@me.com`, or `@mac.com`).
4. Use the generated `xxxx-xxxx-xxxx-xxxx` password — **not** your Apple ID password.
5. Confirm iCloud Mail, Calendar, and Contacts are enabled for the account.

Revoking that app-specific password at account.apple.com is the kill switch.

## 2. Build

```bash
git clone https://github.com/eruveo/icloud-mail-calendar-contacts-mcp.git
cd icloud-mail-calendar-contacts-mcp
npm install
npm run build
```

Once the package is on npm:

```bash
npx -y icloud-mail-calendar-contacts-mcp
```

Do not publish from a development checkout unless you intend to.

## 3. Environment

Required:

| Variable | Meaning |
| --- | --- |
| `ICLOUD_EMAIL` or `ICLOUD_USERNAME` | Full iCloud address |
| `ICLOUD_APP_PASSWORD` | App-specific password |

Optional:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ICLOUD_SERVICES` | `mail,calendar,contacts` | Comma-separated subset |
| `ICLOUD_TIMEZONE` | `UTC` | IANA zone for calendar display/create |
| `ICLOUD_READ_ONLY` | `false` | Disable every write |
| `ICLOUD_ALLOW_SEND` | `true` | SMTP send |
| `ICLOUD_ALLOW_MAIL_WRITE` | `true` | Flags, move, drafts, create mailbox |
| `ICLOUD_ALLOW_CALENDAR_WRITE` | `true` | Event/calendar writes, RSVP |
| `ICLOUD_ALLOW_CONTACTS_WRITE` | `true` | Contact/group writes |
| `ICLOUD_ALLOW_DELETE` | `false` | Trash / DAV DELETE |
| `ICLOUD_ALLOW_EXPUNGE` | `false` | Permanent IMAP expunge |
| `ICLOUD_ATTACHMENT_ROOT` | unset | If set, `send_email` attachment paths must stay inside this directory |
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_SECURE` | `imap.mail.me.com` / `993` / `true` | Tests or relays |
| `SMTP_HOST` / `SMTP_PORT` | `smtp.mail.me.com` / `587` | Tests or relays |
| `ICLOUD_CALDAV_URL` / `ICLOUD_CARDDAV_URL` | Apple defaults | Do not hard-code a `pNN` shard |

The process never logs or returns the app-specific password.

## 4. Client snippets

Replace `/absolute/path/to/icloud-mail-calendar-contacts-mcp` with your clone.

### Cursor (`mcp.json`)

```json
{
  "mcpServers": {
    "icloud": {
      "command": "node",
      "args": ["/absolute/path/to/icloud-mail-calendar-contacts-mcp/dist/index.js"],
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

Config file: macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "icloud": {
      "command": "npx",
      "args": ["-y", "icloud-mail-calendar-contacts-mcp"],
      "env": {
        "ICLOUD_EMAIL": "you@icloud.com",
        "ICLOUD_APP_PASSWORD": "xxxx-xxxx-xxxx-xxxx"
      }
    }
  }
}
```

Until npm publish, use `command: "node"` and `args` pointing at `dist/index.js` as in the Cursor snippet.

Lock it down:

```json
"env": {
  "ICLOUD_EMAIL": "you@icloud.com",
  "ICLOUD_APP_PASSWORD": "xxxx-xxxx-xxxx-xxxx",
  "ICLOUD_READ_ONLY": "true"
}
```

### Generic MCP client

Any client that can spawn a stdio server:

```bash
export ICLOUD_EMAIL=you@icloud.com
export ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
node dist/index.js
```

No CLI arguments in this mode. Credentials and toggles are environment variables only.
