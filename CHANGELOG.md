# Changelog

## [0.1.0] - 2026-10-01

### Added

- First release of `icloud-mcp`, a stdio MCP server for iCloud Mail (IMAP + SMTP), Calendar (CalDAV), and Contacts (CardDAV).
- Mail: list/search/read (EXAMINE + BODY.PEEK), send, reply threading, drafts, flags, move, create folders, trash, opt-in expunge.
- Calendar: list calendars/events (recurrence expanded), create/update/delete events, create calendars, attendees/invites, RSVP.
- Contacts: list/search/get, create/update/delete, iCloud CardDAV groups.
- Permission model: `ICLOUD_READ_ONLY`, `ICLOUD_ALLOW_SEND`, `ICLOUD_ALLOW_*_WRITE`, `ICLOUD_ALLOW_DELETE`, `ICLOUD_ALLOW_EXPUNGE`.
- Tests mock IMAP, SMTP, and DAV. No live iCloud account required.
