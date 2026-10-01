import { createApp } from "../server.js";
import { openEncryptionKey, openUserStore } from "./cli.js";
import { handleFetch, defaultMaxBodyBytes, type HostedRuntime } from "./http.js";
import { nodeToFetchRequest, writeNodeResponse } from "./node-http.js";
import { TokenRateLimiter } from "./rate-limit.js";
import type { IncomingMessage, ServerResponse } from "node:http";

let cached: Promise<HostedRuntime> | undefined;

function runtime(): Promise<HostedRuntime> {
  cached ??= (async () => {
    const env = process.env;
    const limit = Number.parseInt(env.ICLOUD_MCP_RATE_LIMIT ?? "60", 10);
    const windowMs = Number.parseInt(env.ICLOUD_MCP_RATE_WINDOW_MS ?? "60000", 10);
    const maxBody = Number.parseInt(
      env.ICLOUD_MCP_MAX_BODY_BYTES ?? String(defaultMaxBodyBytes()),
      10,
    );
    return {
      store: openUserStore(env),
      encryptionKey: await openEncryptionKey(env),
      createApp: (config) => createApp({ config, env, mailSupported: true }),
      mailSupported: true,
      platform: "vercel",
      rateLimiter: new TokenRateLimiter(limit, windowMs),
      maxBodyBytes: maxBody,
      hostEnv: env,
    };
  })();
  return cached;
}

export default async function vercelHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const hosted = await runtime();
  try {
    const request = await nodeToFetchRequest(req, hosted.maxBodyBytes);
    const response = await handleFetch(request, hosted);
    await writeNodeResponse(res, response);
  } catch (error) {
    if (error instanceof Error && error.name === "PayloadTooLarge") {
      res.statusCode = 413;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Request body too large." }));
      return;
    }
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Internal error." }));
  }
}
