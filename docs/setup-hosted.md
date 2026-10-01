# Cloud (hosted for you + friends)

For **one owner plus a few friends**. Each person uses their own iCloud address and app-specific password. They authenticate to *your* MCP server with a **per-user bearer token**. There is no shared admin login on HTTP.

MCP endpoint: **`POST` / `GET` / `DELETE` `/mcp`** (Streamable HTTP, JSON responses). Liveness: **`GET` `/healthz`**.

Put **Cloudflare Access** (allowlisted emails) or **Tailscale** in front. Tokens leak; a second layer stops random internet clients from even reaching `/mcp`.

## 1. Encryption key

Generate a 32-byte AES key (64 hex characters):

```bash
openssl rand -hex 32
```

Set `ICLOUD_MCP_ENCRYPTION_KEY` to that value. It encrypts every stored app-specific password with **AES-256-GCM**. Losing the key means you must re-add users. Do not commit it.

## 2. Add friends (owner CLI, not HTTP)

The owner runs the CLI on a machine that can write the user store (local JSON file, or the same Upstash Redis the host uses).

```bash
export ICLOUD_MCP_ENCRYPTION_KEY="$(openssl rand -hex 32)"   # once; then reuse
export ICLOUD_MCP_USERS_FILE=./data/users.json               # Node / Docker default

node dist/index.js add-user \
  --id alice \
  --email alice@icloud.com \
  --app-password xxxx-xxxx-xxxx-xxxx \
  --timezone Australia/Sydney

# printed once:
# User created. Store this bearer token now; it cannot be retrieved later:
# <token>
```

Safe defaults match Local mode (send/write on, delete/expunge off). Examples:

```bash
# Read-only friend
node dist/index.js add-user --id bob --email bob@icloud.com --app-password xxxx --read-only

# Calendar + contacts only, no mail
node dist/index.js add-user --id cara --email cara@icloud.com --app-password xxxx --services calendar,contacts

# Permit trash (still no expunge)
node dist/index.js add-user --id dan --email dan@icloud.com --app-password xxxx --allow-delete
```

Permission flags (omit to keep the default; `--no-allow-send` turns a default-on flag off):

`--read-only`, `--allow-send`, `--allow-mail-write`, `--allow-calendar-write`, `--allow-contacts-write`, `--allow-delete`, `--allow-expunge`

```bash
node dist/index.js list-users
node dist/index.js rotate-token --id alice    # prints a new token once; old token dies
node dist/index.js revoke-user --id alice     # immediate
```

Tokens are 32 random bytes (base64url). Only a SHA-256 hash is stored. Passwords are ciphertext. Tools never return either.

## 3. Friends: add the remote server

Each friend pastes **their** token into the client. The URL is your `/mcp` endpoint.

Cursor / Claude-style remote MCP (shape varies slightly by client version):

```json
{
  "mcpServers": {
    "icloud": {
      "url": "https://icloud-mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer THEIR_TOKEN_HERE"
      }
    }
  }
}
```

Some clients use `"transport": "http"` or a `mcp-remote` proxy. The header must be `Authorization: Bearer …`. There is no CORS; browsers that are not the MCP client are not a supported caller.

## 4. Cloudflare Workers (Calendar + Contacts only)

**Mail does not run on Workers.** IMAP/SMTP clients in this repo (`imapflow`, `nodemailer`) need Node TCP/TLS. Workers `cloudflare:sockets` `connect()` is not compatible with those libraries. If a user has `mail` in their service list, the Worker returns HTTP 503 unless they also have calendar/contacts.

### Wrangler

```bash
npx wrangler kv namespace create USERS
# put the id into wrangler.toml
npx wrangler secret put ICLOUD_MCP_ENCRYPTION_KEY
```

`wrangler.toml` in this repo binds `USERS` KV and `src/worker.ts`.

Deploy:

```bash
npx wrangler deploy
```

Add users against the same KV from a Node box (Wrangler/KV REST is possible; the CLI here talks **Upstash Redis REST** or a **JSON file**. For Workers KV, use `wrangler kv key put` after `add-user` against a file and then copy, or run the CLI with a small script). Practical path for a few friends:

1. Run `add-user` locally with `ICLOUD_MCP_USERS_FILE=./data/users.json`.
2. Upload each `user:<id>` value and `users:index` JSON array into KV (`user:alice` → file contents of that user object; `users:index` → `["alice","bob"]`).

