import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { engineReleaseAudit, engineReleaseChannels, engineReleases } from "@/db/schema";
import type { TestDb } from "@/test/db";

import { createAgentToken } from "../agent-token";
import { createReleaseRoutes } from "../release-routes";
import { memoryReleaseStore } from "../release-storage";
import {
  engineReleaseMovePath,
  engineReleaseRollbackPath,
  engineReleasesPath,
} from "../route-paths";
import { PROJECT, seedEngine } from "./harness";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/profile-project-image-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profile-project-image-storage")>()),
  getMinioClient: () => null,
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) =>
    flag === "engine-projects" || flag === "engine-games-enabled",
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));

const ORIGIN = "https://site.test";
const hex = (n: number) => n.toString(16).padStart(64, "0");

let db: TestDb;
let routes: ReturnType<typeof createReleaseRoutes>;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await seedEngine(db);
  for (const version of [1, 2, 3]) {
    await db.insert(engineReleases).values({
      id: hex(version),
      projectId: PROJECT,
      version,
      manifest: "{}",
      manifestBytes: 2,
      totalBytes: 10,
      fileCount: 1,
      engineVersion: "0.14.1",
      gameId: "kitchen-game",
      snapshot: "a".repeat(64),
      buildHash: "b".repeat(64),
      target: "web",
    });
  }
  routes = createReleaseRoutes({
    readSession: async () => null,
    release: { store: memoryReleaseStore() },
  });
});

const secretFor = async (access: "read" | "write" = "write") =>
  (
    await createAgentToken({
      projectId: PROJECT,
      createdById: "staff",
      access,
      label: "ci",
      ttlHours: 1,
    })
  ).secret;

async function send(path: string, secret: string, json?: unknown) {
  const headers = new Headers({ authorization: `Bearer ${secret}` });
  if (json !== undefined) headers.set("content-type", "application/json");
  const response = (await routes(
    new Request(`${ORIGIN}${path}`, {
      method: json === undefined ? "GET" : "POST",
      headers,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    }),
  ))!;
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const preview = { channel: "preview" };

const pointer = async () =>
  (
    await db
      .select({ releaseId: engineReleaseChannels.releaseId })
      .from(engineReleaseChannels)
      .where(eq(engineReleaseChannels.channel, "preview"))
  )[0]?.releaseId ?? null;

describe("release channel routes with an agent token", () => {
  it("promote and roll back preview, each one audit row naming the token", async () => {
    const secret = await secretFor();
    expect(await send(engineReleaseMovePath(PROJECT, 1, "promote"), secret, preview)).toEqual({
      status: 200,
      body: { from: null, to: 1 },
    });
    expect(await send(engineReleaseMovePath(PROJECT, 2, "promote"), secret, preview)).toEqual({
      status: 200,
      body: { from: 1, to: 2 },
    });
    expect(await send(engineReleaseRollbackPath(PROJECT), secret, preview)).toEqual({
      status: 200,
      body: { from: 2, to: 1 },
    });
    expect(await pointer()).toBe(hex(1));
    expect(await send(engineReleaseMovePath(PROJECT, 3, "rollback"), secret, preview)).toEqual({
      status: 200,
      body: { from: 1, to: 3 },
    });
    expect(await pointer()).toBe(hex(3));

    const rows = await db.select().from(engineReleaseAudit).orderBy(asc(engineReleaseAudit.id));
    expect(rows.map((r) => [r.action, r.actorKind, r.actorId, r.toRelease])).toEqual([
      ["promote", "agent", "staff", hex(1)],
      ["promote", "agent", "staff", hex(2)],
      ["rollback", "agent", "staff", hex(1)],
      ["rollback", "agent", "staff", hex(3)],
    ]);
    expect(new Set(rows.map((r) => r.agentTokenId)).size).toBe(1);
    expect(rows[0]?.agentTokenId).not.toBeNull();
    expect(await db.select().from(engineReleases)).toHaveLength(3);
  });

  it("list the releases newest first for a read-only token", async () => {
    const write = await secretFor();
    await send(engineReleaseMovePath(PROJECT, 2, "promote"), write, preview);
    const { status, body } = await send(engineReleasesPath(PROJECT), await secretFor("read"));
    expect(status).toBe(200);
    const releases = body.releases as { version: number; channels: string[]; audience: string }[];
    expect(releases.map((r) => r.version)).toEqual([3, 2, 1]);
    expect(releases[1]).toMatchObject({ channels: ["preview"], audience: "publishers" });
  });

  it("refuse as the release API's JSON body: collected, unknown, production, read-only", async () => {
    const secret = await secretFor();
    await db
      .update(engineReleases)
      .set({ collectedAt: new Date("2026-12-03T12:00:00Z") })
      .where(eq(engineReleases.version, 2));
    expect(await send(engineReleaseMovePath(PROJECT, 2, "promote"), secret, preview)).toEqual({
      status: 409,
      body: expect.objectContaining({
        code: "release-immutable",
        message: "v2 was removed on 3 Dec 2026; its files are gone.",
      }),
    });
    expect(await send(engineReleaseMovePath(PROJECT, 9, "promote"), secret, preview)).toEqual({
      status: 404,
      body: expect.objectContaining({ code: "not-found" }),
    });
    expect(await send(engineReleaseRollbackPath(PROJECT), secret, preview)).toEqual({
      status: 404,
      body: expect.objectContaining({ code: "not-found" }),
    });
    const production = await send(engineReleaseRollbackPath(PROJECT), secret, {
      channel: "production",
    });
    expect(production).toMatchObject({ status: 403, body: { code: "release-forbidden" } });
    const readOnly = await send(
      engineReleaseMovePath(PROJECT, 1, "promote"),
      await secretFor("read"),
      preview,
    );
    expect(readOnly).toMatchObject({ status: 403, body: { code: "release-forbidden" } });
    expect(await pointer()).toBeNull();
    expect(await db.select().from(engineReleaseAudit)).toEqual([]);
  });
});
