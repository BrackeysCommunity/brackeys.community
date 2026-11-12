import { hashForPut, isSha256, sha256, type ContentStore, type Sha256 } from "../../project/index";
import type { SceneIssue } from "../../scene/index";
import type { ProjectBlobs, UploadedBlob } from "../host";

/** A refused upload or read: the server's issue (`hash-mismatch`, `asset-too-large`, `quota-exceeded`…) when it sent one. */
export class BlobRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue?: SceneIssue,
  ) {
    super(message);
    this.name = "BlobRouteError";
  }
}

/** Bytes just uploaded, kept so the inspection that follows needn't fetch them back. */
const RECENT = 16;

async function refusal(response: Response, fallback: string): Promise<BlobRouteError> {
  const body = (await response.json().catch(() => null)) as {
    issue?: SceneIssue;
    message?: string;
    error?: string;
  } | null;
  const message = body?.issue?.message ?? body?.message ?? body?.error ?? fallback;
  return new BlobRouteError(message, response.status, body?.issue);
}

type PostInit = { headers: Record<string, string>; body: Uint8Array };

/** `fetch` has no upload progress; a request posts through XHR so the bytes sent are reported. */
function postWithProgress(
  route: string,
  { headers, body }: PostInit,
  onSent: (sent: number) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", route);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => onSent(e.loaded);
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status > 599) {
        reject(new BlobRouteError(`The upload failed (${xhr.status}).`, xhr.status));
        return;
      }
      const empty = xhr.status === 204 || xhr.status === 205 || xhr.status === 304;
      resolve(
        new Response(empty ? null : xhr.responseText, {
          status: xhr.status,
          headers: { "content-type": xhr.getResponseHeader("content-type") ?? "" },
        }),
      );
    };
    xhr.onerror = () => reject(new BlobRouteError("The upload didn't reach the server.", 0));
    xhr.onabort = () => reject(new BlobRouteError("The upload was cancelled.", 0));
    xhr.send(body as XMLHttpRequestBodyInit);
  });
}

/**
 * A project's blob route: `POST <route>` stores bytes and `GET
 * <route>/<sha256>` reads them back. An upload reports its progress once it
 * has hashed the bytes, as they are sent when the browser can tell (no
 * `fetcher` given), and when the server has stored them.
 */
export function projectBlobs(route: string, fetcher?: typeof fetch): ProjectBlobs {
  const get = fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const tracked = !fetcher && typeof XMLHttpRequest !== "undefined";
  const recent = new Map<Sha256, Uint8Array>();
  const remember = (hash: Sha256, bytes: Uint8Array) => {
    recent.delete(hash);
    recent.set(hash, bytes);
    for (const old of recent.keys()) {
      if (recent.size <= RECENT) break;
      recent.delete(old);
    }
  };

  return {
    async upload(bytes, opts = {}) {
      const total = bytes.byteLength;
      const expect = await sha256(bytes);
      const headers: Record<string, string> = {
        "content-type": opts.contentType || "application/octet-stream",
        "x-expect-sha256": expect,
      };
      if (opts.kind) headers["x-asset-kind"] = opts.kind;
      opts.onProgress?.(0, total);
      const onSent = (sent: number) => {
        if (sent > 0 && sent < total) opts.onProgress?.(sent, total);
      };
      const response = tracked
        ? await postWithProgress(route, { headers, body: bytes }, onSent)
        : await get(route, {
            method: "POST",
            headers,
            body: bytes as BodyInit,
            credentials: "same-origin",
          });
      if (!response.ok) throw await refusal(response, `The upload failed (${response.status}).`);
      const answer = (await response.json()) as Partial<UploadedBlob>;
      if (answer.sha256 !== expect || answer.bytes !== total)
        throw new BlobRouteError("The server stored different bytes than were sent.", 409);
      remember(expect, bytes);
      opts.onProgress?.(total, total);
      return { sha256: expect, bytes: total };
    },
    async read(hash) {
      if (!isSha256(hash)) return null;
      const held = recent.get(hash);
      if (held) return held;
      const response = await get(`${route}/${hash}`, { credentials: "same-origin" });
      if (response.status === 404) return null;
      if (!response.ok)
        throw await refusal(response, `Reading ${hash} failed (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

/** `blobs` as the content store a project session inspects blob ops' bytes with. */
export function blobContentStore(blobs: ProjectBlobs): ContentStore {
  return {
    has: async (hash) => (await blobs.read(hash)) !== null,
    get: (hash) => blobs.read(hash),
    async put(bytes, expect) {
      await hashForPut(bytes, expect);
      return (await blobs.upload(bytes)).sha256;
    },
  };
}
