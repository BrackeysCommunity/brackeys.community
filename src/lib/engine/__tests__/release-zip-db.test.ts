import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkItchLayout, zipFiles } from "@jams/engine/export";
import { RELEASE_FILE } from "@jams/engine/project";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import { engineProjects, engineReleases, teamMembers, teams } from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { filesUnder } from "../../../../scripts/scene/tools/game-manifest";
import { forgetRelease } from "../frame-route";
import { ReleaseError } from "../release-errors";
import { memoryReleaseStore } from "../release-storage";
import {
  beginRelease,
  commitRelease,
  putReleaseFile,
  type Actor,
  type ReleaseDeps,
  type ReleaseTxDb,
} from "../release-upload";
import {
  ITCH_ISSUES_HEADER,
  ITCH_ISSUES_HEADER_MAX_CHARS,
  itchIssuesHeader,
  readItchIssuesHeader,
  releaseZip,
  releaseZipResponse,
  type ReleaseZipDeps,
} from "../release-zip";
import { plannedRelease } from "./release-fixture";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "fixture";
const GAME = "fixture-game";
const NOW = new Date("2026-11-12T15:00:00Z");

const staff: Actor = { kind: "user", userId: "staff" };
const publisher: Actor = { kind: "user", userId: "member" };
const outsider: Actor = { kind: "user", userId: "outsider" };
const agent: Actor = {
  kind: "agent",
  userId: "member",
  agentTokenId: "00000000-0000-4000-8000-000000000001",
};

let store = memoryReleaseStore();
let planned: Awaited<ReturnType<typeof plannedRelease>>;

const uploadDeps = (): ReleaseDeps => ({
  db: db as unknown as ReleaseTxDb,
  store,
  now: () => NOW,
  rateLimit: async () => true,
  scan: async () => {},
});

const zipDeps = (extra: Partial<ReleaseZipDeps> = {}): ReleaseZipDeps => ({
  db: db as unknown as ReleaseTxDb,
  store,
  now: () => NOW,
  ...extra,
});

async function publish() {
  const begun = await beginRelease(uploadDeps(), {
    projectId: PROJECT,
    manifest: planned.text,
    actor: staff,
  });
  for (const file of begun.missing)
    await putReleaseFile(uploadDeps(), {
      uploadId: begun.uploadId,
      sha256: file.sha256,
      body: planned.files.get(file.path)!,
      actor: staff,
    });
  return commitRelease(uploadDeps(), { uploadId: begun.uploadId, actor: staff });
}

async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof ReleaseError) return { ...error.body, status: error.status };
    throw error;
  }
  throw new Error("the call wasn't refused");
}

/** What `game export --zip` zips: every file under the build directory, which holds `release.json` beside the build's files. */
async function zipOfBuildDirectory(): Promise<{
  zip: Uint8Array;
  files: { path: string; bytes: Uint8Array }[];
}> {
  const out = await mkdtemp(join(tmpdir(), "release-zip-"));
  try {
    const written = new Map(planned.files);
    written.set(RELEASE_FILE, new TextEncoder().encode(planned.text));
    for (const [path, bytes] of written) {
      await mkdir(dirname(join(out, path)), { recursive: true });
      await writeFile(join(out, path), bytes);
    }
    const files = await Promise.all(
      (await filesUnder(out)).map(async (path) => ({
        path,
        bytes: new Uint8Array(await readFile(join(out, path))),
      })),
    );
    return { zip: zipFiles(files), files };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "member");
  await seedUser(db, "outsider");
  planned = await plannedRelease({ projectId: PROJECT, gameId: GAME, engineVersion: "0.14.1" });
});

beforeEach(async () => {
  store = memoryReleaseStore();
  forgetRelease(planned.releaseId);
  await db.delete(engineProjects);
  await db.delete(teams);
  await db
    .insert(engineProjects)
    .values({ projectId: PROJECT, name: "Fixture", game: GAME, createdById: "member" });
  await publish();
});

