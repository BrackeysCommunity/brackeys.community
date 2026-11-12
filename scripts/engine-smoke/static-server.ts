/**
 * A minimal static file server for the export smoke: what a plain static
 * host does and nothing more. Files under `dir` are served at `mount` with
 * their MIME type; a directory URL ending in `/` serves its `index.html`;
 * everything else is a 404: no fallback page, no redirects, no compression,
 * and `Cache-Control: no-store`, so a page that works offline does so
 * through its service worker and never the HTTP cache.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";

/** Content types by lower-case extension; anything else is `application/octet-stream`. */
export const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export const DEFAULT_MIME = "application/octet-stream";

export function contentType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? DEFAULT_MIME;
}

/** `mount` as the server matches it: leading and trailing slash, so "games/t" is "/games/t/". */
export function normalizeMount(mount: string): string {
  const trimmed = mount.replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

/**
 * The file a request path names under `dir` mounted at `mount`, or null when
 * it names none: outside the mount, a `.`, `..`, empty or encoded-slash
 * segment, or a bad escape. The query and fragment are ignored. A path
 * ending in `/` names that directory's `index.html`.
 */
export function resolveRequestPath(dir: string, mount: string, urlPath: string): string | null {
  const prefix = normalizeMount(mount);
  const path = urlPath.split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const segments: string[] = [];
  for (const raw of rest.split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === "." || segment === ".." || /[/\\]/.test(segment) || segment.includes("\0"))
      return null;
    segments.push(segment);
  }
  if (segments.at(-1) === "") segments[segments.length - 1] = "index.html";
  if (segments.some((s) => s === "")) return null;
  const root = resolve(dir);
  const file = resolve(join(root, ...segments));
  return file.startsWith(root + sep) ? file : null;
}

/** One request the server answered. */
export type ServedRequest = { method: string; path: string; status: number };

export type StaticServer = {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  /** The mount's URL: the page to open. */
  url: string;
  port: number;
  mount: string;
  /** Every request so far, in arrival order. */
  readonly served: readonly ServedRequest[];
  close(): Promise<void>;
};

export type StaticServerOptions = {
  dir: string;
  /** Default "/". */
  mount?: string;
  /** Default "127.0.0.1". */
  host?: string;
  /** Default 0: a free port the OS picks. */
  port?: number;
};

async function answer(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string,
  mount: string,
): Promise<number> {
  const send = (status: number, text: string) => {
    res.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : text);
    return status;
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return send(405, "method not allowed\n");
  }
  const file = resolveRequestPath(dir, mount, req.url ?? "/");
  if (!file) return send(404, "not found\n");
  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) return send(404, "not found\n");
    size = info.size;
  } catch {
    return send(404, "not found\n");
  }
  res.writeHead(200, {
    "Content-Type": contentType(file),
    "Content-Length": size,
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") {
    res.end();
    return 200;
  }
  await new Promise<void>((done) => {
    const stream = createReadStream(file);
    stream.once("error", () => {
      res.destroy();
      done();
    });
    stream.once("end", done);
    stream.pipe(res);
  });
  return 200;
}

/** Serves `dir` at `mount` until `close()`. */
export async function serveStatic(opts: StaticServerOptions): Promise<StaticServer> {
  const mount = normalizeMount(opts.mount ?? "/");
  const host = opts.host ?? "127.0.0.1";
  const served: ServedRequest[] = [];
  const server = createServer((req, res) => {
    const entry: ServedRequest = { method: req.method ?? "", path: req.url ?? "", status: 0 };
    served.push(entry);
    answer(req, res, opts.dir, mount).then(
      (status) => (entry.status = status),
      () => {
        entry.status = 500;
        if (!res.headersSent) res.writeHead(500);
        res.end();
      },
    );
  });
  await new Promise<void>((ready, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, host, () => {
      server.off("error", fail);
      ready();
    });
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://${host}:${port}`;
  let closing: Promise<void> | null = null;
  return {
    origin,
    url: `${origin}${mount}`,
    port,
    mount,
    served,
    close: () =>
      (closing ??= new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      })),
  };
}
