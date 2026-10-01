import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildConfig, defaultWritePermissions } from "../src/config.js";
import { decryptSecret, encryptSecret, importEncryptionKey } from "../src/hosted/crypto.js";
import { FileUserStore } from "../src/hosted/file-store.js";
import { authenticateRequest, findUserByToken } from "../src/hosted/auth.js";
import { handleFetch, type HostedRuntime } from "../src/hosted/http.js";
import { MemoryKv, KvUserStore } from "../src/hosted/kv-store.js";
import { MemoryUserStore } from "../src/hosted/memory-store.js";
import { TokenRateLimiter } from "../src/hosted/rate-limit.js";
import { generateBearerToken, hashToken, timingSafeEqualHex } from "../src/hosted/token.js";
import { addUser, permissionsFromFlags, revokeUser, rotateToken } from "../src/hosted/users.js";
import { createDavApp } from "../src/mcp/dav-app.js";
import { createApp } from "../src/server.js";

const HEX_KEY = "ab".repeat(32);

async function key(): Promise<CryptoKey> {
  return importEncryptionKey(HEX_KEY);
}

describe("AES-256-GCM credentials", () => {
  it("round-trips and never stores plaintext", async () => {
    const cryptoKey = await key();
    const secret = "xxxx-xxxx-xxxx-xxxx";
    const packed = await encryptSecret(secret, cryptoKey);
    expect(packed.startsWith("v1:")).toBe(true);
    expect(packed).not.toContain(secret);
    expect(await decryptSecret(packed, cryptoKey)).toBe(secret);
  });

  it("fails closed with the wrong key", async () => {
    const a = await importEncryptionKey("11".repeat(32));
    const b = await importEncryptionKey("22".repeat(32));
    const packed = await encryptSecret("hunter2-app-password", a);
    await expect(decryptSecret(packed, b)).rejects.toThrow(/decrypt/i);
  });
});

describe("bearer tokens", () => {
  it("hashes 32-byte tokens and compares in constant time", async () => {
    const token = generateBearerToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    const hash = await hashToken(token);
    expect(hash).toHaveLength(64);
    expect(timingSafeEqualHex(hash, await hashToken(token))).toBe(true);
    expect(timingSafeEqualHex(hash, await hashToken(generateBearerToken()))).toBe(false);
  });
});

describe("user store + auth", () => {
  it("stores only the token hash and authenticates the bearer", async () => {
    const store = new MemoryUserStore();
    const cryptoKey = await key();
    const created = await addUser(store, cryptoKey, {
      id: "alice",
      email: "alice@icloud.com",
      appPassword: "aaaa-bbbb-cccc-dddd",
    });
    const stored = await store.get("alice");
    expect(stored?.tokenHash).toBe(await hashToken(created.token));
    expect(JSON.stringify(stored)).not.toContain("aaaa-bbbb-cccc-dddd");
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(await findUserByToken(store, created.token)).toMatchObject({ id: "alice" });
    expect(await findUserByToken(store, generateBearerToken())).toBeNull();
  });

  it("rejects revoked tokens and issues a new hash on rotate", async () => {
    const store = new MemoryUserStore();
    const cryptoKey = await key();
    const created = await addUser(store, cryptoKey, {
      id: "bob",
      email: "bob@icloud.com",
      appPassword: "zzzz-yyyy-xxxx-wwww",
    });
    await revokeUser(store, "bob");
    expect(await findUserByToken(store, created.token)).toBeNull();
    const rotated = await rotateToken(store, "bob");
    expect(rotated.token).not.toBe(created.token);
    expect(await findUserByToken(store, created.token)).toBeNull();
    expect(await findUserByToken(store, rotated.token)).toMatchObject({ id: "bob" });
  });

  it("persists users in a JSON file without leaking secrets", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "icloud-mcp-"));
    const file = path.join(dir, "users.json");
    const store = new FileUserStore(file);
    const cryptoKey = await key();
    const created = await addUser(store, cryptoKey, {
      id: "filey",
      email: "filey@icloud.com",
      appPassword: "file-secret-pass",
    });
    const disk = await readFile(file, "utf8");
    expect(disk).not.toContain("file-secret-pass");
    expect(disk).not.toContain(created.token);
    const reloaded = new FileUserStore(file);
    expect(await findUserByToken(reloaded, created.token)).toMatchObject({ id: "filey" });
  });

  it("round-trips through the KV adapter", async () => {
    const store = new KvUserStore(new MemoryKv());
    const cryptoKey = await key();
    const created = await addUser(store, cryptoKey, {
      id: "kv",
      email: "kv@icloud.com",
      appPassword: "kv-secret-pass",
    });
    expect((await store.list()).map((user) => user.id)).toEqual(["kv"]);
    expect(await findUserByToken(store, created.token)).toMatchObject({ email: "kv@icloud.com" });
  });
});

