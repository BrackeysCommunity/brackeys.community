/** An inclusive byte range, as HTTP's `Range` names it. */
export type ByteRange = { start: number; end: number };

/** Where streamed objects come from: the site's bucket, or memory in tests. */
export type StoredObjectSource = {
  /** Null when the object doesn't exist. */
  stat(key: string): Promise<{ size: number; etag?: string; contentType?: string } | null>;
  /** The object's bytes, or the range of them; null when it doesn't exist. */
  stream(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array> | null>;
};

export type StreamStoredObjectOptions = {
  source: StoredObjectSource;
  cacheControl?: string;
  /** Wins over the type the object was stored with. */
  contentType?: string;
  /** Set on every response, 304 and errors included; an `etag` here wins over the object's. */
  headers?: HeadersInit;
};

const IMMUTABLE = "public, max-age=31536000, immutable";

const notFound = (headers?: HeadersInit) =>
  new Response("Not Found", { status: 404, headers: new Headers(headers) });

const opaqueTag = (tag: string) => tag.trim().replace(/^W\//, "").replace(/^"|"$/g, "");

/** Whether `If-None-Match` names this etag (weak comparison, as RFC 9110 asks for it). */
function matchesNoneMatch(header: string, etag: string): boolean {
  if (header.trim() === "*") return true;
  const tag = opaqueTag(etag);
  return header.split(",").some((candidate) => opaqueTag(candidate) === tag);
}

/**
 * The single range a `Range` header asks for: a range, "unsatisfiable", or
 * null to serve the whole object (no header, another unit, several ranges).
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^\s*bytes\s*=\s*(.*)$/i.exec(header);
  if (!match) return null;
  const spec = match[1]!.trim();
  if (spec.includes(",")) return null;
  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return "unsatisfiable";
  const [, first = "", last = ""] = parts;
  if (first === "" && last === "") return "unsatisfiable";
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size || (last !== "" && Number(last) < start)) return "unsatisfiable";
  return { start, end };
}

/**
 * Serve a stored object: `HEAD`, `If-None-Match` (304) and a single `Range`
 * (206, or 416 when it can't be satisfied). The caller has already decided
 * the key may be served.
 */
export async function streamStoredObject(
  key: string,
  request: Request,
  opts: StreamStoredObjectOptions,
): Promise<Response> {
  const stat = await opts.source.stat(key);
  if (!stat) return notFound(opts.headers);

  const headers = new Headers(opts.headers);
  if (!headers.has("cache-control")) headers.set("cache-control", opts.cacheControl ?? IMMUTABLE);
  const contentType = opts.contentType ?? stat.contentType;
  if (contentType) headers.set("content-type", contentType);
  if (!headers.has("etag") && stat.etag) headers.set("etag", `"${opaqueTag(stat.etag)}"`);
  headers.set("accept-ranges", "bytes");
  const etag = headers.get("etag");

  const ifNoneMatch = request.headers.get("if-none-match");
  if (etag && ifNoneMatch && matchesNoneMatch(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }

  const ifRange = request.headers.get("if-range");
  const rangeHeader =
    ifRange && !(etag && opaqueTag(ifRange) === opaqueTag(etag))
      ? null
      : request.headers.get("range");
  const range = parseRange(rangeHeader, stat.size);
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${stat.size}`);
    return new Response(null, { status: 416, headers });
  }

  const status = range ? 206 : 200;
  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${stat.size}`);
    headers.set("content-length", String(range.end - range.start + 1));
  } else {
    headers.set("content-length", String(stat.size));
  }

  if (request.method === "HEAD") return new Response(null, { status, headers });

  let body: ReadableStream<Uint8Array> | null;
  try {
    body = await opts.source.stream(key, range ?? undefined);
  } catch (error) {
    console.error("Failed to stream stored object", { key, error });
    return notFound(opts.headers);
  }
  if (!body) return notFound(opts.headers);
  return new Response(body, { status, headers });
}
