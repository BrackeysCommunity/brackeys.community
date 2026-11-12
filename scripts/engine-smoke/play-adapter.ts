/**
 * The site's side of the play-frame smoke, without a browser: builds are
 * uploaded through the real release protocol (`release-upload.ts`) into a
 * PGlite database and a `memoryReleaseStore`, and served by the real frame
 * route (`createFrameRoute`) behind a `node:http` adapter, as `frames.$.ts`
 * serves them on the site.
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { parseReleaseManifest, RELEASE_FILE } from "@jams/engine/project";

import { engineProjects } from "@/db/schema";
import { frameBase } from "@/lib/engine/frame-csp";
import { createFrameRoute } from "@/lib/engine/frame-route";
import { memoryReleaseStore, type ReleaseObjectStore } from "@/lib/engine/release-storage";
import {
  beginRelease,
  commitRelease,
  putReleaseFile,
  type Actor,
  type ReleaseDeps,
  type ReleaseTxDb,
} from "@/lib/engine/release-upload";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

import type { ServedRequest } from "./static-server";

// ─── node:http over a fetch handler ──────────────────────

/** A `Request` for what came in on `origin`; a body only for methods that carry one. */
export async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const method = req.method ?? "GET";
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = new Uint8Array(Buffer.concat(chunks));
  }
  return new Request(new URL(req.url ?? "/", origin), {
    method,
    headers,
    ...(body ? { body } : {}),
  });
}

/** Writes `response` to `res`: its status, every header and, unless the request was HEAD, its body. */
export async function writeResponse(
  res: ServerResponse,
  response: Response,
  head: boolean,
): Promise<void> {
  const bytes = head || !response.body ? null : Buffer.from(await response.arrayBuffer());
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  if (bytes && !("content-length" in headers)) headers["content-length"] = String(bytes.length);
  res.writeHead(response.status, headers);
  res.end(bytes ?? undefined);
}

export type HandlerServer = {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  port: number;
  /** Every request so far, in arrival order, the query kept. */
  readonly served: readonly ServedRequest[];
  close(): Promise<void>;
};

/** Serves `handler` until `close()`; a handler that throws answers 500. */
export async function serveHandler(
  handler: (request: Request) => Promise<Response>,
  opts: { host?: string; port?: number } = {},
): Promise<HandlerServer> {
  const host = opts.host ?? "127.0.0.1";
  const served: ServedRequest[] = [];
  let origin = "";
  const server = createServer((req, res) => {
    const entry: ServedRequest = { method: req.method ?? "", path: req.url ?? "", status: 0 };
    served.push(entry);
    void (async () => {
      try {
        const response = await handler(await toRequest(req, origin));
        entry.status = response.status;
        await writeResponse(res, response, req.method === "HEAD");
      } catch {
        entry.status = 500;
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    })();
  });
  await new Promise<void>((ready, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, host, () => {
      server.off("error", fail);
      ready();
    });
  });
  const { port } = server.address() as AddressInfo;
  origin = `http://${host}:${port}`;
  let closing: Promise<void> | null = null;
  return {
    origin,
    port,
    served,
    close: () =>
      (closing ??= new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      })),
  };
}

// ─── The hosted releases ─────────────────────────────────

/** The account every smoke release is uploaded as: staff, so no team or role lookup runs. */
export const SMOKE_PUBLISHER: Actor = { kind: "staff", userId: "play-smoke" };

/** What the smoke uploads into: the tests' PGlite database and an in-memory object store. */
export type SmokeSite = {
  db: TestDb;
  store: ReleaseObjectStore;
  deps: ReleaseDeps;
};

/** A fresh migrated PGlite database with the publisher seeded, and an empty object store. */
export async function createSmokeSite(): Promise<SmokeSite> {
  const db = await createTestDb();
  await seedUser(db, SMOKE_PUBLISHER.userId, { guildRoles: ["Staff"] });
  const store = memoryReleaseStore();
  return {
    db,
    store,
    deps: {
      db: db as unknown as ReleaseTxDb,
      store,
      rateLimit: async () => true,
      scan: async () => {},
    },
  };
}

export type PublishedRelease = {
  projectId: string;
  gameId: string;
  releaseId: string;
  version: number;
  /** How many files `begin` listed as missing, each sent with `putReleaseFile`. */
  uploaded: number;
};

/**
 * A built directory uploaded as its project's next release: the project row
 * (public, so `/frames/` serves it), then `begin`, every missing file read
 * from `dir`, and `commit`.
 */
export async function publishBuild(site: SmokeSite, dir: string): Promise<PublishedRelease> {
  const manifest = await readFile(join(dir, RELEASE_FILE), "utf8");
  const parsed = parseReleaseManifest(manifest);
  if (!parsed.ok) throw new Error(`${dir}/${RELEASE_FILE} doesn't parse`);
  const { project, game } = parsed.manifest;
  await site.db
    .insert(engineProjects)
    .values({
      projectId: project.id,
      name: project.id,
      game: game.id,
      createdById: SMOKE_PUBLISHER.userId,
      visibility: "public",
    })
    .onConflictDoNothing();
  const begun = await beginRelease(site.deps, {
    projectId: project.id,
    manifest,
    actor: SMOKE_PUBLISHER,
  });
  for (const file of begun.missing)
    await putReleaseFile(site.deps, {
      uploadId: begun.uploadId,
      sha256: file.sha256,
      body: new Uint8Array(await readFile(join(dir, file.path))),
      actor: SMOKE_PUBLISHER,
    });
  const committed = await commitRelease(site.deps, {
    uploadId: begun.uploadId,
    actor: SMOKE_PUBLISHER,
  });
  return {
    projectId: project.id,
    gameId: game.id,
    releaseId: committed.releaseId,
    version: committed.version,
    uploaded: begun.missing.length,
  };
}

/** The frame route over the smoke's site, on its own origin, framed only by `hostOrigin`. */
export async function serveFrames(site: SmokeSite, hostOrigin: string): Promise<HandlerServer> {
  let origin = "";
  const route = createFrameRoute({
    store: site.store,
    db: site.db,
    allowed: () => true,
    playHostOrigin: null,
    playOrigin: () => origin,
    siteOrigin: () => hostOrigin,
    syncOrigin: () => null,
  });
  const server = await serveHandler((request) => route(request, "frames"));
  origin = server.origin;
  return server;
}

/** A public release's directory on the frame server, with a trailing slash. */
export const releaseDir = (frames: Pick<HandlerServer, "origin">, releaseId: string): string =>
  frameBase(releaseId, undefined, frames.origin);
