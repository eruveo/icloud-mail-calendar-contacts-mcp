import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IcloudConfig } from "../config.js";

export interface ClosableSession {
  close(): Promise<void>;
}

export interface IcloudApp {
  server: McpServer;
  config: IcloudConfig;
  session?: ClosableSession;
}
