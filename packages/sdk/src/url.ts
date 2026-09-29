/**
 * Web addresses as plain data. Apps compile without the host's `URL`, so this
 * parses and resolves them in pure TypeScript (RFC 3986 reference resolution,
 * normalized the way browsers show them) and behaves the same on every device.
 */

/** An absolute URL. Empty strings mean the part is absent. */
export interface WebUrl {
  /** Lowercase, without the colon: `https`. */
  readonly scheme: string;
  /** `user:pass` before the `@`, rarely used on the web. */
  readonly userinfo: string;
  /** Lowercase host name; empty for `about:` and `mailto:` addresses. */
  readonly hostname: string;
  /** Empty when it is the scheme's default. */
  readonly port: string;
  /** `/docs/intro.html`; for addresses without a host, everything after the scheme. */
  readonly path: string;
  /** Without the `?`. */
  readonly query: string;
  /** Without the `#`. */
  readonly fragment: string;
}

/** One `name=value` pair of a query string, decoded. */
export interface QueryParam {
  name: string;
  value: string;
}

interface Reference {
  scheme: string | undefined;
  authority: string | undefined;
  path: string;
  query: string | undefined;
  fragment: string | undefined;
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = { http: "80", https: "443", ws: "80", wss: "443", ftp: "21" };
const HOST_SCHEMES = new Set(Object.keys(DEFAULT_PORTS));
const REFERENCE = /^(?:([a-zA-Z][a-zA-Z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

function splitReference(input: string): Reference | null {
  const match = REFERENCE.exec(input);
  if (!match) return null;
  return { scheme: match[1]?.toLowerCase(), authority: match[2], path: match[3] ?? "", query: match[4], fragment: match[5] };
}

/** RFC 3986 §5.2.4. */
function removeDotSegments(path: string): string {
  const output: string[] = [];
  const segments = path.split("/");
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const last = index === segments.length - 1;
    if (segment === ".") {
      if (last) output.push("");
    } else if (segment === "..") {
      if (output.length > 1) output.pop();
      if (last) output.push("");
    } else {
      output.push(segment);
    }
  }
  return output.join("/");
}

/** RFC 3986 §5.2.3. */
function mergePaths(base: Reference, path: string): string {
  if (base.authority !== undefined && base.path === "") return `/${path}`;
  const slash = base.path.lastIndexOf("/");
  return slash < 0 ? path : base.path.slice(0, slash + 1) + path;
}

/** RFC 3986 §5.2.2. */
function resolveReference(reference: Reference, base: Reference): Reference {
  if (reference.scheme !== undefined) return { ...reference, path: removeDotSegments(reference.path) };
  if (reference.authority !== undefined) return { ...reference, scheme: base.scheme, path: removeDotSegments(reference.path) };
  if (reference.path === "") {
    return { ...base, query: reference.query ?? base.query, fragment: reference.fragment };
  }
  const path = reference.path.startsWith("/") ? reference.path : mergePaths(base, reference.path);
  return { ...base, path: removeDotSegments(path), query: reference.query, fragment: reference.fragment };
}

/** Percent-encodes what a browser would (spaces, controls, non-ASCII) and leaves existing escapes alone. */
function encodeLoose(text: string): string {
  return text.replace(/[^\x21-\x7e]+|["<>`]/gu, (chunk) => {
    try {
      return encodeURIComponent(chunk);
    } catch {
      return "";
    }
  });
}

function toWebUrl(reference: Reference): WebUrl | null {
  const scheme = reference.scheme;
  if (!scheme) return null;
  let userinfo = "";
  let hostname = "";
  let port = "";
  if (reference.authority !== undefined) {
    let hostPort = reference.authority;
    const at = hostPort.lastIndexOf("@");
    if (at >= 0) {
      userinfo = hostPort.slice(0, at);
      hostPort = hostPort.slice(at + 1);
    }
    const match = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(hostPort);
    if (!match) return null;
    hostname = match[1]!.toLowerCase();
    port = match[2] ?? "";
    if (port === DEFAULT_PORTS[scheme]) port = "";
  }
  if (HOST_SCHEMES.has(scheme) && !hostname) return null;
  let path = encodeLoose(reference.path);
  if (hostname && !path.startsWith("/")) path = `/${path}`;
  return {
    scheme,
    userinfo,
    hostname,
    port,
    path,
    query: encodeLoose(reference.query ?? ""),
    fragment: encodeLoose(reference.fragment ?? ""),
  };
}

function toReference(url: WebUrl): Reference {
  const hostPort = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  return {
    scheme: url.scheme,
    authority: url.hostname ? (url.userinfo ? `${url.userinfo}@${hostPort}` : hostPort) : undefined,
    path: url.path,
    query: url.query || undefined,
    fragment: url.fragment || undefined,
  };
}

/**
 * Parses an absolute address, or resolves a relative one (`../a.html`,
 * `?page=2`, `//cdn.example/x`) against `base`. Null when it isn't one.
 */
export function parseUrl(input: string, base?: string | WebUrl): WebUrl | null {
  const reference = splitReference(input.trim().replace(/[\t\n\r]/g, ""));
  if (!reference) return null;
  if (reference.scheme !== undefined) return toWebUrl(resolveReference(reference, reference));
  if (base === undefined) return null;
  const baseUrl = typeof base === "string" ? parseUrl(base) : base;
  if (!baseUrl) return null;
  return toWebUrl(resolveReference(reference, toReference(baseUrl)));
}

/** The address as text: `https://example.com/a?b#c`. */
export function formatUrl(url: WebUrl): string {
  const reference = toReference(url);
  let text = `${url.scheme}:`;
  if (reference.authority !== undefined) text += `//${reference.authority}`;
  text += url.path;
  if (url.query) text += `?${url.query}`;
  if (url.fragment) text += `#${url.fragment}`;
  return text;
}

function decodeQueryPart(text: string): string {
  const spaced = text.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** The pairs of a query string (without its `?`), decoded as forms encode them. */
export function queryParams(query: string): QueryParam[] {
  if (!query) return [];
  return query
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const equals = pair.indexOf("=");
      return equals < 0
        ? { name: decodeQueryPart(pair), value: "" }
        : { name: decodeQueryPart(pair.slice(0, equals)), value: decodeQueryPart(pair.slice(equals + 1)) };
    });
}

/** The first value for `name` in a query string, or null. */
export function queryParam(query: string, name: string): string | null {
  return queryParams(query).find((param) => param.name === name)?.value ?? null;
}

/** A query string (without its `?`) for these pairs. */
export function encodeQuery(params: readonly QueryParam[]): string {
  return params.map((param) => `${encodeURIComponent(param.name)}=${encodeURIComponent(param.value)}`).join("&");
}
