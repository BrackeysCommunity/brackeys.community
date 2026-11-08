import { sha256 } from "@jams/engine/project";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { developerProfiles, engineAgentTokens, engineProjects } from "@/db/schema";
import { verifyCanvasToken } from "@/lib/canvas/token";
import type { TestDb } from "@/test/db";

import {
  AGENT_TOKEN_PREFIX,
  AgentTokenError,
  createAgentToken,
  exchangeAgentToken,
  listAgentTokens,
  revokeAgentToken,
} from "../agent-token";
import { AGENT_SYNC_TOKEN_PATH } from "../routes";
import { fakeMinio } from "./fake-minio";
import { engineRoutes, PROJECT, seedEngine } from "./harness";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/profile-project-image-storage", async () => {
  const { isMissingObjectError } = await import("./fake-minio");
  return { getMinioClient: () => null, isMissingObject: isMissingObjectError };
});
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) => flag === "engine-projects" && flags.enabled,
}));
const limiter = vi.hoisted(() => ({ allow: true }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => limiter.allow }));

const SECRET = "agent-token-sync-secret";
const HOUR = 3_600_000;
const T0 = new Date("2026-11-07T12:00:00Z");

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await seedEngine(db);
  flags.enabled = true;
  limiter.allow = true;
  process.env.CANVAS_SYNC_SECRET = SECRET;
  process.env.CANVAS_SYNC_URL = "wss://sync.test";
});

const create = (overrides: Partial<Parameters<typeof createAgentToken>[0]> = {}, now = T0) =>
  createAgentToken(
    {
      projectId: PROJECT,
      createdById: "staff",
      access: "write",
      label: "claude on the kitchen",
      ttlHours: 24,
      ...overrides,
    },
    now,
  );

const VERSIONS = { formatVersion: 3, layoutVersion: 2 };

