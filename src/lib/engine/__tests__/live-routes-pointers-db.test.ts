import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { TestDb } from "@/test/db";

import { createLiveRoutes } from "../live-routes";
import type { SceneVersionSummary } from "../live-versions";
import { memoryReleaseStore, type ReleaseObjectStore } from "../release-storage";
import type { Actor } from "../release-upload";
import {
  engineLiveBasePath,
  engineLiveMovePath,
  engineLivePath,
  engineLivePromotePath,
} from "../route-paths";
import { fixtureVersion, type FixtureVersion } from "./fixtures/live/scene-versions";
import { call, PROJECT, secretFor, seedEngine, sendTo, testReadSession } from "./harness";
import { plannedRelease, type PlannedRelease } from "./release-fixture";
import { uploadDeps, uploadRelease, uploadSceneVersion } from "./upload-rig";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/profile-project-image-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profile-project-image-storage")>()),
  getMinioClient: () => null,
}));
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
vi.mock("@/lib/deploy-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deploy-env")>()),
  deployEnv: () => games.deployEnv(),
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: (flag: string) => games.isServerFlagEnabled(flag),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
const games = await vi.hoisted(async () => (await import("./harness")).gamesGate());

const staff: Actor = { kind: "staff", userId: "staff" };

let store: ReleaseObjectStore;
let routes: ReturnType<typeof createLiveRoutes>;
let release: PlannedRelease;
let writer: string;
let reader: string;

/** A version of the hall with its start marker at `x`, committed by staff; `channel: "none"` leaves preview alone. */
async function publishHall(x: number, channel: "preview" | "none"): Promise<FixtureVersion> {
  const hall = await fixtureVersion(release, {
    scene: "hall",
    edit: (scene) => {
      (scene.entities as { at: number[] }[])[0]!.at = [x, 2];
    },
  });
  await uploadSceneVersion(uploadDeps(store), hall, { channel, actor: staff });
  return hall;
}

beforeAll(async () => {
  const { db } = (await import("@/db")) as unknown as { db: TestDb };
  await seedEngine(db);
  store = memoryReleaseStore();
  routes = createLiveRoutes({
    readSession: testReadSession,
    release: { store },
  });
  release = await plannedRelease({ projectId: PROJECT });
  await uploadRelease(uploadDeps(store), release, { actor: staff, promoteTo: "production" });
  await publishHall(3, "preview");
  await publishHall(5, "none");

  writer = await secretFor(PROJECT, "write");
  reader = await secretFor(PROJECT, "read");
});

beforeEach(() => games.reset());

const send = sendTo(() => routes);

async function answer(request: Request): Promise<{ status: number; body: unknown }> {
  const response = await send(request);
  return { status: response.status, body: await response.json() };
}

const promotePath = (number: number) => engineLivePromotePath(PROJECT, "hall", number);
const rollbackPath = engineLiveMovePath(PROJECT, "hall", "rollback");
const clearPath = engineLiveMovePath(PROJECT, "hall", "clear");

