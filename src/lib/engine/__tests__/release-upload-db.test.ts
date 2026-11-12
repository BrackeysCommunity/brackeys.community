import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineAgentTokens,
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleaseFiles,
  engineReleaseObjects,
  engineReleases,
  engineReleaseUploads,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { PROJECT_QUOTA } from "../limits";
import { ReleaseError } from "../release-errors";
import { memoryReleaseStore } from "../release-storage";
import {
  beginRelease,
  commitRelease,
  engineAtLeast,
  indexHtmlLoadsEntry,
  putReleaseFile,
  type Actor,
  type ReleaseDeps,
  type ReleaseTxDb,
} from "../release-upload";
import { plannedRelease, type PlannedReleaseOptions } from "./release-fixture";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "fixture";
const GAME = "fixture-game";
const NOW = new Date("2026-11-12T15:00:00Z");
const HOUR = 3_600_000;
const MIB = 1_048_576;
const TOKEN = "00000000-0000-4000-8000-000000000001";

const staff: Actor = { kind: "user", userId: "staff" };
const agent: Actor = { kind: "agent", userId: "member", agentTokenId: TOKEN };
const outsider: Actor = { kind: "user", userId: "outsider" };

let clock = NOW;
let allow = true;
let store = memoryReleaseStore();
const scanned: string[] = [];

const deps = (): ReleaseDeps => ({
  db: db as unknown as ReleaseTxDb,
  store,
  now: () => clock,
  rateLimit: async () => allow,
  scan: async ({ objectKey }) => {
    scanned.push(objectKey);
  },
});

/** The fixture as an engine new enough for the site, unless the case says otherwise. */
const release = (opts: PlannedReleaseOptions = {}) =>
  plannedRelease({ projectId: PROJECT, gameId: GAME, engineVersion: "0.14.1", ...opts });

type Planned = Awaited<ReturnType<typeof release>>;

const begin = (r: Planned, actor: Actor = staff, channel?: "preview" | "none") =>
  beginRelease(deps(), {
    projectId: PROJECT,
    manifest: r.text,
    actor,
    ...(channel ? { channel } : {}),
  });

async function putAll(
  r: Planned,
  uploadId: string,
  missing: { path: string; sha256: string }[],
  actor = staff,
) {
  for (const file of missing)
    await putReleaseFile(deps(), {
      uploadId,
      sha256: file.sha256,
      body: r.files.get(file.path)!,
      actor,
    });
}

async function publish(r: Planned, actor: Actor = staff) {
  const begun = await begin(r, actor);
  await putAll(r, begun.uploadId, begun.missing, actor);
  return { begun, committed: await commitRelease(deps(), { uploadId: begun.uploadId, actor }) };
}

/** The refusal's API body, or a failure when the call went through. */
async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof ReleaseError) return { ...error.body, status: error.status };
    throw error;
  }
  throw new Error("the call wasn't refused");
}

const uploads = () => db.select().from(engineReleaseUploads);
const pointer = async (channel: "preview" | "production") =>
  (
    await db
      .select({ releaseId: engineReleaseChannels.releaseId })
      .from(engineReleaseChannels)
      .where(eq(engineReleaseChannels.channel, channel))
  )[0]?.releaseId ?? null;

const hex = (n: number) => n.toString(16).padStart(64, "0");

beforeAll(async () => {
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "member");
  await seedUser(db, "outsider");
});

beforeEach(async () => {
  clock = NOW;
  allow = true;
  store = memoryReleaseStore();
  scanned.length = 0;
  await db.delete(engineProjects);
  await db
    .insert(engineProjects)
    .values({ projectId: PROJECT, name: "Fixture", game: GAME, createdById: "member" });
  await db.insert(engineAgentTokens).values({
    id: TOKEN,
    projectId: PROJECT,
    createdById: "member",
    access: "write",
    label: "ci",
    tokenSha256: "f".repeat(64),
    expiresAt: new Date(NOW.getTime() + 24 * HOUR),
  });
});

