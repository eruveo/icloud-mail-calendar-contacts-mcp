export interface DavRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  depth?: "0" | "1" | "infinity";
}

export interface DavResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  text: string;
}

export type DavFetch = (request: DavRequest) => Promise<DavResponse>;

export function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

export function createDavFetch(options: {
  username: string;
  password: string;
  timeoutMs: number;
  userAgent: string;
  fetchImpl?: typeof fetch;
}): DavFetch {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (request: DavRequest): Promise<DavResponse> => {
    let url = request.url;
    const secrets = [options.password];
    for (let hop = 0; hop < 8; hop += 1) {
      const headers = new Headers(request.headers);
      headers.set("Authorization", basicAuth(options.username, options.password));
      headers.set("User-Agent", options.userAgent);
      if (request.depth !== undefined) {
        headers.set("Depth", request.depth);
      }
      if (request.body !== undefined && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/xml; charset=utf-8");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: request.method,
          headers,
          body: request.body,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes("abort")) {
          throw new Error(`CalDAV/CardDAV request timed out talking to ${url}`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }

      const location = response.headers.get("location");
      if (location && [301, 302, 303, 307, 308].includes(response.status)) {
        url = new URL(location, url).toString();
        continue;
      }

      const text = await response.text();
      const davResponse: DavResponse = {
        url,
        status: response.status,
        headers: headerMap(response.headers),
        text,
      };
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "iCloud DAV authentication failed. Use an Apple app-specific password from https://account.apple.com (Sign-In and Security → App-Specific Passwords), not your regular Apple ID password.",
        );
      }
      if (text.includes(options.password) || JSON.stringify(davResponse.headers).includes(options.password)) {
        throw new Error("Refusing to surface a DAV response that contained the app-specific password.");
      }
      void secrets;
      return davResponse;
    }
    throw new Error("Too many HTTP redirects during CalDAV/CardDAV discovery.");
  };
}

export function assertOk(response: DavResponse, action: string): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }
  const snippet = response.text.replace(/\s+/gu, " ").slice(0, 180);
  throw new Error(`${action} failed (HTTP ${response.status})${snippet ? `: ${snippet}` : "."}`);
}