describe("per-user permissions", () => {
  it("defaults match local env flags (writes on, delete off)", () => {
    expect(permissionsFromFlags({})).toEqual(defaultWritePermissions());
  });

  it("omits write tools for a read-only hosted user", async () => {
    const config = buildConfig({
      email: "ro@icloud.com",
      appPassword: "pass-pass-pass-pass",
      services: ["mail", "calendar", "contacts"],
      permissions: permissionsFromFlags({ readOnly: true }),
      allowFileAttachments: false,
    });
    const { server } = createApp({
      config,
      mailSupported: true,
      imapFactory: () => {
        throw new Error("imap should not connect during tools/list");
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("list_mailboxes");
    expect(names).toContain("list_calendars");
    expect(names).toContain("list_contacts");
    expect(names).not.toContain("send_email");
    expect(names).not.toContain("create_event");
    expect(names).not.toContain("create_contact");
    expect(names).not.toContain("trash_message");
    await client.close();
  });

  it("can allow send but keep delete off on a per-user basis", async () => {
    const config = buildConfig({
      email: "send@icloud.com",
      appPassword: "pass-pass-pass-pass",
      services: ["mail"],
      permissions: permissionsFromFlags({ allowSend: true, allowDelete: false }),
    });
    const { server } = createApp({
      config,
      imapFactory: () => {
        throw new Error("imap should not connect during tools/list");
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("send_email");
    expect(names).not.toContain("trash_message");
    await client.close();
  });
});

describe("hosted HTTP", () => {
  const sessions: HostedRuntime["sessions"] = new Map();

  afterEach(() => {
    sessions?.clear();
  });

  async function runtime(): Promise<{ runtime: HostedRuntime; token: string }> {
    const store = new MemoryUserStore();
    const cryptoKey = await key();
    const created = await addUser(store, cryptoKey, {
      id: "host",
      email: "host@icloud.com",
      appPassword: "host-secret-pass",
      services: "calendar,contacts",
      permissions: { readOnly: true },
    });
    return {
      token: created.token,
      runtime: {
        store,
        encryptionKey: cryptoKey,
        createApp: (config) => createDavApp({ config }),
        mailSupported: false,
        platform: "test",
        rateLimiter: new TokenRateLimiter(5, 60_000),
        maxBodyBytes: 1024,
        sessions,
      },
    };
  }

  it("requires a bearer token on /mcp and serves /healthz without one", async () => {
    const { runtime: hosted } = await runtime();
    const health = await handleFetch(new Request("http://127.0.0.1/healthz"), hosted);
    expect(health.status).toBe(200);
    const body = (await health.json()) as { mail: boolean; platform: string };
    expect(body.mail).toBe(false);
    expect(body.platform).toBe("test");

    const unauth = await handleFetch(
      new Request("http://127.0.0.1/mcp", { method: "POST", body: "{}" }),
      hosted,
    );
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects a forged token", async () => {
    const { runtime: hosted } = await runtime();
    const response = await handleFetch(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { authorization: "Bearer totally-not-a-real-token" },
        body: "{}",
      }),
      hosted,
    );
    expect(response.status).toBe(401);
  });

  it("does not set CORS headers on OPTIONS", async () => {
    const { runtime: hosted } = await runtime();
    const response = await handleFetch(new Request("http://127.0.0.1/mcp", { method: "OPTIONS" }), hosted);
    expect(response.status).toBe(405);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate-limits a token", async () => {
    const { runtime: hosted, token } = await runtime();
    hosted.rateLimiter = new TokenRateLimiter(2, 60_000);
    const ping = () =>
      handleFetch(
        new Request("http://127.0.0.1/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "test", version: "0" },
            },
          }),
        }),
        hosted,
      );
    expect((await ping()).status).not.toBe(429);
    expect((await ping()).status).not.toBe(429);
    expect((await ping()).status).toBe(429);
  });

  it("authenticateRequest rejects missing headers", async () => {
    const store = new MemoryUserStore();
    const result = await authenticateRequest(new Request("http://127.0.0.1/mcp"), store);
    expect(result.ok).toBe(false);
  });
});