describe("releaseZip", () => {
  it("is byte for byte the zip game export --zip writes for the same build", async () => {
    const expected = await zipOfBuildDirectory();
    const zip = await releaseZip({ releaseId: planned.releaseId, actor: publisher }, zipDeps());
    expect(zip.name).toBe(`${PROJECT}-v1.zip`);
    expect(Buffer.from(zip.bytes).equals(Buffer.from(expected.zip))).toBe(true);
    expect(zip.issues).toEqual(
      checkItchLayout(expected.files.map((f) => ({ path: f.path, bytes: f.bytes.length }))),
    );
  });

  it("is for publishers, editors and staff", async () => {
    const run = (actor: Actor) => releaseZip({ releaseId: planned.releaseId, actor }, zipDeps());
    await expect(run(staff)).resolves.toMatchObject({ name: `${PROJECT}-v1.zip` });
    await expect(run({ kind: "staff", userId: "staff" })).resolves.toBeTruthy();

    const [team] = await db
      .insert(teams)
      .values({
        slug: `team-${crypto.randomUUID().slice(0, 8)}`,
        name: "Team",
        createdBy: "member",
      })
      .returning({ id: teams.id });
    await db.insert(teamMembers).values([
      { teamId: team!.id, userId: "member", role: "owner" },
      { teamId: team!.id, userId: "outsider", role: "member" },
    ]);
    await db.update(engineProjects).set({ teamId: team!.id });
    await expect(run(outsider)).resolves.toBeTruthy();
  });

  it("refuses a non-publisher and an agent token", async () => {
    expect(await refusal(() => run(outsider))).toMatchObject({
      code: "release-forbidden",
      status: 403,
    });
    expect(await refusal(() => run(agent))).toMatchObject({
      code: "release-forbidden",
      status: 403,
    });
    function run(actor: Actor) {
      return releaseZip({ releaseId: planned.releaseId, actor }, zipDeps());
    }
  });

  it("answers 410 for a collected release", async () => {
    await db
      .update(engineReleases)
      .set({ collectedAt: new Date("2026-12-03T03:30:00Z"), manifest: null })
      .where(eq(engineReleases.id, planned.releaseId));
    expect(
      await refusal(() =>
        releaseZip({ releaseId: planned.releaseId, actor: publisher }, zipDeps()),
      ),
    ).toMatchObject({
      code: "release-immutable",
      status: 410,
      message: expect.stringContaining("3 Dec 2026"),
    });
  });

  it("keeps a hidden release for staff", async () => {
    await db
      .update(engineReleases)
      .set({ hiddenAt: NOW, hiddenReason: "Under review." })
      .where(eq(engineReleases.id, planned.releaseId));
    expect(
      await refusal(() =>
        releaseZip({ releaseId: planned.releaseId, actor: publisher }, zipDeps()),
      ),
    ).toMatchObject({
      code: "release-forbidden",
      message: expect.stringContaining("Under review"),
    });
    await expect(
      releaseZip({ releaseId: planned.releaseId, actor: staff }, zipDeps()),
    ).resolves.toBeTruthy();
  });

  it("answers 404 for an unknown release", async () => {
    expect(
      await refusal(() => releaseZip({ releaseId: "0".repeat(64), actor: staff }, zipDeps())),
    ).toMatchObject({ code: "not-found", status: 404 });
  });

  it("fails rather than zip a release whose file is gone from storage", async () => {
    const key = [...store.objects.keys()][0]!;
    await store.remove(key);
    await expect(
      releaseZip({ releaseId: planned.releaseId, actor: publisher }, zipDeps()),
    ).rejects.toThrow(/missing from storage/);
  });
});

describe("releaseZipResponse", () => {
  const request = new Request("http://localhost/api/engine/releases/x/zip");

  it("sends the zip as an attachment", async () => {
    const response = await releaseZipResponse(request, planned.releaseId, {
      ...zipDeps(),
      actor: publisher,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${PROJECT}-v1.zip"`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const { zip } = await zipOfBuildDirectory();
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(zip))).toBe(true);
    expect(response.headers.get(ITCH_ISSUES_HEADER)).toBeNull();
  });

  it("answers a refusal as the release API's JSON error", async () => {
    const response = await releaseZipResponse(request, planned.releaseId, {
      ...zipDeps(),
      actor: outsider,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "release-forbidden" });
  });
});

describe("itchIssuesHeader", () => {
  it("summarises itch.io's layout issues as ASCII JSON the page reads back", () => {
    const issues = checkItchLayout([
      { path: "game/index.html", bytes: 10 },
      { path: `art/${"é".repeat(250)}.png`, bytes: 10 },
    ]);
    expect(issues.length).toBeGreaterThan(1);
    const value = itchIssuesHeader(issues);
    expect(value).toMatch(/^[\x20-\x7e]+$/);
    expect(() => new Headers({ [ITCH_ISSUES_HEADER]: value })).not.toThrow();
    const read = readItchIssuesHeader(value);
    expect(read?.count).toBe(issues.length);
    expect(read?.messages[0]).toBe(issues[0]!.message);
    expect(read?.messages.every((m) => m.length <= 200)).toBe(true);
  });

  it("stays small enough for a proxy's header buffer, dropping messages but not the count", () => {
    const issue = (i: number) =>
      ({
        code: "export-itch-layout",
        severity: "warning",
        message: `${i} ${"é".repeat(190)}`,
      }) as const;
    const issues = Array.from({ length: 12 }, (_, i) => issue(i)) as unknown as Parameters<
      typeof itchIssuesHeader
    >[0];
    const value = itchIssuesHeader(issues);
    expect(value.length).toBeLessThanOrEqual(ITCH_ISSUES_HEADER_MAX_CHARS);
    const read = readItchIssuesHeader(value);
    expect(read?.count).toBe(12);
    expect(read?.messages.length).toBeGreaterThan(0);
    expect(read?.messages.length).toBeLessThan(10);
  });

  it("reads nothing from a missing or foreign header", () => {
    expect(readItchIssuesHeader(null)).toBeNull();
    expect(readItchIssuesHeader("export-itch-layout")).toBeNull();
    expect(readItchIssuesHeader('{"count":"2"}')).toBeNull();
  });
});
