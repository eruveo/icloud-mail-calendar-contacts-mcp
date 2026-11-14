import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildConfig } from "../src/config.js";
import { permissionsFromFlags } from "../src/hosted/users.js";
import { createApp } from "../src/server.js";

const root = path.resolve(import.meta.dirname, "..");
const pluginDir = path.join(root, "plugins", "icloud");
const skillsDir = path.join(pluginDir, "skills");

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

function frontmatter(markdown: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(markdown.replace(/\r\n/gu, "\n"));
  if (!match) {
    return {};
  }
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const top = /^([a-z][a-z0-9-]*):\s*(.*)$/u.exec(line);
    if (top) {
      fields[top[1] ?? ""] = top[2] ?? "";
    }
  }
  return fields;
}

async function skills(): Promise<{ dir: string; body: string }[]> {
  const dirs = await readdir(skillsDir, { withFileTypes: true });
  return Promise.all(
    dirs
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        dir: entry.name,
        body: await readFile(path.join(skillsDir, entry.name, "SKILL.md"), "utf8"),
      })),
  );
}

async function allToolNames(): Promise<string[]> {
  const config = buildConfig({
    email: "skills@icloud.com",
    appPassword: "pass-pass-pass-pass",
    services: ["mail", "calendar", "contacts"],
    permissions: permissionsFromFlags({ allowDelete: true, allowExpunge: true }),
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
  await client.close();
  return names;
}

describe("Claude Code plugin and agent skills", () => {
  it("marketplace points at the plugin folder", async () => {
    const marketplace = await readJson(path.join(root, ".claude-plugin", "marketplace.json"));
    const plugins = marketplace.plugins as { name: string; source: string }[];
    expect(plugins).toEqual([expect.objectContaining({ name: "icloud", source: "./plugins/icloud" })]);
    const manifest = await readJson(path.join(pluginDir, ".claude-plugin", "plugin.json"));
    expect(manifest.name).toBe("icloud");
  });

  it("plugin version follows package.json", async () => {
    const pkg = await readJson(path.join(root, "package.json"));
    const manifest = await readJson(path.join(pluginDir, ".claude-plugin", "plugin.json"));
    expect(manifest.version).toBe(pkg.version);
  });

  it("MCP config runs this repository, takes the password from secure user config, and fills every option", async () => {
    const manifest = await readJson(path.join(pluginDir, ".claude-plugin", "plugin.json"));
    const userConfig = manifest.userConfig as Record<string, { sensitive?: boolean } | undefined>;
    expect(userConfig.icloud_app_password?.sensitive).toBe(true);

    const mcp = await readJson(path.join(pluginDir, ".mcp.json"));
    type StdioServer = { command: string; args: string[]; env: Record<string, string> };
    const server = (mcp.mcpServers as Record<string, StdioServer | undefined>).icloud;
    if (!server) {
      throw new Error(".mcp.json must define mcpServers.icloud");
    }
    expect(server.command).toBe("npx");
    // Never point at an npm name: an unclaimed name could be published by anyone and receive the password.
    expect(server.args).toEqual(["-y", "github:eruveo/icloud-mail-calendar-contacts-mcp"]);
    expect(server.env.ICLOUD_APP_PASSWORD).toBe("${user_config.icloud_app_password}");

    const referenced = Object.values(server.env).map((value) => /^\$\{user_config\.([a-z_]+)\}$/u.exec(value)?.[1]);
    expect(referenced.every(Boolean)).toBe(true);
    expect(new Set(referenced)).toEqual(new Set(Object.keys(userConfig)));
  });

  it("package builds itself when installed from git", async () => {
    const pkg = await readJson(path.join(root, "package.json"));
    expect((pkg.scripts as Record<string, string>).prepare).toBe("npm run build");
  });

  it("skills follow the Agent Skills format", async () => {
    const found = await skills();
    expect(found.map((skill) => skill.dir).sort()).toEqual(["icloud-assistant"]);
    for (const skill of found) {
      const fields = frontmatter(skill.body);
      const name = fields.name ?? "";
      const description = fields.description ?? "";
      expect(name, skill.dir).toBe(skill.dir);
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(description.length, skill.dir).toBeGreaterThan(50);
      expect(description.length, skill.dir).toBeLessThanOrEqual(1024);
      expect(fields.license).toBe("MIT");
    }
  });

  it("skills only name tools the server registers", async () => {
    const tools = new Set(await allToolNames());
    const toolLike =
      /`((?:list|search|get|send|mark|move|create|save|trash|expunge|update|respond|delete)_[a-z_]+)`/gu;
    for (const skill of await skills()) {
      const mentioned = [...skill.body.matchAll(toolLike)].map((match) => match[1] ?? "");
      for (const name of mentioned) {
        expect(tools.has(name), `${skill.dir} mentions unknown tool ${name}`).toBe(true);
      }
    }
    const assistant = (await skills()).find((skill) => skill.dir === "icloud-assistant")!;
    for (const tool of tools) {
      expect(assistant.body.includes(`\`${tool}\``), `icloud-assistant does not cover ${tool}`).toBe(true);
    }
  });
});
