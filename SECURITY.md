# Security

This MCP server can send mail, create calendar events, and change contacts for every configured iCloud account. Treat it like a mail client with API access, not a toy.

## Trust boundaries

**Local stdio (option 1).** The MCP client (Cursor, Claude Desktop, …) spawns the process and passes `ICLOUD_EMAIL` / `ICLOUD_APP_PASSWORD`. Anyone who can read that client config can use the mailbox. The model you attach can call every enabled tool. Prefer OS secret storage. Never commit `.env`.

**Hosted HTTP (option 2).** You operate a Streamable HTTP server at `/mcp`. Friends present a per-user bearer token. Apple credentials are encrypted at rest. You (the operator) are a privileged party: you hold `ICLOUD_MCP_ENCRYPTION_KEY` and can decrypt app-specific passwords, read iCloud addresses, and see structured request logs.

## What the operator can see

| Data | Operator |
| --- | --- |
| Friend iCloud email | Yes (plaintext in the user store, needed to log in to Apple) |
| Permission / service flags | Yes |
| Bearer token | No (only SHA-256). Shown once at `add-user` / `rotate-token` |
| App-specific password | Not in logs, not in tool results, ciphertext at rest. **Yes if they use the encryption key** |
| Mail/event/contact contents | Yes, whenever a tool runs on the host (the process sees Apple’s responses) |

There is no “admin” HTTP route. User management is a local CLI.

## Controls

- AES-256-GCM for app-specific passwords (`ICLOUD_MCP_ENCRYPTION_KEY`, 32 bytes).
- Bearer tokens: ≥32 random bytes, SHA-256 stored, constant-time compare of hashes, scan of the small user list.
- Defaults: delete and expunge off; `read-only` wins.
- Rate limit per token hash; 1 MiB body cap; no CORS; bind `127.0.0.1` unless you override.
- Structured logs with password/token/authorization fields redacted.
- Hosted mode refuses `send_email` **file** attachments (stdio can still attach local files, optionally sandboxed with `ICLOUD_ATTACHMENT_ROOT`).

## Extra perimeter (do this)

If `/mcp` is reachable from the internet:

1. **Cloudflare Access** with an email allowlist of the same friends who have tokens, or
2. **Tailscale** (serve/funnel, or a VPS only on the tailnet).

Tokens in client JSON will leak (screenshots, backups, chat logs). Access/Tailscale stops strangers from presenting a stolen token to a public URL *and* stops scanner noise.

TLS at the proxy. HTTP from the Node process to the proxy can stay on localhost.

## Rotation and revocation

```bash
node dist/index.js rotate-token --id alice   # new token; old hash replaced
node dist/index.js revoke-user --id alice    # token stops working immediately
```

Also revoke the Apple app-specific password at [account.apple.com](https://account.apple.com) if you believe it leaked. That is Apple’s kill switch, independent of this server.

## What this is not

- Not an Apple product. IMAP/CalDAV/CardDAV and folder names can change.
- Not a multi-tenant SaaS. Designed for a handful of trusted people.
- Not a substitute for 2FA on the Apple Account. App-specific passwords still require 2FA to be created; they remain a full mailbox credential.
- Cloudflare Workers cannot run IMAP/SMTP from this codebase; do not assume mail is isolated just because you deployed a Worker — calendar/contacts on that Worker still use each user’s Apple password.

## Reporting

Open a GitHub issue on [eruveo/icloud-mail-calendar-contacts-mcp](https://github.com/eruveo/icloud-mail-calendar-contacts-mcp) for non-sensitive bugs. For a credential-handling flaw, email the maintainer via GitHub (@eruveo) rather than filing a public issue with secrets.
