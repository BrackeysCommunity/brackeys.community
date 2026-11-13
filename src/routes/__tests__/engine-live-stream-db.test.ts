import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { db as mockedDb } from "@/db";
import { engineProjects, teamMembers, teams } from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { plannedRelease, type PlannedRelease } from "../../lib/engine/__tests__/release-fixture";
import { uploadDeps, uploadRelease } from "../../lib/engine/__tests__/upload-rig";
import { forgetProjectReleases } from "../../lib/engine/frame-route";
import { resolvePlay } from "../../lib/engine/game-play";
import { LIVE_STREAM_MINUTES } from "../../lib/engine/limits";
import { engineLive } from "../../lib/engine/live-events";
import type { Viewer } from "../../lib/engine/release-access";
import { memoryReleaseStore } from "../../lib/engine/release-storage";
import type { Actor } from "../../lib/engine/release-upload";

const state = vi.hoisted(() => ({ userId: null as string | null, flag: true }));

vi.mock("@/polyfill", () => ({}));
vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        state.userId === null ? null : { user: { id: state.userId, banned: false } },
    },
  },
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) => flag === "engine-games-enabled" && state.flag,
  withErrorReporting: (_route: string, fn: unknown) => fn,
}));
vi.mock("@/lib/engine/game-play", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/engine/game-play")>();
  return { ...original, resolvePlay: vi.fn(original.resolvePlay) };
});

import { Route } from "../api.engine.live.$projectId.stream";

const db = mockedDb as unknown as TestDb;

const PROJECT = "live-stream-fixture";
const OTHER_PROJECT = "live-stream-other";
const GAME = "fixture-game";
const NOW = new Date("2026-11-13T12:00:00Z");
const creator: Actor = { kind: "user", userId: "creator" };

type Handler = (ctx: { request: Request; params: { projectId: string } }) => Promise<Response>;
const GET = (Route as unknown as { options: { server: { handlers: { GET: Handler } } } }).options
  .server.handlers.GET;

const store = memoryReleaseStore();
let v1: PlannedRelease;
let v2: PlannedRelease;

type Open = { response: Response; read: () => Promise<string>; close: () => void };