describe("live pointer routes", () => {
  it("let an agent token list, promote, roll back and clear on preview", async () => {
    const listed = await send(call(engineLivePath(PROJECT, "hall"), { secret: reader }));
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    const { versions } = (await listed.json()) as { versions: SceneVersionSummary[] };
    expect(versions.map((v) => [v.number, v.pointers.map((p) => p.channel)])).toEqual([
      [2, []],
      [1, ["preview"]],
    ]);

    expect(
      await answer(
        call(promotePath(2), { secret: writer, json: { channel: "preview", timing: "boundary" } }),
      ),
    ).toEqual({ status: 200, body: { from: 1, to: 2, timing: "boundary" } });
    expect(
      await answer(call(rollbackPath, { secret: writer, json: { channel: "preview" } })),
    ).toEqual({ status: 200, body: { from: 2, to: 1 } });
    expect(
      await answer(call(rollbackPath, { secret: writer, json: { channel: "preview", to: 2 } })),
    ).toEqual({ status: 200, body: { from: 1, to: 2 } });
    expect(await answer(call(clearPath, { secret: writer, json: { channel: "preview" } }))).toEqual(
      {
        status: 200,
        body: { from: 2 },
      },
    );

    const after = (await (
      await send(call(engineLivePath(PROJECT), { secret: reader }))
    ).json()) as { versions: SceneVersionSummary[] };
    expect(after.versions.every((v) => v.pointers.length === 0)).toBe(true);
  });

  it("answer a scene's base for a read token", async () => {
    await answer(call(promotePath(1), { secret: writer, json: { channel: "preview" } }));
    const based = await answer(
      call(engineLiveBasePath(PROJECT, "hall", "preview"), { secret: reader }),
    );
    expect(based.status).toBe(200);
    expect(based.body).toMatchObject({
      channel: "preview",
      release: { id: release.releaseId, version: 1, manifest: release.text },
      live: { number: 1, timing: "next-load" },
      latest: 2,
    });
    const production = await answer(
      call(engineLiveBasePath(PROJECT, "hall", "production"), { secret: reader }),
    );
    expect(production.body).toMatchObject({ channel: "production", live: null, latest: 2 });

    const noChannel = await answer(
      call(`/api/engine/projects/${PROJECT}/live/scenes/hall/base`, { secret: reader }),
    );
    expect(noChannel).toMatchObject({ status: 400, body: { code: "schema" } });
  });

  it("refuse an agent token on production with the release API's message", async () => {
    for (const request of [
      call(promotePath(1), { secret: writer, json: { channel: "production" } }),
      call(rollbackPath, { secret: writer, json: { channel: "production" } }),
      call(clearPath, { secret: writer, json: { channel: "production" } }),
    ]) {
      const refused = await answer(request);
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({
        code: "release-forbidden",
        message: "Production releases are moved by a person on the game's page.",
      });
      expect((refused.body as { hint?: string }).hint).toContain(`/games/${PROJECT}`);
    }
  });

  it("let a staff session move production", async () => {
    expect(
      await answer(call(promotePath(2), { user: "staff", json: { channel: "production" } })),
    ).toEqual({ status: 200, body: { from: null, to: 2, timing: "next-load" } });
    expect(
      await answer(call(clearPath, { user: "staff", json: { channel: "production" } })),
    ).toEqual({ status: 200, body: { from: 2 } });
  });

  it("refuse a read-only token's moves, and answer a bad body as the schema error", async () => {
    const readOnly = await answer(
      call(promotePath(1), { secret: reader, json: { channel: "preview" } }),
    );
    expect(readOnly).toEqual({
      status: 403,
      body: { code: "release-forbidden", message: "That agent token is read-only." },
    });
    expect(
      await answer(call(rollbackPath, { secret: writer, json: { channel: "staging" } })),
    ).toMatchObject({ status: 400, body: { code: "schema" } });
    expect(
      await answer(
        call(promotePath(1), { secret: writer, json: { channel: "preview", timing: "later" } }),
      ),
    ).toMatchObject({ status: 400, body: { code: "schema" } });
  });

  it("read as not found on production and while engine-games-enabled is off", async () => {
    for (const setting of [{ env: "production" as const }, { flag: false }]) {
      games.reset();
      Object.assign(games, setting);
      for (const request of [
        call(engineLivePath(PROJECT), { secret: reader }),
        call(engineLiveBasePath(PROJECT, "hall", "preview"), { user: "staff" }),
        call(promotePath(1), { secret: writer, json: { channel: "preview" } }),
        call(rollbackPath, { secret: writer, json: { channel: "preview" } }),
        call(clearPath, { user: "staff", json: { channel: "preview" } }),
      ]) {
        expect(await answer(request)).toEqual({
          status: 404,
          body: { code: "not-found", message: "Not found." },
        });
      }
    }
  });

  it("answer the wrong method, a bad scene id and an unknown version", async () => {
    const wrong = await send(call(promotePath(1), { secret: writer }));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("POST");
    expect(
      (
        await send(
          call(`/api/engine/projects/${PROJECT}/live/scenes/Hall%20!/base?channel=preview`, {
            secret: reader,
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      await answer(call(promotePath(9), { secret: writer, json: { channel: "preview" } })),
    ).toMatchObject({ status: 404, body: { code: "not-found" } });
  });
});
