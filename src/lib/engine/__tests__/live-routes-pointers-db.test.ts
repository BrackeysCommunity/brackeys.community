import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { TestDb } from "@/test/db";

import { createAgentToken } from "../agent-token";
import { createLiveRoutes } from "../live-routes";
import { beginSceneVersion, commitSceneVersion } from "../live-upload";
import type { SceneVersionSummary } from "../live-versions";
import { promote } from "../release-channels";
import { memoryReleaseStore, type ReleaseObjectStore } from "../release-storage";
import {
  beginRelease,
  commitRelease,
  putReleaseFile,
  type Actor,
  type ReleaseDeps,
} from "../release-upload";
import {
  engineLiveBasePath,
  engineLiveMovePath,
  engineLivePath,
  engineLivePromotePath,
} from "../route-paths";
import { fixtureVersion, type FixtureVersion } from "./fixtures/live/scene-versions";
import { PROJECT, seedEngine } from "./harness";
import { plannedRelease, type PlannedRelease } from "./release-fixture";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/profile-project-image-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profile-project-image-storage")>()),
  getMinioClient: () => null,
}));
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
const games = vi.hoisted(() => ({
  env: "staging" as "production" | "staging" | "development",
  flag: true,
}));
vi.mock("@/lib/deploy-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deploy-env")>()),
  deployEnv: () => games.env,
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) =>
    flag === "engine-projects" || (flag === "engine-games-enabled" && games.flag),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));

const ORIGIN = "https://site.test";
const staff: Actor = { kind: "staff", userId: "staff" };

let store: ReleaseObjectStore;
let routes: ReturnType<typeof createLiveRoutes>;
let release: PlannedRelease;
let writer: string;
let reader: string;

const deps = (): ReleaseDeps => ({ store, scan: async () => {} });

/** A version of the hall with its start marker at `x`, committed by staff; `channel: "none"` leaves preview alone. */
async function publishHall(x: number, channel: "preview" | "none"): Promise<FixtureVersion> {
  const hall = await fixtureVersion(release, {
    scene: "hall",
    edit: (scene) => {
      (scene.entities as { at: number[] }[])[0]!.at = [x, 2];
    },
  });
  const begun = await beginSceneVersion(deps(), {
    projectId: PROJECT,
    version: hall.text,
    channel,
    actor: staff,
  });
  for (const file of begun.missing)
    await putReleaseFile(deps(), {
      uploadId: begun.uploadId,
      sha256: file.sha256,
      body: new TextEncoder().encode(hall.texts.get(file.sha256)!),
      actor: staff,
    });
  await commitSceneVersion(deps(), { uploadId: begun.uploadId, actor: staff });
  return hall;
}

beforeAll(async () => {
  const { db } = (await import("@/db")) as unknown as { db: TestDb };
  await seedEngine(db);
  store = memoryReleaseStore();
  routes = createLiveRoutes({
    readSession: async (request: Request) => {
      const id = request.headers.get("x-test-user");
      return id ? { user: { id } } : null;
    },
    release: { store },
  });
  release = await plannedRelease({ projectId: PROJECT });
  const begun = await beginRelease(deps(), {
    projectId: PROJECT,
    manifest: release.text,
    actor: staff,
  });
  for (const file of begun.missing)
    await putReleaseFile(deps(), {
      uploadId: begun.uploadId,
      sha256: file.sha256,
      body: release.files.get(file.path)!,
      actor: staff,
    });
  await commitRelease(deps(), { uploadId: begun.uploadId, actor: staff });
  await promote({ projectId: PROJECT, version: 1, channel: "production", actor: staff });
  await publishHall(3, "preview");
  await publishHall(5, "none");

  const token = (access: "read" | "write") =>
    createAgentToken({
      projectId: PROJECT,
      createdById: "staff",
      access,
      label: "ci",
      ttlHours: 1,
    });
  writer = (await token("write")).secret;
  reader = (await token("read")).secret;
});

beforeEach(() => {
  games.env = "staging";
  games.flag = true;
});

function call(
  path: string,
  opts: { method?: string; secret?: string; user?: string; json?: unknown } = {},
): Request {
  const headers = new Headers();
  if (opts.secret) headers.set("authorization", `Bearer ${opts.secret}`);
  if (opts.user) headers.set("x-test-user", opts.user);
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.json);
  }
  return new Request(`${ORIGIN}${path}`, {
    method: opts.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

const send = async (request: Request) => (await routes(request))!;

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
      Object.assign(games, { env: "staging", flag: true }, setting);
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
