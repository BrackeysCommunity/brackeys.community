import {
  formatAssetDoc,
  materialKind,
  sha256,
  type ProjectBundle,
  type QuotaPolicy,
} from "@jams/engine/project";
import { createRegistry, createScene, formatScene } from "@jams/engine/scene";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  developerProfiles,
  engineAgentTokens,
  engineAssetDocs,
  engineBlobs,
  engineProjects,
  sceneDocs,
  user,
} from "@/db/schema";
import { base64ToBytes } from "@/lib/canvas/encoding";
import { verifyCanvasToken } from "@/lib/canvas/token";
import { fakeMinio } from "@/lib/engine/__tests__/fake-minio";
import { engineRoutes, PNG, upload } from "@/lib/engine/__tests__/harness";
import { readProjectState } from "@/lib/scene/project-bytes";
import {
  createAgentToken,
  createEmptyHostedProject,
  createHostedProject,
  deleteHostedProject,
  getProjectBundle,
  getProjectSyncToken,
  listAgentTokens,
  revokeAgentToken,
} from "@/orpc/router/engine-project";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
  syncDiscordProfile: async () => ({ guildRolesSynced: false }),
}));
const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) => flag === "engine-projects" && flags.enabled,
}));
const redis = vi.hoisted(() => ({ published: [] as { channel: string; message: unknown }[] }));
vi.mock("@/lib/redis", () => ({
  createRedisClient: async () => ({
    status: "ready",
    once() {},
    publish: async (channel: string, raw: string) => {
      redis.published.push({ channel, message: JSON.parse(raw) });
      return 1;
    },
    set: async () => "OK",
  }),
}));

vi.hoisted(() => {
  process.env.MINIO_BUCKET = "b";
});
const minio = vi.hoisted(() => ({ current: null as null | ReturnType<typeof fakeMinio> }));
vi.mock("@/lib/profile-project-image-storage", async () => {
  const { isMissingObjectError } = await import("@/lib/engine/__tests__/fake-minio");
  return { getMinioClient: () => minio.current!.client, isMissingObject: isMissingObjectError };
});
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
const quota = vi.hoisted(() => ({ policy: null as null | QuotaPolicy }));
vi.mock("@/lib/engine/quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine/quota")>();
  return {
    ...actual,
    ENGINE_QUOTA: {
      check: (...args: Parameters<QuotaPolicy["check"]>) =>
        (quota.policy ?? actual.UNLIMITED_QUOTA).check(...args),
    },
  };
});

const SECRET = "engine-project-sync-secret";
const PROJECT = "kitchen";

let db: TestDb;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  flags.enabled = true;
  quota.policy = null;
  minio.current = fakeMinio();
  redis.published.length = 0;
  process.env.REDIS_URL = "redis://fake.test:6379";
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  process.env.CANVAS_SYNC_SECRET = SECRET;
  process.env.CANVAS_SYNC_URL = "wss://sync.test";
  await db.delete(sceneDocs);
  await db.delete(engineAgentTokens);
  await db.delete(engineProjects);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "member");
  await seedUser(db, "moderator", { guildRoles: ["Moderator"] });
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "admin", { guildRoles: ["Admin"] });
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Kitchen" });
});

const syncInput = { projectId: PROJECT, formatVersion: 3, layoutVersion: 2 };
const createInput = {
  projectId: PROJECT,
  access: "write" as const,
  label: "claude",
  ttlHours: 24,
};

async function seededTokenId(): Promise<string> {
  const [row] = await db
    .insert(engineAgentTokens)
    .values({
      projectId: PROJECT,
      createdById: "staff",
      access: "read",
      label: "seeded",
      tokenSha256: await sha256("seeded"),
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: engineAgentTokens.id });
  return row!.id;
}

