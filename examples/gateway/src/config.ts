/**
 * Where the page reads its events from, and how. DOM-free: the page passes
 * `document.baseURI`, `location.search` and its root element's dataset.
 *
 * - `eventsUrl`: the `events` query parameter, else `data-events-url`, else
 *   `events`, resolved against the page's base URI. A relative default keeps
 *   the page working behind a reverse proxy that serves it under a path.
 * - `credentials`: the `credentials` query parameter, else
 *   `data-credentials`, else `same-origin`.
 * - `headers`: `data-headers`, a JSON object of strings. Never from the
 *   query string, so that a link cannot make the page send headers.
 *
 * The page never asks for or stores gateway credentials: with
 * `same-origin`, the browser sends the Basic credentials it was given for
 * the page, or a reverse proxy authenticates the user.
 */
export interface HostConfig {
  readonly eventsUrl: string;
  readonly credentials: RequestCredentials;
  readonly headers: Readonly<Record<string, string>>;
}

export interface HostConfigInput {
  readonly baseURI: string;
  readonly search: string;
  readonly dataset: Readonly<Record<string, string | undefined>>;
}

const CREDENTIALS: readonly string[] = ["omit", "same-origin", "include"];

function isCredentials(value: string): value is RequestCredentials {
  return CREDENTIALS.includes(value);
}

function parseHeaders(json: string | undefined): Record<string, string> {
  if (json === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("data-headers must be a JSON object of strings");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("data-headers must be a JSON object of strings");
  }
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(value)) {
    if (typeof header !== "string")
      throw new Error("data-headers must be a JSON object of strings");
    headers[name] = header;
  }
  return headers;
}

export function resolveHostConfig({ baseURI, search, dataset }: HostConfigInput): HostConfig {
  const query = new URLSearchParams(search);
  const url = new URL(query.get("events") ?? dataset["eventsUrl"] ?? "events", baseURI);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`the events URL must be http or https, not ${url.protocol}`);
  }
  const credentials = query.get("credentials") ?? dataset["credentials"] ?? "same-origin";
  if (!isCredentials(credentials)) {
    throw new Error(`credentials must be one of ${CREDENTIALS.join(", ")}`);
  }
  return { eventsUrl: url.href, credentials, headers: parseHeaders(dataset["headers"]) };
}
