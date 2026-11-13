/**
 * The site's side of the play-frame smoke, without a browser: builds are
 * uploaded through the real release protocol (`release-upload.ts`) into a
 * PGlite database and a `memoryReleaseStore`, and served by the real frame
 * route (`createFrameRoute`) behind a `node:http` adapter, as `frames.$.ts`
 * serves them on the site. The host page's origin also answers the real save
 * routes (`createSaveRoutes`) for a test player whose session the smoke
 * mints in that same database, and a game's own save server is a stub on
 * its own HTTPS origin.
 */
import { createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { parseReleaseManifest, RELEASE_FILE } from "@jams/engine/project";
import { and, count, eq, gt } from "drizzle-orm";

import { engineProjects, engineSaves, session, user } from "@/db/schema";
import { frameBase } from "@/lib/engine/frame-csp";
import { createFrameRoute } from "@/lib/engine/frame-route";
import type { SaveMode } from "@/lib/engine/host-server";
import { promote } from "@/lib/engine/release-channels";
import { memoryReleaseStore, type ReleaseObjectStore } from "@/lib/engine/release-storage";
import {
  beginRelease,
  commitRelease,
  putReleaseFile,
  type Actor,
  type ReleaseDeps,
  type ReleaseTxDb,
} from "@/lib/engine/release-upload";
import type { ReadSession } from "@/lib/engine/route-gate";
import { createSaveRoutes } from "@/lib/engine/save-routes";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

import { contentType, resolveRequestPath, type ServedRequest } from "./static-server";

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

/**
 * A migrated PGlite database (a fresh one unless given) with the publisher
 * seeded, and an empty object store.
 */
export async function createSmokeSite(db?: TestDb): Promise<SmokeSite> {
  db ??= await createTestDb();
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

/** Where a published project saves, as its game settings say. */
export type SmokeProjectSettings = {
  /** Default "site". */
  saveMode?: SaveMode;
  /** The origins the frame's CSP lets the game connect to; default none. */
  connectOrigins?: readonly string[];
};

/**
 * A built directory uploaded as its project's next release and made its
 * production release, as a released game is: the project row (public, so
 * `/frames/` serves it, with `settings`), then `begin`, every missing file
 * read from `dir`, `commit` and the promote.
 */
export async function publishBuild(
  site: SmokeSite,
  dir: string,
  settings: SmokeProjectSettings = {},
): Promise<PublishedRelease> {
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
      saveMode: settings.saveMode ?? "site",
      connectOrigins: [...(settings.connectOrigins ?? [])],
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
  await promote(
    {
      projectId: project.id,
      version: committed.version,
      channel: "production",
      actor: SMOKE_PUBLISHER,
    },
    { db: site.deps.db },
  );
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

// ─── The test player ─────────────────────────────────────

/** The cookie the smoke signs its player in with, as the site's session cookie would. */
export const SMOKE_SESSION_COOKIE = "jams-smoke-session";
/** The host page asks here who is signed in, as the play page knows from its loader. */
export const SMOKE_SESSION_PATH = "/smoke/session";

export type SmokePlayer = { userId: string; name: string; token: string };

/**
 * A player row and a session for it in the smoke's own database: no
 * password and no sign-in flow, just a token the browser carries as
 * `SMOKE_SESSION_COOKIE`.
 */
export async function createSmokePlayer(site: SmokeSite): Promise<SmokePlayer> {
  const userId = "play-smoke-player";
  await seedUser(site.db, userId);
  const token = randomBytes(24).toString("hex");
  const now = new Date();
  await site.db.insert(session).values({
    id: randomBytes(12).toString("hex"),
    token,
    userId,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    createdAt: now,
    updatedAt: now,
  });
  return { userId, name: userId, token };
}

function cookieOf(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

/** The session `SMOKE_SESSION_COOKIE` names, if it is live in the smoke's database. */
export function smokeReadSession(site: SmokeSite): ReadSession {
  return async (request) => {
    const token = cookieOf(request, SMOKE_SESSION_COOKIE);
    if (!token) return null;
    const [row] = await site.db
      .select({ id: session.userId })
      .from(session)
      .where(and(eq(session.token, token), gt(session.expiresAt, new Date())))
      .limit(1);
    return row ? { user: { id: row.id } } : null;
  };
}

/** How many saves the player's account holds, by the save API's own rows. */
export async function accountSaveCount(site: SmokeSite, userId: string): Promise<number> {
  const [row] = await site.db
    .select({ n: count() })
    .from(engineSaves)
    .where(eq(engineSaves.userId, userId));
  return row?.n ?? 0;
}

// ─── The host page's origin ──────────────────────────────

export type HostSiteServer = HandlerServer & {
  /** The origin with a trailing slash: where the host page's files are. */
  url: string;
};

const noStoreText = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

async function staticFile(dir: string, request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return noStoreText(405, "");
  const file = resolveRequestPath(dir, "/", new URL(request.url).pathname);
  if (!file) return noStoreText(404, "not found\n");
  try {
    if (!(await stat(file)).isFile()) return noStoreText(404, "not found\n");
  } catch {
    return noStoreText(404, "not found\n");
  }
  return new Response(new Uint8Array(await readFile(file)), {
    headers: { "content-type": contentType(file), "cache-control": "no-store" },
  });
}

/**
 * The play page's origin: the host page's files from `dir`, the site's save
 * routes over the smoke's database and object store, and who is signed in
 * at `SMOKE_SESSION_PATH`. The session is the smoke's own; the save rules,
 * caps and refusals are the site's.
 */
export async function serveHostSite(site: SmokeSite, dir: string): Promise<HostSiteServer> {
  const readSession = smokeReadSession(site);
  const saveRoutes = createSaveRoutes({
    readSession,
    saves: { db: site.deps.db, store: site.store, rateLimit: async () => true },
    gamesOpen: async () => true,
  });
  const server = await serveHandler(async (request) => {
    const saved = await saveRoutes(request);
    if (saved) return saved;
    if (new URL(request.url).pathname === SMOKE_SESSION_PATH) {
      const who = await readSession(request);
      if (!who) return Response.json({ user: null }, { headers: { "cache-control": "no-store" } });
      const [row] = await site.db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, who.user.id))
        .limit(1);
      return Response.json(
        { user: { id: who.user.id, name: row?.name ?? null } },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return staticFile(dir, request);
  });
  return { ...server, url: `${server.origin}/` };
}

// ─── A game's own save server ────────────────────────────

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const n = body.length;
  const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return Buffer.concat([Buffer.from([tag, ...length]), body]);
}

const derSequence = (...parts: Buffer[]) => der(0x30, ...parts);

function derOid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const bytes = [40 * first + second];
  for (const n of rest) {
    const digits = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) digits.unshift((v & 0x7f) | 0x80);
    bytes.push(...digits);
  }
  return der(0x06, Buffer.from(bytes));
}

const derUtcTime = (d: Date) =>
  der(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`));

/**
 * A throwaway self-signed certificate for 127.0.0.1 (P-256, a week long),
 * made here so no key is ever committed. Browsers take it only because the
 * smoke's contexts ignore certificate errors.
 */
export function loopbackCertificate(now = new Date()): { cert: string; key: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ecdsaSha256 = derSequence(derOid("1.2.840.10045.4.3.2"));
  const name = derSequence(
    der(0x31, derSequence(derOid("2.5.4.3"), der(0x0c, Buffer.from("127.0.0.1")))),
  );
  const day = 24 * 60 * 60_000;
  const loopbackSan = derSequence(
    derSequence(
      derOid("2.5.29.17"),
      der(0x04, derSequence(der(0x87, Buffer.from([127, 0, 0, 1])))),
    ),
  );
  // Random and positive: Firefox refuses a second certificate with the same issuer and serial.
  const serial = randomBytes(8);
  serial[0] = (serial[0]! & 0x7f) | 0x01;
  const tbs = derSequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    ecdsaSha256,
    name,
    derSequence(
      derUtcTime(new Date(now.getTime() - day)),
      derUtcTime(new Date(now.getTime() + 7 * day)),
    ),
    name,
    createPublicKey(privateKey).export({ type: "spki", format: "der" }),
    der(0xa3, loopbackSan),
  );
  const signature = sign("sha256", tbs, privateKey);
  const cert = derSequence(tbs, ecdsaSha256, der(0x03, Buffer.from([0]), signature));
  const lines = cert.toString("base64").match(/.{1,64}/g) ?? [];
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  };
}

/** One request a save stub answered, its body kept. */
export type StubRequest = { method: string; path: string; body: string };

export type SaveStubServer = {
  /** `https://127.0.0.1:<port>` */
  origin: string;
  readonly received: readonly StubRequest[];
  /** The save texts it holds, by `<gameId>/<slot>`. */
  readonly saves: ReadonlyMap<string, string>;
  close(): Promise<void>;
};

const STUB_SAVE_PATH = /^\/saves\/([^/]+)(?:\/([^/]+)(\/remove)?)?$/;

/**
 * A game's own save server on its own HTTPS origin: `POST /saves/<game>/<slot>`
 * keeps a text, `GET` the same path reads it, `GET /saves/<game>` lists the
 * game's texts and `POST …/remove` drops one. Every answer allows any origin,
 * since a sandboxed frame's is opaque; everything is recorded.
 */
export async function serveSaveStub(): Promise<SaveStubServer> {
  const received: StubRequest[] = [];
  const saves = new Map<string, string>();
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  };
  const server = createHttpsServer(loopbackCertificate(), (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = req.url ?? "/";
      const body = Buffer.concat(chunks).toString("utf8");
      received.push({ method: req.method ?? "", path, body });
      const send = (status: number, text: string, type = "text/plain; charset=utf-8") => {
        res.writeHead(status, { ...cors, "content-type": type });
        res.end(text);
      };
      if (req.method === "OPTIONS") return send(204, "");
      const match = STUB_SAVE_PATH.exec(path.split("?", 1)[0] ?? "");
      if (!match) return send(404, "not found\n");
      const [, game = "", slot, remove] = match;
      if (slot === undefined) {
        if (req.method !== "GET") return send(405, "");
        const listed = [...saves]
          .filter(([key]) => key.startsWith(`${game}/`))
          .map(([key, text]) => ({ slot: key.slice(game.length + 1), text }));
        return send(200, JSON.stringify(listed), "application/json");
      }
      const key = `${game}/${slot}`;
      if (remove) {
        saves.delete(key);
        return send(204, "");
      }
      if (req.method === "POST") {
        saves.set(key, body);
        return send(200, "");
      }
      if (req.method === "GET") {
        const text = saves.get(key);
        return text === undefined ? send(404, "") : send(200, text, "application/json");
      }
      return send(405, "");
    });
  });
  await new Promise<void>((ready, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", fail);
      ready();
    });
  });
  const { port } = server.address() as AddressInfo;
  let closing: Promise<void> | null = null;
  return {
    origin: `https://127.0.0.1:${port}`,
    received,
    saves,
    close: () =>
      (closing ??= new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      })),
  };
}