/** Every procedure, with an input that passes validation. */
const everyProcedure = async () => {
  const id = await seededTokenId();
  return [
    [
      "getProjectSyncToken",
      (who: string | null) => call(getProjectSyncToken, syncInput, asUser(who)),
    ],
    ["createAgentToken", (who: string | null) => call(createAgentToken, createInput, asUser(who))],
    ["revokeAgentToken", (who: string | null) => call(revokeAgentToken, { id }, asUser(who))],
    [
      "listAgentTokens",
      (who: string | null) => call(listAgentTokens, { projectId: PROJECT }, asUser(who)),
    ],
    [
      "createEmptyHostedProject",
      (who: string | null) =>
        call(createEmptyHostedProject, { projectId: "fresh", name: "Fresh" }, asUser(who)),
    ],
    [
      "createHostedProject",
      (who: string | null) =>
        call(createHostedProject, { bundle: bundleFor("seeded") }, asUser(who)),
    ],
    [
      "getProjectBundle",
      (who: string | null) => call(getProjectBundle, { projectId: PROJECT }, asUser(who)),
    ],
    // Last: it deletes the project the others use.
    [
      "deleteHostedProject",
      (who: string | null) => call(deleteHostedProject, { projectId: PROJECT }, asUser(who)),
    ],
  ] as const;
};