describe("beginRelease", () => {
  it("lists every file the project doesn't hold and opens a 24-hour upload", async () => {
    const r = await release();
    const begun = await begin(r);
    expect(begun.releaseId).toBe(r.releaseId);
    expect(begun.version).toBeNull();
    expect(begun.missing.map((f) => f.path).sort()).toEqual([...r.files.keys()].sort());
    for (const f of begun.missing) expect(r.files.get(f.path)!.length).toBe(f.bytes);

    const [upload] = await uploads();
    expect(upload).toMatchObject({
      id: begun.uploadId,
      projectId: PROJECT,
      releaseId: r.releaseId,
      channel: "preview",
      actorKind: "user",
      actorId: "staff",
      committedAt: null,
    });
    expect(upload!.expiresAt.getTime() - NOW.getTime()).toBe(24 * HOUR);

    const today = (lines: typeof begun.usage.before) =>
      lines.find((l) => l.quota === "releasesPerDay")!.used;
    expect(today(begun.usage.before)).toBe(0);
    expect(today(begun.usage.after)).toBe(1);
    const storage = (lines: typeof begun.usage.before) =>
      lines.find((l) => l.quota === "releaseStorageBytes")!.used;
    expect(storage(begun.usage.after) - storage(begun.usage.before)).toBe(
      begun.missing.reduce((n, f) => n + f.bytes, 0),
    );
    expect(store.objects.size).toBe(0);
  });

  it("counts the project's blobs as held: a texture already uploaded isn't missing", async () => {
    const r = await release();
    const texture = r.manifest.build.files.find((f) => f.path.startsWith("assets/"))!;
    const { engineBlobs } = await import("@/db/schema");
    await db.insert(engineBlobs).values({
      projectId: PROJECT,
      sha256: texture.sha256,
      byteSize: texture.bytes,
      contentType: "image/png",
      storageKey: `engine-assets/${PROJECT}/${texture.sha256}`,
    });
    const { begun, committed } = await publish(r);
    expect(begun.missing.map((f) => f.path)).not.toContain(texture.path);
    const [row] = await db
      .select({ source: engineReleaseFiles.source })
      .from(engineReleaseFiles)
      .where(eq(engineReleaseFiles.path, texture.path));
    expect(row?.source).toBe("blob");
    expect(committed.created).toBe(true);
  });

  const cases: [string, () => Promise<{ text: string } & Partial<Planned>>, string, string?][] = [
    [
      "a manifest that isn't the engine's canonical text",
      async () => ({ text: JSON.stringify((await release()).manifest) }),
      "release-not-canonical",
    ],
    [
      "a build made with an older engine",
      () => release({ engineVersion: "0.14.0" }),
      "release-engine-old",
    ],
    [
      "a build of another game",
      () => release({ gameId: "other-game" }),
      "release-project-mismatch",
    ],
    [
      "a build of another project",
      () => release({ projectId: "elsewhere" }),
      "release-project-mismatch",
    ],
    [
      "a manifest of 2,001 files",
      () => release({ extraFiles: { count: 2_001, bytes: 32 } }),
      "quota-exceeded",
      "releaseFiles",
    ],
    [
      "a release of more than 100 MiB",
      () => release({ extraFiles: { count: 4, bytes: 26 * MIB } }),
      "quota-exceeded",
      "releaseBytes",
    ],
  ];

  for (const [name, make, code, limit] of cases)
    it(`refuses ${name} before any file`, async () => {
      const r = await make();
      const body = await refusal(() =>
        beginRelease(deps(), { projectId: PROJECT, manifest: r.text, actor: staff }),
      );
      expect(body.code).toBe(code);
      if (limit) expect(body.limit).toBe(limit);
      expect(body.message.length).toBeGreaterThan(0);
      expect(await uploads()).toEqual([]);
      expect(store.objects.size).toBe(0);
    }, 60_000);

  it("refuses a release past the project's release storage, with its numbers", async () => {
    const held = PROJECT_QUOTA.releaseStorageBytes - 10;
    await db.insert(engineReleaseObjects).values({
      projectId: PROJECT,
      sha256: "e".repeat(64),
      bytes: held,
      contentType: "text/javascript",
      storageKey: `engine-releases/${PROJECT}/${"e".repeat(64)}`,
    });
    const body = await refusal(async () => begin(await release()));
    expect(body).toMatchObject({
      code: "quota-exceeded",
      limit: "releaseStorageBytes",
      used: held,
      max: PROJECT_QUOTA.releaseStorageBytes,
      status: 413,
    });
    expect(await uploads()).toEqual([]);
  });

  it("refuses the 21st release of the UTC day", async () => {
    for (let i = 1; i <= PROJECT_QUOTA.releasesPerDay; i++)
      await db.insert(engineReleases).values({
        id: hex(i),
        projectId: PROJECT,
        version: i,
        manifest: "{}",
        manifestBytes: 2,
        totalBytes: 2,
        fileCount: 0,
        engineVersion: "0.14.1",
        gameId: GAME,
        snapshot: "a".repeat(64),
        buildHash: "b".repeat(64),
        target: "web",
        createdAt: new Date(NOW.getTime() - i * 60_000),
      });
    const body = await refusal(async () => begin(await release()));
    expect(body).toMatchObject({ code: "quota-exceeded", limit: "releasesPerDay", used: 20 });
    expect(await uploads()).toEqual([]);
  });

  it("refuses a caller who isn't an editor, and one past the hourly begin limit", async () => {
    const r = await release();
    expect(await refusal(() => begin(r, outsider))).toMatchObject({
      code: "release-forbidden",
      status: 403,
    });
    allow = false;
    expect(await refusal(() => begin(r))).toMatchObject({
      code: "release-rate-limited",
      status: 429,
    });
    expect(await uploads()).toEqual([]);
  });
});

