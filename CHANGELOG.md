# Changelog

## [Unreleased]

### Added

- Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) with an `icloud` plugin. The plugin asks for the address, app-specific password (stored as a sensitive option), time zone, and read-only, send, and delete switches.
- Agent Skills in `plugins/icloud/skills`: `icloud-assistant` (safe everyday use) and `icloud-setup` (install, permissions, troubleshooting).
- `prepare` script, so `npx -y github:eruveo/icloud-mail-calendar-contacts-mcp` builds and runs the server.
- Test that keeps the skills, plugin manifest, and registered tools in sync.

### Changed

- Dockerfile runs `npm ci --ignore-scripts`, because the source is copied after install.

## [0.1.0] - 2026-10-01

### Added

- `icloud-mail-calendar-contacts-mcp`, a stdio MCP server for iCloud Mail (IMAP + SMTP), Calendar (CalDAV), and Contacts (CardDAV).
- Hosted Streamable HTTP mode (`/mcp`, `/healthz`) with per-user bearer tokens, AES-256-GCM at rest, owner CLI (`add-user`, `list-users`, `revoke-user`, `rotate-token`), and per-user permission flags.
- Storage: JSON file (Docker/Node), Cloudflare KV, Upstash Redis REST (Vercel).
- Permission model: `ICLOUD_READ_ONLY`, `ICLOUD_ALLOW_SEND`, `ICLOUD_ALLOW_*_WRITE`, `ICLOUD_ALLOW_DELETE`, `ICLOUD_ALLOW_EXPUNGE`.
- Tests mock IMAP, SMTP, DAV, auth, and encryption. No live iCloud account required.