Or point the CLI at Redis and do not use Workers KV — pick one store.

### Cloudflare Access (recommended)

Zero Trust → Access → Application covering `https://your-worker.workers.dev/mcp` (and `/healthz` if you want). Identity: **One-time PIN / email allowlist** of your friends. Service tokens are not a substitute for MCP bearer tokens; use Access *and* bearer tokens.

`/healthz` can stay public for probes, or lock it too.

## 5. Vercel (full Mail + Calendar + Contacts)

Node serverless: per-request IMAP/SMTP connections. Fine for a few friends, not a public ISP.

1. Store users in **Upstash Redis** (or Vercel KV Redis REST):

   `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

   The CLI uses the same variables, so `add-user` from your laptop writes the same Redis the function reads.

2. Set `ICLOUD_MCP_ENCRYPTION_KEY` in the Vercel project.

3. `api/handler.mjs` plus `vercel.json` route `/mcp` and `/healthz` to that function.

4. Put the deployment behind **Vercel Deployment Protection**, Cloudflare Access, or Tailscale Funnel/Serve — not a naked `*.vercel.app`.

IMAP on a short-lived function opens TCP to `imap.mail.me.com:993` each tool call. Apple may rate-limit noisy clients.

## 6. Docker / VPS (full stack, JSON file store)

The image listens on `0.0.0.0:8788` and writes `/data/users.json` (mode `0600` when rewritten).

```bash
docker compose up --build
```

`docker-compose.yml` bind-mounts `./data` and reads `ICLOUD_MCP_ENCRYPTION_KEY` from the environment.

On a VPS without Docker:

```bash
export ICLOUD_MCP_ENCRYPTION_KEY=...
export ICLOUD_MCP_USERS_FILE=/var/lib/icloud-mcp/users.json
export ICLOUD_MCP_BIND=127.0.0.1
export ICLOUD_MCP_PORT=8788
node dist/index.js serve
```

Bind **127.0.0.1** and reverse-proxy with Caddy/nginx + TLS, or expose only on Tailscale (`tailscale serve`). Do not open `:8788` to the world.

Local default bind is `127.0.0.1`. Docker sets `ICLOUD_MCP_BIND=0.0.0.0` so the published port works.

## 7. Cloud environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `ICLOUD_MCP_ENCRYPTION_KEY` | yes | 32-byte key, 64 hex chars (or 32-byte Base64) |
| `ICLOUD_MCP_USERS_FILE` | Node/Docker | JSON user database (default `./data/users.json`) |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Vercel / Redis | If set, used instead of the JSON file |
| `ICLOUD_MCP_KV_REST_URL` + `ICLOUD_MCP_KV_REST_TOKEN` | alt | Same Redis REST shape as Upstash |
| `ICLOUD_MCP_BIND` | no | Listen address (default `127.0.0.1`) |
| `ICLOUD_MCP_PORT` | no | Listen port (default `8788`) |
| `ICLOUD_MCP_RATE_LIMIT` | no | Requests per window per token (default `60`) |
| `ICLOUD_MCP_RATE_WINDOW_MS` | no | Window (default `60000`) |
| `ICLOUD_MCP_MAX_BODY_BYTES` | no | POST cap (default `1048576`) |
| `IMAP_*` / `SMTP_*` / `ICLOUD_CALDAV_URL` / `ICLOUD_CARDDAV_URL` | no | Host overrides for all users |

Cloudflare Workers secrets/bindings: `ICLOUD_MCP_ENCRYPTION_KEY`, KV `USERS`. Rate-limit counters are per isolate (Access is the real throttle).

In Cloud mode, `send_email` **file attachments are disabled** (no shared filesystem). Body + recipients still work on Node/Vercel.

## 8. Rotation, revocation, threat model

See [SECURITY.md](../SECURITY.md). Short version:

- Rotate (`rotate-token`) if a client config leaked.
- Revoke immediately if a friend should lose access; also revoke their Apple app-specific password.
- The **operator can see** iCloud email addresses, service lists, permission flags, and tool-call metadata in logs (secrets redacted). The operator **cannot** read bearer tokens or app-specific passwords from storage. The operator **can** decrypt passwords with the server key — treat the host as trusted.
