import { createDavApp } from "./mcp/dav-app.js";
import { importEncryptionKey } from "./hosted/crypto.js";
import { handleFetch, defaultMaxBodyBytes, type HostedRuntime } from "./hosted/http.js";
import { cloudflareKv, KvUserStore } from "./hosted/kv-store.js";
import { TokenRateLimiter } from "./hosted/rate-limit.js";

export interface WorkerEnv {
  USERS: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(options: { prefix: string }): Promise<{ keys: Array<{ name: string }> }>;
  };
  ICLOUD_MCP_ENCRYPTION_KEY: string;
  ICLOUD_MCP_RATE_LIMIT?: string;
  ICLOUD_MCP_RATE_WINDOW_MS?: string;
  ICLOUD_MCP_MAX_BODY_BYTES?: string;
}

const limiter = new TokenRateLimiter(60, 60_000);
let cached: { key: string; runtime: HostedRuntime } | undefined;

async function runtimeFromEnv(env: WorkerEnv): Promise<HostedRuntime> {
  if (cached && cached.key === env.ICLOUD_MCP_ENCRYPTION_KEY) {
    return cached.runtime;
  }
  const maxBody = Number.parseInt(env.ICLOUD_MCP_MAX_BODY_BYTES ?? String(defaultMaxBodyBytes()), 10);
  const runtime: HostedRuntime = {
    store: new KvUserStore(cloudflareKv(env.USERS)),
    encryptionKey: await importEncryptionKey(env.ICLOUD_MCP_ENCRYPTION_KEY),
    createApp: (config) => createDavApp({ config }),
    mailSupported: false,
    platform: "cloudflare-workers",
    rateLimiter: limiter,
    maxBodyBytes: maxBody,
  };
  cached = { key: env.ICLOUD_MCP_ENCRYPTION_KEY, runtime };
  return runtime;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const runtime = await runtimeFromEnv(env);
    return handleFetch(request, runtime);
  },
};
