import { readEnv } from "../config.js";
import { createApp } from "../server.js";
import { openEncryptionKey, openUserStore } from "./cli.js";
import { defaultMaxBodyBytes, type HostedRuntime } from "./http.js";
import { startNodeHttpServer } from "./node-http.js";
import { TokenRateLimiter } from "./rate-limit.js";

export async function startHostedNodeServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const bind = readEnv(env, "ICLOUD_MCP_BIND") ?? "127.0.0.1";
  const port = Number.parseInt(readEnv(env, "ICLOUD_MCP_PORT") ?? "8788", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("ICLOUD_MCP_PORT must be 1–65535.");
  }
  const limit = Number.parseInt(readEnv(env, "ICLOUD_MCP_RATE_LIMIT") ?? "60", 10);
  const windowMs = Number.parseInt(readEnv(env, "ICLOUD_MCP_RATE_WINDOW_MS") ?? "60000", 10);
  const maxBody = Number.parseInt(
    readEnv(env, "ICLOUD_MCP_MAX_BODY_BYTES") ?? String(defaultMaxBodyBytes()),
    10,
  );
  const runtime: HostedRuntime = {
    store: openUserStore(env),
    encryptionKey: await openEncryptionKey(env),
    createApp: (config) => createApp({ config, env, mailSupported: true }),
    mailSupported: true,
    platform: "node",
    rateLimiter: new TokenRateLimiter(limit, windowMs),
    maxBodyBytes: maxBody,
    hostEnv: env,
  };
  const { url } = await startNodeHttpServer(runtime, { bind, port });
  process.stderr.write(`icloud-mail-calendar-contacts-mcp listening on ${url}/mcp\n`);
}