describe("engine-project procedures: the gate", () => {
  it("are staff only", async () => {
    for (const [name, run] of await everyProcedure()) {
      await expect(run("member"), name).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(run(null), name).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  it("refuse a staff role a ban outranks", async () => {
    await db.update(user).set({ bannedAt: new Date() }).where(eq(user.id, "staff"));
    for (const [name, run] of await everyProcedure()) {
      await expect(run("staff"), name).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("refuse with the flag off, staff included", async () => {
    flags.enabled = false;
    for (const [name, run] of await everyProcedure()) {
      await expect(run("staff"), name).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(redis.published).toHaveLength(0);
  });

  it.each(["moderator", "staff", "admin"])("let %s through", async (who) => {
    for (const [name, run] of await everyProcedure()) {
      await expect(run(who), name).resolves.toBeTruthy();
    }
  });
});

describe("getProjectSyncToken", () => {
  it("mints a 60 s token for every doc of the project", async () => {
    const { token, url, access } = await call(getProjectSyncToken, syncInput, asUser("staff"));
    expect({ url, access }).toEqual({ url: "wss://sync.test", access: "write" });
    const claims = await verifyCanvasToken(token, SECRET);
    expect(claims).toMatchObject({
      c: `project:${PROJECT}`,
      u: "staff",
      a: "write",
      k: "project",
      s: "project",
      f: 3,
      l: 2,
    });
    expect(claims).not.toHaveProperty("g");
    expect(claims!.e - Date.now()).toBeLessThanOrEqual(60_000);
    expect(await verifyCanvasToken(token, SECRET, Date.now() + 60_001)).toBeNull();
  });

  it("mints a read-only token on request", async () => {
    const { token } = await call(
      getProjectSyncToken,
      { ...syncInput, access: "read" },
      asUser("staff"),
    );
    expect(await verifyCanvasToken(token, SECRET)).toMatchObject({ a: "read" });
  });

  it("refuses a missing or deleted project, and an id that isn't one", async () => {
    await expect(
      call(getProjectSyncToken, { ...syncInput, projectId: "nope" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(getProjectSyncToken, { ...syncInput, projectId: "Kitchen Sink" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await db.update(engineProjects).set({ deletedAt: new Date() });
    await expect(call(getProjectSyncToken, syncInput, asUser("staff"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("says so when live projects aren't set up", async () => {
    delete process.env.CANVAS_SYNC_URL;
    await expect(call(getProjectSyncToken, syncInput, asUser("staff"))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});

describe("agent tokens", () => {
  it("creates one, showing the secret once, and lists it without", async () => {
    const created = await call(createAgentToken, createInput, asUser("staff"));
    expect(created.secret).toMatch(/^jat_/);
    expect(created).toMatchObject({ projectId: PROJECT, access: "write", createdById: "staff" });
    const [row] = await db.select().from(engineAgentTokens);
    expect(row!.tokenSha256).toBe(await sha256(created.secret));

    const listed = await call(listAgentTokens, { projectId: PROJECT }, asUser("staff"));
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("secret");
    expect(listed[0]).not.toHaveProperty("tokenSha256");
  });

  it("refuses more than seven days and a missing project", async () => {
    await expect(
      call(createAgentToken, { ...createInput, ttlHours: 169 }, asUser("staff")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      call(createAgentToken, { ...createInput, projectId: "nope" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("revokes one and closes its creator's sockets on the project", async () => {
    const { id } = await call(createAgentToken, createInput, asUser("staff"));
    const revoked = await call(revokeAgentToken, { id }, asUser("admin"));
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(redis.published).toEqual([
      {
        channel: "development:canvas-sync:revoke",
        message: expect.objectContaining({ projectId: PROJECT, userId: "staff" }),
      },
    ]);
    await expect(
      call(revokeAgentToken, { id: "00000000-0000-4000-8000-000000000000" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

const SCENE = formatScene(createScene("yard", createRegistry(null))).text;
const RUBBER = formatAssetDoc(materialKind, {
  kind: "material",
  v: 2,
  description: "Bouncy rubber.",
  physics: { friction: 0.4, restitution: 0.9 },
});

function bundleFor(projectId: string, blobs: Record<string, string> = {}): ProjectBundle {
  return {
    project: { kind: "project", v: 1, id: projectId, name: "Seeded", game: null, code: [] },
    texts: { "scenes/yard.json": SCENE, "materials/rubber.json": RUBBER },
    blobs,
    sidecars: {},
  };
}

describe("createHostedProject", () => {
  it("seeds a new project from a bundle and refuses an existing id", async () => {
    const created = await call(
      createHostedProject,
      { bundle: bundleFor("seeded") },
      asUser("staff"),
    );
    expect(created).toEqual({ projectId: "seeded", docs: 2, warnings: [] });
    const [project] = await db
      .select()
      .from(engineProjects)
      .where(eq(engineProjects.projectId, "seeded"));
    expect(project).toMatchObject({ name: "Seeded", game: null, createdById: "staff" });
    expect(readProjectState(new Uint8Array(project!.state!)).meta.projectId).toBe("seeded");
    expect(
      await db
        .select({ sceneId: sceneDocs.sceneId, seed: sceneDocs.seed })
        .from(sceneDocs)
        .where(eq(sceneDocs.projectId, "seeded")),
    ).toEqual([{ sceneId: "seeded.yard", seed: SCENE }]);
    expect(
      await db
        .select({ key: engineAssetDocs.assetKey, kind: engineAssetDocs.kind })
        .from(engineAssetDocs)
        .where(eq(engineAssetDocs.projectId, "seeded")),
    ).toEqual([{ key: "rubber", kind: "material" }]);

    await expect(
      call(createHostedProject, { bundle: bundleFor("seeded") }, asUser("staff")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      call(createEmptyHostedProject, { projectId: "seeded", name: "Again" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a bundle it can't host, naming each file's problems", async () => {
    const broken = { ...bundleFor("broken"), texts: { "scenes/x.json": "{" } };
    const error = await call(createHostedProject, { bundle: broken }, asUser("staff")).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      data: { problems: [expect.objectContaining({ path: "scenes/x.json" })] },
    });
    await expect(
      call(createHostedProject, { bundle: { not: "a bundle" } }, asUser("staff")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await db.select().from(engineProjects).where(eq(engineProjects.projectId, "broken")),
    ).toEqual([]);
  });

  it("pushes blobs to an empty project first, then seeds it; the bundle reads them back", async () => {
    await call(createEmptyHostedProject, { projectId: "crates", name: "Crates" }, asUser("staff"));
    const routes = engineRoutes(minio.current!, { store: undefined });
    const uploaded = (await routes(upload(PNG, { project: "crates" })))!;
    expect(uploaded.status).toBe(201);
    const { sha256: hash } = (await uploaded.json()) as { sha256: string };

    const bundle = bundleFor("crates", { "art/crate.png": hash });
    await expect(call(createHostedProject, { bundle }, asUser("staff"))).resolves.toMatchObject({
      projectId: "crates",
      docs: 2,
    });

    const pulled = await call(getProjectBundle, { projectId: "crates" }, asUser("staff"));
    expect(pulled).toMatchObject({ projectId: "crates", name: "Seeded", game: null });
    expect(pulled.blobs).toEqual([
      { sha256: hash, bytes: PNG.byteLength, contentType: "image/png" },
    ]);
    expect(pulled.docs.map((d) => [d.prefix, d.key, d.state, d.seed])).toEqual([
      ["scene", "yard", null, SCENE],
      ["asset", "rubber", null, RUBBER],
    ]);
    const registry = readProjectState(base64ToBytes(pulled.project));
    expect(registry.assets.crate).toMatchObject({ kind: "texture", sha256: hash });
  });

  it("refuses a blob that isn't uploaded with hash-mismatch", async () => {
    await call(createEmptyHostedProject, { projectId: "crates", name: "Crates" }, asUser("staff"));
    const bundle = bundleFor("crates", { "art/crate.png": await sha256(PNG) });
    await expect(call(createHostedProject, { bundle }, asUser("staff"))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: {
        problems: [
          {
            path: "art/crate.png",
            issues: [expect.objectContaining({ code: "hash-mismatch" })],
          },
        ],
      },
    });
  });

  it("asks the quota policy, whose refusal reaches the client as quota-exceeded", async () => {
    const asked: unknown[] = [];
    quota.policy = {
      check: (usage, add) => {
        asked.push({ usage, add });
        return { ok: false, limit: "docs", used: 2, max: 1, message: "One doc per project." };
      },
    };
    await expect(
      call(createHostedProject, { bundle: bundleFor("seeded") }, asUser("staff")),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "One doc per project.",
      data: { code: "quota-exceeded", limit: "docs", used: 2, max: 1 },
    });
    expect(asked).toEqual([
      {
        usage: { docs: 0, docBytes: 0, blobs: 0, blobBytes: 0, trashBytes: 0 },
        add: { docs: 2 },
      },
    ]);
    expect(
      await db.select().from(engineProjects).where(eq(engineProjects.projectId, "seeded")),
    ).toEqual([]);
  });
});

describe("getProjectBundle", () => {
  it("reads an unopened project as the empty registry the service would seed", async () => {
    const pulled = await call(getProjectBundle, { projectId: PROJECT }, asUser("staff"));
    expect(pulled).toMatchObject({ projectId: PROJECT, name: "Kitchen", docs: [], blobs: [] });
    expect(readProjectState(base64ToBytes(pulled.project)).meta).toMatchObject({
      projectId: PROJECT,
      name: "Kitchen",
    });
  });

  it("refuses a missing project", async () => {
    await expect(
      call(getProjectBundle, { projectId: "nope" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deleteHostedProject", () => {
  it("soft-deletes, closes every socket on the project, and keeps the id taken", async () => {
    await db.insert(engineBlobs).values({
      projectId: PROJECT,
      sha256: await sha256(PNG),
      byteSize: PNG.byteLength,
      contentType: "image/png",
      storageKey: "engine-assets/kitchen/x",
    });
    await expect(
      call(deleteHostedProject, { projectId: PROJECT }, asUser("staff")),
    ).resolves.toEqual({ projectId: PROJECT });

    const [row] = await db.select().from(engineProjects);
    expect(row!.deletedAt).toBeInstanceOf(Date);
    expect(await db.select().from(engineBlobs)).toHaveLength(1);
    expect(redis.published).toEqual([
      { channel: "development:canvas-sync:revoke", message: { projectId: PROJECT } },
    ]);

    await expect(call(getProjectSyncToken, syncInput, asUser("staff"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      call(getProjectBundle, { projectId: PROJECT }, asUser("staff")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(deleteHostedProject, { projectId: PROJECT }, asUser("staff")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(createEmptyHostedProject, { projectId: PROJECT, name: "Again" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      call(createHostedProject, { bundle: bundleFor(PROJECT) }, asUser("staff")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