describe("putReleaseFile", () => {
  it("refuses a file that isn't the one its hash names", async () => {
    const r = await release();
    const begun = await begin(r);
    const [first, second] = begun.missing;
    const body = r.files.get(first!.path)!;

    const wrongBody = await refusal(() =>
      putReleaseFile(deps(), {
        uploadId: begun.uploadId,
        sha256: first!.sha256,
        body: r.files.get(second!.path)!,
        actor: staff,
      }),
    );
    expect(wrongBody.code).toBe("hash-mismatch");

    const flipped = body.slice();
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 1;
    expect(
      (
        await refusal(() =>
          putReleaseFile(deps(), {
            uploadId: begun.uploadId,
            sha256: first!.sha256,
            body: flipped,
            actor: staff,
          }),
        )
      ).code,
    ).toBe("hash-mismatch");

    expect(
      (
        await refusal(() =>
          putReleaseFile(deps(), {
            uploadId: begun.uploadId,
            sha256: "0".repeat(64),
            body,
            actor: staff,
          }),
        )
      ).code,
    ).toBe("hash-mismatch");
    expect(store.objects.size).toBe(0);
  });

  it("stores each file once under its hash and sends images to the scan", async () => {
    const r = await release();
    const begun = await begin(r);
    await putAll(r, begun.uploadId, begun.missing);
    expect([...store.objects.keys()].sort()).toEqual(
      begun.missing.map((f) => `engine-releases/${PROJECT}/${f.sha256}`).sort(),
    );
    const images = begun.missing.filter((f) => f.path.endsWith(".png"));
    expect(images.length).toBeGreaterThan(0);
    expect(scanned.sort()).toEqual(
      images.map((f) => `engine-releases/${PROJECT}/${f.sha256}`).sort(),
    );
    const objects = await db.select().from(engineReleaseObjects);
    expect(objects).toHaveLength(begun.missing.length);
    const png = objects.find((o) => o.sha256 === images[0]!.sha256);
    expect(png?.contentType).toBe("image/png");
  });

  it("refuses past the hourly file limit", async () => {
    const r = await release();
    const begun = await begin(r);
    allow = false;
    const [file] = begun.missing;
    expect(
      await refusal(() =>
        putReleaseFile(deps(), {
          uploadId: begun.uploadId,
          sha256: file!.sha256,
          body: r.files.get(file!.path)!,
          actor: staff,
        }),
      ),
    ).toMatchObject({ code: "release-rate-limited" });
  });
});