async function open(
  userId: string | null,
  channel: string,
  projectId: string = PROJECT,
): Promise<Open> {
  state.userId = userId;
  const controller = new AbortController();
  const response = await GET({
    request: new Request(
      `http://localhost:3000/api/engine/live/${projectId}/stream?channel=${channel}`,
      { signal: controller.signal },
    ),
    params: { projectId },
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const decoder = new TextDecoder();
  return {
    response,
    read: async () => {
      reader ??= response.body!.getReader();
      const chunk = await reader.read();
      return chunk.done ? "" : decoder.decode(chunk.value);
    },
    close: () => controller.abort(),
  };
}

/** Reads until an `event: live` arrives and answers its data. */
async function nextLive(stream: Open): Promise<unknown> {
  for (;;) {
    const text = await stream.read();
    if (text === "") throw new Error("the stream closed before an event");
    const match = /event: live\ndata: (.*)\n\n/.exec(text);
    if (match) return JSON.parse(match[1]!);
  }
}

async function expectNotFound(userId: string | null, channel: string, projectId = PROJECT) {
  const { response } = await open(userId, channel, projectId);
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("Not found");
}

beforeAll(async () => {
  vi.stubEnv("ENGINE_FRAME_SECRET", "frame-secret-for-live-stream-tests-0123");
  vi.stubEnv("REDIS_URL", undefined);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "creator");
  await seedUser(db, "teammate");
  await seedUser(db, "outsider");
  v1 = await plannedRelease({ projectId: PROJECT, gameId: GAME, engineVersion: "0.14.5" });
  v2 = await plannedRelease({
    projectId: PROJECT,
    gameId: GAME,
    engineVersion: "0.14.5",
    hallVariant: 2,
  });
  await db
    .insert(teams)
    .values({ id: "team-1", slug: "team-1", name: "Team", createdBy: "creator" });
  await db.insert(teamMembers).values([
    { teamId: "team-1", userId: "creator", role: "owner" },
    { teamId: "team-1", userId: "teammate", role: "member" },
  ]);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Live Stream Fixture",
    game: GAME,
    createdById: "creator",
    teamId: "team-1",
    visibility: "unlisted",
  });
  const deps = uploadDeps(store, { now: () => NOW });
  await uploadRelease(deps, v1, { actor: creator, promoteTo: "production" });
  await uploadRelease(deps, v2, { actor: creator });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  state.flag = true;
  state.userId = null;
  forgetProjectReleases(PROJECT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("engine live stream: who may listen", () => {
  it("opens production of an unlisted game for a caller the play gate admits who isn't on the team", async () => {
    const stream = await open("staff", "production");
    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
    expect(await stream.read()).toContain(": connected");
    stream.close();
  });

  it("opens preview for the people who make the game", async () => {
    const stream = await open("staff", "preview");
    expect(stream.response.status).toBe(200);
    stream.close();
  });

  it("needs an editor for preview: past the staff gate, the play rule decides", async () => {
    const real = (
      await vi.importActual<typeof import("@/lib/engine/game-play")>("@/lib/engine/game-play")
    ).resolvePlay;
    const as =
      (viewer: Viewer): typeof resolvePlay =>
      (input, deps) =>
        real({ ...input, viewer }, deps);
    const player: Viewer = { userId: "outsider", staff: false, teamRole: null, isCreator: false };
    const editor: Viewer = {
      userId: "teammate",
      staff: false,
      teamRole: "member",
      isCreator: false,
    };

    vi.mocked(resolvePlay).mockImplementationOnce(as(player));
    await expectNotFound("staff", "preview");

    vi.mocked(resolvePlay).mockImplementationOnce(as(editor));
    const preview = await open("staff", "preview");
    expect(preview.response.status).toBe(200);
    preview.close();

    vi.mocked(resolvePlay).mockImplementationOnce(as(player));
    const production = await open("staff", "production");
    expect(production.response.status).toBe(200);
    production.close();
  });

  it("asks the play page's rule with the channel's version", async () => {
    vi.mocked(resolvePlay).mockClear();
    (await open("staff", "production")).close();
    (await open("staff", "preview")).close();
    expect(vi.mocked(resolvePlay).mock.calls.map(([input]) => input.version)).toEqual([
      "latest",
      "preview",
    ]);
  });

  it("refuses signed-out and non-staff callers while the staff gate stands", async () => {
    await expectNotFound(null, "production");
    await expectNotFound("outsider", "production");
    await expectNotFound("teammate", "preview");
    await expectNotFound("creator", "preview");
  });

  it("refuses with the flag off, an unknown project, a bad id or a bad channel", async () => {
    state.flag = false;
    await expectNotFound("staff", "production");
    state.flag = true;
    await expectNotFound("staff", "production", "no-such-game");
    await expectNotFound("staff", "production", "Not_An_Id");
    await expectNotFound("staff", "staging");
    await expectNotFound("staff", "");
  });

  it("refuses production once the game is hidden", async () => {
    await db
      .update(engineProjects)
      .set({ hiddenAt: NOW })
      .where(eq(engineProjects.projectId, PROJECT));
    forgetProjectReleases(PROJECT);
    try {
      await expectNotFound("staff", "production");
    } finally {
      await db
        .update(engineProjects)
        .set({ hiddenAt: null })
        .where(eq(engineProjects.projectId, PROJECT));
    }
  });
});

describe("engine live stream: events", () => {
  it("sends this project's moves on this channel only", async () => {
    const stream = await open("staff", "production");
    expect(await stream.read()).toContain(": connected");
    await engineLive.announce({ projectId: PROJECT, channel: "preview", rev: 5 });
    await engineLive.announce({ projectId: OTHER_PROJECT, channel: "production", rev: 6 });
    await engineLive.announce({ projectId: PROJECT, channel: "production", rev: 7 });
    expect(await nextLive(stream)).toEqual({ channel: "production", rev: 7 });
    stream.close();
  });

  it("ends when the request does", async () => {
    const stream = await open("staff", "preview");
    expect(await stream.read()).toContain(": connected");
    stream.close();
    await engineLive.announce({ projectId: PROJECT, channel: "preview", rev: 9 });
    expect(await stream.read()).toBe("");
  });

  it("closes after the stream's lifetime", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const stream = await open("staff", "production");
    expect(await stream.read()).toContain(": connected");
    await vi.advanceTimersByTimeAsync(LIVE_STREAM_MINUTES * 60_000 - 1_000);
    await engineLive.announce({ projectId: PROJECT, channel: "production", rev: 11 });
    expect(await nextLive(stream)).toEqual({ channel: "production", rev: 11 });
    await vi.advanceTimersByTimeAsync(1_000);
    for (;;) {
      const text = await stream.read();
      if (text === "") break;
      expect(text).not.toContain("event: live");
    }
  });
});
