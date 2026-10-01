import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleFetch, type HostedRuntime } from "./http.js";
import { structuredLog } from "./log.js";

function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value.join(", ") : value;
}

export async function nodeToFetchRequest(
  req: IncomingMessage,
  maxBodyBytes: number,
): Promise<Request> {
  const host = headerValue(req.headers.host) ?? "127.0.0.1";
  const url = `http://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    const normalised = headerValue(value);
    if (normalised !== undefined) {
      headers.set(key, normalised);
    }
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return new Request(url, { method: req.method, headers });
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBodyBytes) {
      const error = new Error("Request body too large.");
      error.name = "PayloadTooLarge";
      throw error;
    }
    chunks.push(buf);
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: Buffer.concat(chunks),
  });
}

export async function writeNodeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}

export function startNodeHttpServer(
  runtime: HostedRuntime,
  options: { bind: string; port: number },
): Promise<{ close: () => Promise<void>; url: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = await nodeToFetchRequest(req, runtime.maxBodyBytes);
        const response = await handleFetch(request, runtime);
        await writeNodeResponse(res, response);
      } catch (error) {
        if (error instanceof Error && error.name === "PayloadTooLarge") {
          res.statusCode = 413;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Request body too large." }));
          return;
        }
        structuredLog("http_error", {
          error: error instanceof Error ? error.message : "unknown",
        });
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "Internal error." }));
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(options.port, options.bind, () => {
      const url = `http://${options.bind}:${options.port}`;
      structuredLog("listening", { url, platform: runtime.platform });
      resolve({
        url,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}
