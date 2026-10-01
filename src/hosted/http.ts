import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildConfig, type IcloudConfig } from "../config.js";
import { decryptSecret } from "./crypto.js";
import type { IcloudApp } from "../mcp/app-types.js";
import { authenticateRequest } from "./auth.js";
import { structuredLog } from "./log.js";
import { TokenRateLimiter } from "./rate-limit.js";
import { enabledServices } from "./users.js";
import type { StoredUser, UserStore } from "./types.js";

const DEFAULT_MAX_BODY = 1_048_576;
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface HostedSession {
  id: string;
  transport: WebStandardStreamableHTTPServerTransport;
  app: IcloudApp;
  lastUsed: number;
}

export interface HostedRuntime {
  store: UserStore;
  encryptionKey: CryptoKey;
  createApp: (config: IcloudConfig) => IcloudApp;
  mailSupported: boolean;
  platform: string;
  rateLimiter: TokenRateLimiter;
  maxBodyBytes: number;
  hostEnv?: NodeJS.ProcessEnv;
  sessions?: Map<string, HostedSession>;
}

export function defaultMaxBodyBytes(): number {
  return DEFAULT_MAX_BODY;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}

export async function handleFetch(request: Request, runtime: HostedRuntime): Promise<Response> {
  const path = requestPath(request);
  if (path === "/healthz" && request.method === "GET") {
    return jsonResponse(200, {
      ok: true,
      name: "icloud-mail-calendar-contacts-mcp",
      platform: runtime.platform,
      mail: runtime.mailSupported,
      calendar: true,
      contacts: true,
    });
  }

  if (path !== "/mcp") {
    return jsonResponse(404, { error: "Not found." });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 405, headers: { allow: "GET, POST, DELETE" } });
  }

  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const length = Number.parseInt(lengthHeader, 10);
    if (Number.isFinite(length) && length > runtime.maxBodyBytes) {
      return jsonResponse(413, { error: "Request body too large." });
    }
  }

  const auth = await authenticateRequest(request, runtime.store);
  if (!auth.ok) {
    structuredLog("auth_failed", { status: auth.status, platform: runtime.platform });
    return jsonResponse(auth.status, { error: auth.error });
  }

  if (!runtime.rateLimiter.allow(auth.user.tokenHash)) {
    structuredLog("rate_limited", { userId: auth.user.id, platform: runtime.platform });
    return jsonResponse(429, { error: "Rate limit exceeded." });
  }

  try {
    return await handleMcp(request, runtime, auth.user);
  } catch (error) {
    const message = error instanceof Error ? error.message : "hosted handler failed";
    structuredLog("mcp_error", { userId: auth.user.id, error: message, platform: runtime.platform });
    return jsonResponse(500, { error: "Internal error." });
  }
}

async function handleMcp(
  request: Request,
  runtime: HostedRuntime,
  user: StoredUser,
): Promise<Response> {
  const sessions = runtime.sessions ?? new Map<string, HostedSession>();
  runtime.sessions = sessions;
  pruneSessions(sessions);

  const existingId = request.headers.get("mcp-session-id");
  if (existingId) {
    const existing = sessions.get(existingId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.transport.handleRequest(request);
    }
    if (request.method !== "POST") {
      return jsonResponse(404, { error: "Unknown MCP session." });
    }
  }

  const appPassword = await decryptSecret(user.encryptedAppPassword, runtime.encryptionKey);
  const services = enabledServices(user, runtime.mailSupported);
  if (services.length === 0) {
    return jsonResponse(503, {
      error:
        "This host cannot serve mail (IMAP/SMTP need a Node TCP stack). Calendar and contacts work on Cloudflare Workers — add those services for this user, or run Docker/Vercel/Node for mail.",
    });
  }

  const config = buildConfig({
    email: user.email,
    appPassword,
    services,
    timezone: user.timezone,
    permissions: user.permissions,
    allowFileAttachments: false,
    env: runtime.hostEnv,
  });
  const app = runtime.createApp(config);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    maxRequestBodySize: runtime.maxBodyBytes,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { id: sessionId, transport, app, lastUsed: Date.now() });
    },
    onsessionclosed: (sessionId) => {
      const session = sessions.get(sessionId);
      sessions.delete(sessionId);
      void session?.app.session?.close();
    },
  });
  await app.server.connect(transport);
  const response = await transport.handleRequest(request);
  return response;
}

function pruneSessions(sessions: Map<string, HostedSession>): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.lastUsed < cutoff) {
      sessions.delete(id);
      void session.app.session?.close();
      void session.transport.close();
    }
  }
}
