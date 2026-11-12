import type { ReleaseFile } from "@jams/engine/project";

import { env } from "@/env";
import {
  getMinioClient,
  isMissingObject,
  minioObjectSource,
  type StoredObjectClient,
} from "@/lib/profile-project-image-storage";
import type { ByteRange } from "@/lib/stored-object-stream";

/** Where release files live: the site's bucket, or memory in tests. */
export type ReleaseObjectStore = {
  stat(key: string): Promise<{ size: number } | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The object's bytes, or the inclusive range of them; null when it doesn't exist. */
  stream(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array> | null>;
  /** A missing object is not an error. */
  remove(key: string): Promise<void>;
};

/** The bucket calls a release store makes; the site's MinIO client has them. */
export type ReleaseObjectClient = StoredObjectClient & {
  putObject(
    bucket: string,
    key: string,
    body: Buffer,
    size: number,
    meta: Record<string, string>,
  ): Promise<unknown>;
  removeObject(bucket: string, key: string): Promise<void>;
};

/** Release objects in a bucket; `minioReleaseStore` is this over the site's client and bucket. */
export function minioReleaseStoreFor(
  opts: { client?: ReleaseObjectClient; bucket?: string } = {},
): ReleaseObjectStore {
  const client = (): ReleaseObjectClient => opts.client ?? getMinioClient();
  const bucket = () => {
    const name = opts.bucket ?? env.MINIO_BUCKET;
    if (!name) throw new Error("MINIO_BUCKET is required for engine releases.");
    return name;
  };
  const source = minioObjectSource({
    ...(opts.client ? { client: opts.client } : {}),
    ...(opts.bucket ? { bucket: opts.bucket } : {}),
  });
  return {
    stat: (key) => source.stat(key),
    stream: (key, range) => source.stream(key, range),
    async put(key, bytes, contentType) {
      const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      await client().putObject(bucket(), key, body, body.byteLength, {
        "Content-Type": contentType,
      });
    },
    async remove(key) {
      try {
        await client().removeObject(bucket(), key);
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    },
  };
}

/** The site's bucket, through `getMinioClient()`. */
export const minioReleaseStore: ReleaseObjectStore = minioReleaseStoreFor();

/** Objects held in this process, for tests; `objects` shows what was stored. */
export function memoryReleaseStore(): ReleaseObjectStore & {
  objects: ReadonlyMap<string, { bytes: Uint8Array; contentType: string }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    async stat(key) {
      const object = objects.get(key);
      return object ? { size: object.bytes.byteLength, contentType: object.contentType } : null;
    },
    async put(key, bytes, contentType) {
      objects.set(key, { bytes: bytes.slice(), contentType });
    },
    async stream(key, range) {
      const object = objects.get(key);
      if (!object) return null;
      const bytes = range ? object.bytes.slice(range.start, range.end + 1) : object.bytes.slice();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

type Role = ReleaseFile["role"];

const SHA256 = "[0-9a-f]{64}";

/** The types a release asset may have, by extension: images, audio, fonts, and atlas and font data. */
const ASSET_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".json": "application/json",
  ".txt": "text/plain",
  ".fnt": "text/plain",
};

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
};

const isSafePath = (path: string): boolean =>
  !path.includes("\\") &&
  !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");

/**
 * The type a release file is served with, by its extension and role; null
 * when the site doesn't take it (another HTML file, SVG, a path outside the
 * role's folder, an uppercase extension). The type is decided here, at
 * upload, and never read back from the object.
 */
export function contentTypeFor(path: string, role: Role): string | null {
  if (!isSafePath(path)) return null;
  const ext = extensionOf(path);
  switch (role) {
    case "shell":
      if (path === "index.html" || path === "credits.html") return "text/html";
      return path === "app.webmanifest" ? "application/manifest+json" : null;
    case "worker":
      return path === "sw.js" ? "text/javascript" : null;
    case "code":
      return path.startsWith("code/") && (ext === ".js" || ext === ".mjs")
        ? "text/javascript"
        : null;
    case "style":
      return path.startsWith("code/") && ext === ".css" ? "text/css" : null;
    case "wasm":
      return path.startsWith("code/") && ext === ".wasm" ? "application/wasm" : null;
    case "icon":
      return path === "icons/icon-192.png" || path === "icons/icon-512.png" ? "image/png" : null;
    case "data":
      return new RegExp(`^data/${SHA256}\\.json$`).test(path) ? "application/json" : null;
    case "asset": {
      if (!new RegExp(`^assets/${SHA256}\\.[a-z0-9]+$`).test(path)) return null;
      return Object.hasOwn(ASSET_TYPES, ext) ? (ASSET_TYPES[ext] ?? null) : null;
    }
    default:
      return null;
  }
}

/** The role each kind of path is served under; no path fits two. */
const ROLES: readonly Role[] = [
  "shell",
  "worker",
  "code",
  "style",
  "wasm",
  "icon",
  "data",
  "asset",
];

/** The type a path is served with under whichever role takes it; null when none does. */
export function contentTypeOfPath(path: string): string | null {
  for (const role of ROLES) {
    const type = contentTypeFor(path, role);
    if (type !== null) return type;
  }
  return null;
}

/** The hash a `data/<sha256>.json` or `assets/<sha256><ext>` name carries; null for other roles. */
const nameHashOf = (file: Pick<ReleaseFile, "path" | "role">): string | null => {
  if (file.role !== "data" && file.role !== "asset") return null;
  const name = file.path.slice(file.path.indexOf("/") + 1);
  return name.slice(0, 64);
};

/**
 * The first file of a list the site refuses: its type, a path differing
 * from another only in case, or a content-named file whose name isn't its
 * SHA-256. Null when every file is taken.
 */
export function refusedReleaseFile(
  files: readonly Pick<ReleaseFile, "path" | "role" | "sha256">[],
): string | null {
  const seen = new Set<string>();
  for (const file of files) {
    if (contentTypeFor(file.path, file.role) === null) return file.path;
    const named = nameHashOf(file);
    if (named !== null && named !== file.sha256) return file.path;
    const folded = file.path.toLowerCase();
    if (seen.has(folded)) return file.path;
    seen.add(folded);
  }
  return null;
}

/** How many leading bytes `checkLeadingBytes` reads for a binary type. */
export const LEADING_BYTES = 16;

const startsWith = (head: Uint8Array, bytes: readonly number[], at = 0): boolean =>
  head.byteLength >= at + bytes.length && bytes.every((b, i) => head[at + i] === b);

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/** An MPEG audio frame header: 11 sync bits, a known version and a known layer. */
const isMpegFrame = (head: Uint8Array): boolean => {
  const [first, second] = head;
  if (first !== 0xff || second === undefined || (second & 0xe0) !== 0xe0) return false;
  return ((second >> 3) & 0b11) !== 0b01 && ((second >> 1) & 0b11) !== 0b00;
};

const parsesAsJson = (body: Uint8Array): boolean => {
  try {
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether a file's first bytes are what its extension says it is. Types
 * without a signature (scripts, styles, HTML, the web manifest, text) pass;
 * an extension the site doesn't take fails. For `.json` the caller passes
 * the whole body, which must parse.
 */
export function checkLeadingBytes(path: string, head: Uint8Array): boolean {
  switch (extensionOf(path)) {
    case ".png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".jpg":
    case ".jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case ".webp":
      return startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8);
    case ".gif":
      return startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a"));
    case ".ogg":
      return startsWith(head, ascii("OggS"));
    case ".mp3":
      return startsWith(head, ascii("ID3")) || isMpegFrame(head);
    case ".wav":
      return startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WAVE"), 8);
    case ".m4a":
      return startsWith(head, ascii("ftyp"), 4);
    case ".flac":
      return startsWith(head, ascii("fLaC"));
    case ".webm":
      return startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]);
    case ".woff2":
      return startsWith(head, ascii("wOF2"));
    case ".woff":
      return startsWith(head, ascii("wOFF"));
    case ".ttf":
      return startsWith(head, [0x00, 0x01, 0x00, 0x00]) || startsWith(head, ascii("true"));
    case ".otf":
      return startsWith(head, ascii("OTTO"));
    case ".wasm":
      return startsWith(head, [0x00, 0x61, 0x73, 0x6d]);
    case ".json":
      return parsesAsJson(head);
    case ".html":
    case ".webmanifest":
    case ".js":
    case ".mjs":
    case ".css":
    case ".txt":
    case ".fnt":
      return true;
    default:
      return false;
  }
}