describe("commitRelease", () => {
  it("refuses before every missing file has arrived", async () => {
    const r = await release();
    const begun = await begin(r);
    await putAll(r, begun.uploadId, begun.missing.slice(1));
    const body = await refusal(() =>
      commitRelease(deps(), { uploadId: begun.uploadId, actor: staff }),
    );
    expect(body).toMatchObject({ code: "release-files-missing", status: 409 });
    expect(await db.select().from(engineReleases)).toEqual([]);
  });

  it("records version 1, its files, the preview pointer and the audit rows", async () => {
    const r = await release();
    const { committed } = await publish(r);
    expect(committed).toMatchObject({ releaseId: r.releaseId, version: 1, created: true });
    expect(committed.playUrl).toMatch(/\/games\/fixture\/play\/1$/);

    const [row] = await db.select().from(engineReleases);
    expect(row).toMatchObject({
      id: r.releaseId,
      version: 1,
      manifest: r.text,
      fileCount: r.manifest.build.files.length,
      engineVersion: "0.14.1",
      gameId: GAME,
      target: "web",
      createdById: "staff",
      agentTokenId: null,
    });
    const files = await db.select().from(engineReleaseFiles);
    expect(files.map((f) => f.path).sort()).toEqual([...r.files.keys()].sort());
    expect(files.every((f) => f.source === "release")).toBe(true);

    expect(await pointer("preview")).toBe(r.releaseId);
    expect(await pointer("production")).toBeNull();
    const audit = await db.select().from(engineReleaseAudit).orderBy(asc(engineReleaseAudit.id));
    expect(audit.map((a) => [a.action, a.channel, a.releaseId])).toEqual([
      ["create", null, r.releaseId],
      ["promote", "preview", r.releaseId],
    ]);
    const [upload] = await uploads();
    expect(upload?.committedAt).not.toBeNull();
  });

  it("answers a second identical upload with the same version and created: false", async () => {
    const r = await release();
    await publish(r);
    const again = await begin(r);
    expect(again).toMatchObject({ releaseId: r.releaseId, version: 1, missing: [] });
    const committed = await commitRelease(deps(), { uploadId: again.uploadId, actor: staff });
    expect(committed).toMatchObject({ releaseId: r.releaseId, version: 1, created: false });
    expect(await commitRelease(deps(), { uploadId: again.uploadId, actor: staff })).toMatchObject({
      version: 1,
      created: false,
    });
    expect(await db.select().from(engineReleases)).toHaveLength(1);
    expect(await db.select().from(engineReleaseAudit)).toHaveLength(2);
  });

  it("uploads only the changed scene's data file for a build that changes one scene", async () => {
    await publish(await release());
    const next = await release({ hallVariant: 1 });
    const { begun, committed } = await publish(next);
    const data = begun.missing.filter((f) => f.path.startsWith("data/"));
    expect(data).toHaveLength(1);
    expect(begun.missing.filter((f) => /^(assets|code|icons)\//.test(f.path))).toEqual([]);
    expect(committed).toMatchObject({ version: 2, created: true });
    expect(await pointer("preview")).toBe(next.releaseId);
  });

  it("lets an agent token upload, recorded as the agent acting for its creator", async () => {
    const r = await release();
    const { committed } = await publish(r, agent);
    expect(committed).toMatchObject({ version: 1, created: true });
    const [row] = await db.select().from(engineReleases);
    expect(row).toMatchObject({ createdById: "member", agentTokenId: TOKEN });
    const audit = await db.select().from(engineReleaseAudit);
    expect(audit.every((a) => a.actorKind === "agent" && a.agentTokenId === TOKEN)).toBe(true);
  });

  it("leaves the pointers alone for an upload on no channel", async () => {
    const r = await release();
    const begun = await begin(r, staff, "none");
    await putAll(r, begun.uploadId, begun.missing);
    await commitRelease(deps(), { uploadId: begun.uploadId, actor: staff });
    expect(await pointer("preview")).toBeNull();
    const audit = await db.select().from(engineReleaseAudit);
    expect(audit.map((a) => a.action)).toEqual(["create"]);
  });

  it("refuses an expired upload's files and commit", async () => {
    const r = await release();
    const begun = await begin(r);
    clock = new Date(NOW.getTime() + 25 * HOUR);
    const [file] = begun.missing;
    expect(
      await refusal(() =>
        putReleaseFile(deps(), {
          uploadId: begun.uploadId,
          sha256: file!.sha256,
          body: r.files.get(file!.path)!,
          actor: staff,
        }),
      ),
    ).toMatchObject({ code: "release-upload-expired", status: 410 });
    expect(
      await refusal(() => commitRelease(deps(), { uploadId: begun.uploadId, actor: staff })),
    ).toMatchObject({ code: "release-upload-expired" });
  });
});

describe("the pure checks", () => {
  it("compares engine versions, a prerelease before its release", () => {
    expect(engineAtLeast("0.14.1", "0.14.1")).toBe(true);
    expect(engineAtLeast("0.15.0", "0.14.1")).toBe(true);
    expect(engineAtLeast("1.0.0", "0.14.1")).toBe(true);
    expect(engineAtLeast("0.14.0", "0.14.1")).toBe(false);
    expect(engineAtLeast("0.14.1-rc.1", "0.14.1")).toBe(false);
    expect(engineAtLeast("0.14.2-rc.1", "0.14.1")).toBe(true);
    expect(engineAtLeast("next", "0.14.1")).toBe(false);
  });

  it("takes an index.html whose one script is the entry module", () => {
    const entry = "code/main-x.js";
    const ok = `<head><script type="module" src="code/main-x.js"></script></head>`;
    expect(indexHtmlLoadsEntry(ok, entry)).toBe(true);
    expect(indexHtmlLoadsEntry(ok.replace("main-x", "other"), entry)).toBe(false);
    expect(indexHtmlLoadsEntry(`${ok}<script>alert(1)</script>`, entry)).toBe(false);
    expect(
      indexHtmlLoadsEntry(`<script type="module" src="code/main-x.js">go()</script>`, entry),
    ).toBe(false);
    expect(indexHtmlLoadsEntry(`<script src="code/main-x.js"></script>`, entry)).toBe(false);
    expect(indexHtmlLoadsEntry(`<p>no script</p>`, entry)).toBe(false);
  });
});