describe("createAgentToken", () => {
  it("returns the secret once and stores only its SHA-256", async () => {
    const { token, secret } = await create();
    expect(secret.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    expect(secret.length).toBeGreaterThan(40);
    expect(token).toMatchObject({
      projectId: PROJECT,
      access: "write",
      label: "claude on the kitchen",
      createdById: "staff",
      revokedAt: null,
      lastUsedAt: null,
    });
    expect(token.expiresAt.getTime()).toBe(T0.getTime() + 24 * HOUR);
    expect(token).not.toHaveProperty("tokenSha256");
    expect(token).not.toHaveProperty("secret");

    const [row] = await db.select().from(engineAgentTokens);
    expect(row!.tokenSha256).toBe(await sha256(secret));
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it("mints a fresh secret every time", async () => {
    const a = await create();
    const b = await create();
    expect(a.secret).not.toBe(b.secret);
  });

  it("caps the lifetime at seven days and wants a label", async () => {
    await expect(create({ ttlHours: 168 })).resolves.toBeTruthy();
    await expect(create({ ttlHours: 169 })).rejects.toBeInstanceOf(AgentTokenError);
    await expect(create({ ttlHours: 0 })).rejects.toBeInstanceOf(AgentTokenError);
    await expect(create({ label: "   " })).rejects.toBeInstanceOf(AgentTokenError);
  });

  it("needs a live project", async () => {
    await expect(create({ projectId: "nope" })).rejects.toMatchObject({ code: "not-found" });
    await db
      .update(engineProjects)
      .set({ deletedAt: T0 })
      .where(eq(engineProjects.projectId, PROJECT));
    await expect(create()).rejects.toMatchObject({ code: "not-found" });
  });

  it("lists a project's tokens without their hashes, newest first", async () => {
    await create({ label: "first" }, T0);
    await create({ label: "second" }, new Date(T0.getTime() + 1000));
    const listed = await listAgentTokens(PROJECT);
    expect(listed.map((t) => t.label)).toEqual(["second", "first"]);
    for (const t of listed) expect(t).not.toHaveProperty("tokenSha256");
  });
});

describe("exchangeAgentToken", () => {
  it("trades the secret for a 60 s project sync token acting for its creator", async () => {
    const { token, secret } = await create({ access: "read" });
    const now = new Date(T0.getTime() + HOUR);
    const exchanged = await exchangeAgentToken(secret, VERSIONS, { now });
    expect(exchanged).toMatchObject({
      ok: true,
      projectId: PROJECT,
      agentId: token.id,
      url: "wss://sync.test",
      access: "read",
      expiresAt: now.getTime() + 60_000,
    });
    if (!exchanged.ok) throw new Error("refused");
    const claims = await verifyCanvasToken(exchanged.token, SECRET, now.getTime());
    expect(claims).toMatchObject({
      c: `project:${PROJECT}`,
      u: "staff",
      a: "read",
      k: "project",
      s: "project",
      f: 3,
      l: 2,
      g: token.id,
      o: "staff",
      n: "claude on the kitchen",
    });
    expect(await verifyCanvasToken(exchanged.token, SECRET, now.getTime() + 60_001)).toBeNull();

    const [row] = await db.select().from(engineAgentTokens);
    expect(row!.lastUsedAt).toEqual(now);
  });

  it("refuses an unknown secret", async () => {
    await create();
    expect(await exchangeAgentToken(`${AGENT_TOKEN_PREFIX}forged`, VERSIONS)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await exchangeAgentToken("not even ours", VERSIONS)).toMatchObject({ status: 401 });
  });

  it("refuses an expired token", async () => {
    const { secret } = await create({ ttlHours: 1 });
    const later = new Date(T0.getTime() + HOUR);
    expect(await exchangeAgentToken(secret, VERSIONS, { now: later })).toMatchObject({
      ok: false,
      status: 401,
      message: expect.stringContaining("expired"),
    });
  });

  it("refuses a revoked token, and revoking twice keeps the first time", async () => {
    const { token, secret } = await create();
    const first = await revokeAgentToken(token.id, new Date(T0.getTime() + 1000));
    expect(first?.revokedAt).toEqual(new Date(T0.getTime() + 1000));
    const second = await revokeAgentToken(token.id, new Date(T0.getTime() + 5000));
    expect(second?.revokedAt).toEqual(first?.revokedAt);
    expect(
      await exchangeAgentToken(secret, VERSIONS, { now: new Date(T0.getTime() + 2000) }),
    ).toMatchObject({ ok: false, status: 401, message: expect.stringContaining("revoked") });
    expect(await revokeAgentToken("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("refuses once the creator is no longer staff, or the flag is off, or the project is gone", async () => {
    const { secret } = await create();
    const now = { now: new Date(T0.getTime() + 1000) };
    flags.enabled = false;
    expect(await exchangeAgentToken(secret, VERSIONS, now)).toMatchObject({ status: 404 });
    flags.enabled = true;
    await db
      .update(engineProjects)
      .set({ deletedAt: T0 })
      .where(eq(engineProjects.projectId, PROJECT));
    expect(await exchangeAgentToken(secret, VERSIONS, now)).toMatchObject({ status: 404 });
    await db
      .update(developerProfiles)
      .set({ guildRoles: [] })
      .where(eq(developerProfiles.id, "staff"));
    expect(await exchangeAgentToken(secret, VERSIONS, now)).toMatchObject({ status: 403 });
  });

  it("is rate-limited per token", async () => {
    const { secret } = await create();
    expect(
      await exchangeAgentToken(secret, VERSIONS, {
        now: new Date(T0.getTime() + 1000),
        allowed: async () => false,
      }),
    ).toMatchObject({ ok: false, status: 429 });
  });
});

describe(`POST ${AGENT_SYNC_TOKEN_PATH}`, () => {
  const routes = () => engineRoutes(fakeMinio());
  const post = (init: { auth?: string; body?: unknown; method?: string }) =>
    new Request(`https://site.test${AGENT_SYNC_TOKEN_PATH}`, {
      method: init.method ?? "POST",
      headers: init.auth ? { authorization: init.auth } : {},
      body: init.method === "GET" ? undefined : JSON.stringify(init.body ?? VERSIONS),
    });

  it("answers a bearer agent token with a project sync token", async () => {
    const { token, secret } = await create({}, new Date());
    const response = (await routes()(post({ auth: `Bearer ${secret}` })))!;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ projectId: PROJECT, agentId: token.id, access: "write" });
    expect(body).not.toHaveProperty("ok");
    expect(await verifyCanvasToken(body.token, SECRET)).toMatchObject({ g: token.id, o: "staff" });
  });

  it("asks for a bearer token, and refuses a bad one or a bad body", async () => {
    const missing = (await routes()(post({})))!;
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect((await routes()(post({ auth: `Bearer ${AGENT_TOKEN_PREFIX}nope` })))!.status).toBe(401);
    const { secret } = await create({}, new Date());
    expect(
      (await routes()(post({ auth: `Bearer ${secret}`, body: { formatVersion: 1 } })))!.status,
    ).toBe(400);
  });

  it("answers 429 when the token's exchanges are spent", async () => {
    const { secret } = await create({}, new Date());
    limiter.allow = false;
    expect((await routes()(post({ auth: `Bearer ${secret}` })))!.status).toBe(429);
  });

  it("answers only POST", async () => {
    expect((await routes()(post({ method: "GET" })))!.status).toBe(405);
  });
});
