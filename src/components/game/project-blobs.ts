import {
  hashForPut,
  isSha256,
  sha256,
  type AssetKindName,
  type ContentStore,
  type ProjectId,
  type Sha256,
} from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";

import { DEV_PROJECT_ROUTE } from "./scene-collab";

/** Where a project's blobs live: the dev server's project route, or the site's engine route. */
export type BlobHost = { kind: "dev" | "hosted"; project: ProjectId };

export type UploadedBlob = { sha256: Sha256; bytes: number };

/** A project's blob route as the editor uses it. */
export type ProjectBlobs = {
  /** Stores `bytes`, refused unless the server hashes them as this client did. */
  upload(
    bytes: Uint8Array,
    opts?: { kind?: AssetKindName; contentType?: string },
  ): Promise<UploadedBlob>;
  read(hash: Sha256): Promise<Uint8Array | null>;
};

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

export function blobRoute({ kind, project }: BlobHost): string {
  const id = encodeURIComponent(project);
  return kind === "dev" ? `${DEV_PROJECT_ROUTE}/${id}/blob` : `/api/engine/projects/${id}/blobs`;
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

/** The blob route of `host`, over `fetch`. */
export function projectBlobs(host: BlobHost, fetcher: typeof fetch = fetch): ProjectBlobs {
  const route = blobRoute(host);
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
      const expect = await sha256(bytes);
      const headers: Record<string, string> = {
        "content-type": opts.contentType || "application/octet-stream",
        "x-expect-sha256": expect,
      };
      if (opts.kind) headers["x-asset-kind"] = opts.kind;
      const response = await fetcher(route, {
        method: "POST",
        headers,
        body: bytes as BodyInit,
        credentials: "same-origin",
      });
      if (!response.ok) throw await refusal(response, `The upload failed (${response.status}).`);
      const answer = (await response.json()) as Partial<UploadedBlob>;
      if (answer.sha256 !== expect || answer.bytes !== bytes.byteLength)
        throw new BlobRouteError("The server stored different bytes than were sent.", 409);
      remember(expect, bytes);
      return { sha256: expect, bytes: bytes.byteLength };
    },
    async read(hash) {
      if (!isSha256(hash)) return null;
      const held = recent.get(hash);
      if (held) return held;
      const response = await fetcher(`${route}/${hash}`, { credentials: "same-origin" });
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
