import { sha256, type SceneVersion } from "@jams/engine/project";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineAgentTokens,
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleaseObjects,
  engineReleaseUploads,
  engineSceneChannels,
  engineSceneVersionFiles,
  engineSceneVersions,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { LIVE_LIMITS } from "../limits";
import { beginSceneVersion, commitSceneVersion } from "../live-upload";
import { memoryReleaseStore } from "../release-storage";
import { commitRelease, putReleaseFile, type Actor } from "../release-upload";
import { fixtureVersion, withVersion, type FixtureVersion } from "./fixtures/live/scene-versions";
import { plannedRelease, type PlannedRelease } from "./release-fixture";
import {
  putSceneTexts,
  refusal,
  uploadDeps,
  uploadRelease,
  uploadSceneVersion,
} from "./upload-rig";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "fixture";
const GAME = "fixture-game";
const NOW = new Date("2026-11-12T15:00:00Z");
const HOUR = 3_600_000;
const TOKEN = "00000000-0000-4000-8000-000000000001";

const staff: Actor = { kind: "user", userId: "staff" };
const agent: Actor = { kind: "agent", userId: "member", agentTokenId: TOKEN };
const outsider: Actor = { kind: "user", userId: "outsider" };

let clock = NOW;
let allow = true;
let store = memoryReleaseStore();
let release: PlannedRelease;

const deps = () => uploadDeps(store, { now: () => clock, rateLimit: async () => allow });

const encode = (text: string) => new TextEncoder().encode(text);
const hex = (n: number) => n.toString(16).padStart(64, "0");

type BeginOptions = { actor?: Actor; channel?: "preview" | "none"; note?: string };

const begin = (v: FixtureVersion, opts: BeginOptions = {}) =>
  beginSceneVersion(deps(), {
    projectId: PROJECT,
    version: v.text,
    channel: opts.channel ?? "preview",
    actor: opts.actor ?? staff,
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  });

const publish = (v: FixtureVersion, opts: BeginOptions = {}) =>
  uploadSceneVersion(deps(), v, {
    channel: opts.channel ?? "preview",
    actor: opts.actor ?? staff,
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  });

/** A marker moved, so the scene's text differs from the release's. */
const moved =
  (x: number) =>
  (scene: Record<string, unknown>): void => {
    const [start] = scene.entities as { at: [number, number] }[];
    start!.at = [x, 1];
  };

const edited = (scene: "hall" | "yard", x = 4) =>
  fixtureVersion(release, { scene, edit: moved(x) });

/** A copy of `v` changed in a way the engine's builder wouldn't, re-canonicalised. */
const tampered = (v: FixtureVersion, change: (version: SceneVersion) => void) => {
  const copy = structuredClone(v.version) as SceneVersion;
  change(copy);
  return withVersion(copy, v.texts);
};

const sceneUploads = () =>
  db.select().from(engineReleaseUploads).where(eq(engineReleaseUploads.kind, "scene"));

const previewPointer = async (scene: string) =>
  (
    await db
      .select({ versionId: engineSceneChannels.versionId, timing: engineSceneChannels.timing })
      .from(engineSceneChannels)
      .where(
        and(eq(engineSceneChannels.channel, "preview"), eq(engineSceneChannels.sceneId, scene)),
      )
  )[0] ?? null;

const sceneAudit = async () =>
  (await db.select().from(engineReleaseAudit).orderBy(asc(engineReleaseAudit.id))).filter((a) =>
    a.action.startsWith("scene-"),
  );

beforeAll(async () => {
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "member");
  await seedUser(db, "outsider");
  release = await plannedRelease({ projectId: PROJECT, gameId: GAME, engineVersion: "0.14.1" });
});

beforeEach(async () => {
  clock = NOW;
  allow = true;
  store = memoryReleaseStore();
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
  await uploadRelease(deps(), release, { actor: staff });
});

describe("beginSceneVersion", () => {
  it("lists only the changed scene text: never the version file, never a blob", async () => {
    const v = await edited("yard");
    const scene = v.version.assets.yard!;
    const begun = await begin(v);
    expect(begun).toMatchObject({ versionId: v.id, number: null, issues: [] });
    expect(begun.missing).toEqual([{ sha256: scene.sha256, bytes: scene.bytes }]);

    const [upload] = await sceneUploads();
    expect(upload).toMatchObject({
      id: begun.uploadId,
      manifest: v.text,
      releaseId: v.id,
      channel: "preview",
      sceneId: "yard",
      timing: "next-load",
      committedAt: null,
    });
    expect(upload!.expiresAt.getTime() - NOW.getTime()).toBe(24 * HOUR);

    const used = (lines: typeof begun.usage.before, quota: string) =>
      lines.find((l) => l.quota === quota)!.used;
    expect(used(begun.usage.before, "liveVersionsPerDay")).toBe(0);
    expect(used(begun.usage.after, "liveVersionsPerDay")).toBe(1);
    expect(
      used(begun.usage.after, "releaseStorageBytes") -
        used(begun.usage.before, "releaseStorageBytes"),
    ).toBe(scene.bytes + encode(v.text).byteLength);
  });

  it("lists nothing for a scene the release already ships unchanged", async () => {
    const begun = await begin(await fixtureVersion(release, { scene: "hall" }));
    expect(begun.missing).toEqual([]);
  });

  it("refuses a blob the project hasn't stored, naming its file", async () => {
    const reeds = { id: "reeds", path: "art/reeds.png", sha256: hex(9), bytes: 10 };
    const v = await fixtureVersion(release, {
      scene: "yard",
      blobs: [reeds],
      edit: (scene) => {
        scene.assets = ["reeds", "tiles"];
      },
    });
    expect(v.version.assets.reeds).toBeDefined();
    const body = await refusal(() => begin(v));
    expect(body).toMatchObject({ code: "asset-missing" });
    expect(body.message).toContain("reeds.png");
    expect(await sceneUploads()).toEqual([]);
  });

  const refusedBeforeAnyFile: [string, (v: SceneVersion) => void, string][] = [
    [
      "a scene the release doesn't list",
      (v) => {
        const asset = v.assets.hall!;
        v.scene = "cellar";
        v.entry = { ...v.entry, id: "cellar" };
        v.assets = { cellar: asset };
      },
      "live-scene-unlisted",
    ],
    [
      "another game",
      (v) => {
        v.compat.game = { id: "other-game", configHash: null };
      },
      "release-project-mismatch",
    ],
    [
      "another configuration of the game",
      (v) => {
        v.compat.game = { id: GAME, configHash: "abc" };
      },
      "live-incompatible",
    ],
    [
      "another build",
      (v) => {
        v.compat.build = { scene: hex(1) };
      },
      "live-incompatible",
    ],
    [
      "a Rapier scene on a physics-free release",
      (v) => {
        v.entry = { ...v.entry, physics: "rapier" };
      },
      "live-physics",
    ],
    [
      "another project",
      (v) => {
        v.project = "elsewhere";
      },
      "release-project-mismatch",
    ],
  ];
  for (const [what, change, code] of refusedBeforeAnyFile)
    it(`refuses ${what} with ${code} before any file`, async () => {
      const v = await tampered(await edited("hall"), change);
      expect(await refusal(() => begin(v))).toMatchObject({ code });
      expect(await sceneUploads()).toEqual([]);
    });

  const refusedForYard: [string, (v: SceneVersion) => void, string][] = [
    [
      "another scene format",
      (v) => {
        v.compat.formats = { ...v.compat.formats, scene: v.compat.formats.scene - 1 };
      },
      "live-incompatible",
    ],
    [
      "a changed texture the release ships under the same id",
      (v) => {
        v.assets = {
          ...v.assets,
          tiles: { ...v.assets.tiles!, sha256: hex(5), file: `live/${hex(5)}.png` },
        };
      },
      "live-asset-conflict",
    ],
    [
      "an entry naming a prefab it doesn't carry",
      (v) => {
        v.entry = { ...v.entry, prefabs: ["ghost"] };
      },
      "schema",
    ],
  ];
  for (const [what, change, code] of refusedForYard)
    it(`refuses ${what} with ${code} before any file`, async () => {
      const v = await tampered(await edited("yard"), change);
      expect(await refusal(() => begin(v))).toMatchObject({ code });
      expect(await sceneUploads()).toEqual([]);
    });

  it("refuses a text that isn't canonical", async () => {
    const v = await edited("hall");
    const body = await refusal(() =>
      beginSceneVersion(deps(), {
        projectId: PROJECT,
        version: JSON.stringify(v.version),
        channel: "preview",
        actor: staff,
      }),
    );
    expect(body).toMatchObject({ code: "release-not-canonical" });
  });

  /** `v` with the scene's listed bytes set so its data is exactly `total`. */
  async function withDataBytes(v: FixtureVersion, total: number) {
    let out = v;
    for (let i = 0; i < 4; i++) {
      const textBytes = encode(out.text).byteLength;
      out = await tampered(out, (copy) => {
        copy.assets = { ...copy.assets, hall: { ...copy.assets.hall!, bytes: total - textBytes } };
      });
    }
    expect(encode(out.text).byteLength + out.version.assets.hall!.bytes).toBe(total);
    return out;
  }

  it("takes a version of exactly 2 MiB and refuses one byte more", async () => {
    const v = await edited("hall");
    const max = LIVE_LIMITS.versionDataBytes;
    await expect(begin(await withDataBytes(v, max))).resolves.toMatchObject({ number: null });
    const body = await refusal(async () => begin(await withDataBytes(v, max + 1)));
    expect(body).toMatchObject({
      code: "quota-exceeded",
      limit: "liveVersionBytes",
      used: max + 1,
      max,
    });
    expect(await sceneUploads()).toHaveLength(1);
  });

  it("refuses the 101st version of the UTC day", async () => {
    const day = (n: number, at: Date) => ({
      id: hex(1000 + n),
      projectId: PROJECT,
      sceneId: "hall",
      number: n,
      descriptor: "{}",
      compatKey: hex(1),
      physics: "none",
      sceneHash: hex(2),
      dataBytes: 10,
      createdAt: at,
    });
    const yesterday = new Date(NOW.getTime() - 24 * HOUR);
    await db
      .insert(engineSceneVersions)
      .values([
        day(1, yesterday),
        ...Array.from({ length: LIVE_LIMITS.versionsPerDay - 1 }, (_, i) => day(i + 2, NOW)),
      ]);
    const v = await edited("hall");
    await expect(begin(v)).resolves.toMatchObject({ number: null });

    await db.insert(engineSceneVersions).values(day(LIVE_LIMITS.versionsPerDay + 1, NOW));
    expect(await refusal(() => begin(v))).toMatchObject({
      code: "quota-exceeded",
      limit: "liveVersionsPerDay",
      used: LIVE_LIMITS.versionsPerDay,
    });
  });

  it("checks the day's count again at commit, so concurrent publishes can't pass it", async () => {
    await db.insert(engineSceneVersions).values(
      Array.from({ length: LIVE_LIMITS.versionsPerDay - 1 }, (_, i) => ({
        id: hex(2000 + i),
        projectId: PROJECT,
        sceneId: "cellar",
        number: i + 1,
        descriptor: "{}",
        compatKey: hex(1),
        physics: "none",
        sceneHash: hex(2),
        dataBytes: 10,
        createdAt: NOW,
      })),
    );
    const hall = await edited("hall");
    const yard = await edited("yard");
    const first = await begin(hall);
    const second = await begin(yard);
    await putSceneTexts(deps(), hall, first, staff);
    await putSceneTexts(deps(), yard, second, staff);
    await expect(
      commitSceneVersion(deps(), { uploadId: first.uploadId, actor: staff }),
    ).resolves.toMatchObject({ scene: "hall", number: 1, created: true });
    expect(
      await refusal(() => commitSceneVersion(deps(), { uploadId: second.uploadId, actor: staff })),
    ).toMatchObject({
      code: "quota-exceeded",
      limit: "liveVersionsPerDay",
      used: LIVE_LIMITS.versionsPerDay,
    });
    expect(await previewPointer("yard")).toBeNull();
  });

  it("refuses a caller who isn't an editor, one past the hourly limit, and a long note", async () => {
    const v = await edited("hall");
    expect(await refusal(() => begin(v, { actor: outsider }))).toMatchObject({
      code: "release-forbidden",
    });
    expect(
      await refusal(() => begin(v, { note: "x".repeat(LIVE_LIMITS.noteChars + 1) })),
    ).toMatchObject({ code: "schema" });
    allow = false;
    const limited = await refusal(() => begin(v));
    expect(limited).toMatchObject({ code: "release-rate-limited", status: 429 });
    expect(limited.message).toContain(String(LIVE_LIMITS.beginsPerHour));
  });

  it("refuses when no release is on preview", async () => {
    await db.delete(engineReleaseChannels);
    expect(await refusal(async () => begin(await edited("hall")))).toMatchObject({
      code: "not-found",
    });
  });
});

describe("putReleaseFile for a scene upload", () => {
  it("refuses a text that isn't JSON, one that isn't a scene, and one under the wrong hash", async () => {
    const notJson = encode("not json at all\n");
    const notScene = encode("[1, 2]\n");
    const v = await edited("hall");
    const listing = async (bytes: Uint8Array) => {
      const hash = await sha256(bytes);
      return tampered(v, (copy) => {
        copy.assets = {
          ...copy.assets,
          hall: {
            ...copy.assets.hall!,
            sha256: hash,
            bytes: bytes.byteLength,
            file: `live/${hash}.json`,
          },
        };
      });
    };
    for (const bytes of [notJson, notScene]) {
      const bad = await listing(bytes);
      const begun = await begin(bad);
      const [missing] = begun.missing;
      expect(missing?.bytes).toBe(bytes.byteLength);
      const body = await refusal(() =>
        putReleaseFile(deps(), {
          uploadId: begun.uploadId,
          sha256: missing!.sha256,
          body: bytes,
          actor: staff,
        }),
      );
      expect(body).toMatchObject({ code: "schema" });
      expect(body.message).toContain("hall.json");
    }

    const good = await edited("hall", 5);
    const begun = await begin(good);
    const [missing] = begun.missing;
    const text = encode(good.texts.get(missing!.sha256)!);
    const swapped = text.slice();
    swapped[swapped.length - 2] = swapped[swapped.length - 2] === 0x7d ? 0x5d : 0x7d;
    expect(
      await refusal(() =>
        putReleaseFile(deps(), {
          uploadId: begun.uploadId,
          sha256: missing!.sha256,
          body: swapped,
          actor: staff,
        }),
      ),
    ).toMatchObject({ code: "hash-mismatch" });
    expect(
      await db
        .select()
        .from(engineReleaseObjects)
        .where(eq(engineReleaseObjects.sha256, missing!.sha256)),
    ).toEqual([]);

    await putReleaseFile(deps(), {
      uploadId: begun.uploadId,
      sha256: missing!.sha256,
      body: text,
      actor: staff,
    });
    const [stored] = await db
      .select()
      .from(engineReleaseObjects)
      .where(eq(engineReleaseObjects.sha256, missing!.sha256));
    expect(stored).toMatchObject({ contentType: "application/json", bytes: text.byteLength });
  });
});

describe("commitSceneVersion", () => {
  it("refuses before every missing text has arrived", async () => {
    const begun = await begin(await edited("hall"));
    expect(
      await refusal(() => commitSceneVersion(deps(), { uploadId: begun.uploadId, actor: staff })),
    ).toMatchObject({ code: "release-files-missing" });
    expect(await db.select().from(engineSceneVersions)).toEqual([]);
  });

  it("records version 1, its files, the version file, preview's pointer and the audit", async () => {
    const v = await edited("yard");
    const { committed } = await publish(v, { note: "Moved the start" });
    expect(committed).toEqual({
      versionId: v.id,
      scene: "yard",
      number: 1,
      created: true,
      liveOn: "preview",
    });

    const [row] = await db.select().from(engineSceneVersions);
    expect(row).toMatchObject({
      id: v.id,
      projectId: PROJECT,
      sceneId: "yard",
      number: 1,
      descriptor: v.text,
      baseReleaseId: release.releaseId,
      physics: "none",
      sceneHash: v.version.assets.yard!.sha256,
      dataBytes: encode(v.text).byteLength + v.version.assets.yard!.bytes,
      note: "Moved the start",
      createdById: "staff",
      agentTokenId: null,
    });

    const files = await db.select().from(engineSceneVersionFiles);
    const byRole = Object.fromEntries(files.map((f) => [f.role, f]));
    expect(byRole.version).toMatchObject({ sha256: v.id, ext: ".json", source: "release" });
    expect(byRole.scene).toMatchObject({
      sha256: v.version.assets.yard!.sha256,
      ext: ".json",
      source: "release",
    });
    expect(byRole.blob).toMatchObject({
      sha256: v.version.assets.tiles!.sha256,
      ext: ".png",
      source: "release",
    });
    expect(files).toHaveLength(3);

    const [versionObject] = await db
      .select()
      .from(engineReleaseObjects)
      .where(eq(engineReleaseObjects.sha256, v.id));
    expect(versionObject?.contentType).toBe("application/json");
    expect(store.objects.has(versionObject!.storageKey)).toBe(true);

    expect(await previewPointer("yard")).toEqual({ versionId: v.id, timing: "next-load" });
    const audit = await sceneAudit();
    expect(audit.map((a) => [a.action, a.channel, a.sceneId, a.sceneVersionId])).toEqual([
      ["scene-create", null, "yard", v.id],
      ["scene-promote", "preview", "yard", v.id],
    ]);
    const [preview] = await db
      .select({ liveRev: engineReleaseChannels.liveRev })
      .from(engineReleaseChannels)
      .where(eq(engineReleaseChannels.channel, "preview"));
    expect(preview?.liveRev).toBe(audit[1]!.id);
    const [upload] = await sceneUploads();
    expect(upload?.committedAt).toEqual(NOW);
  });

  it("answers an identical second publish with the same number and created: false", async () => {
    const first = await edited("hall", 4);
    await publish(first);
    const again = await publish(first);
    expect(again.begun).toMatchObject({ versionId: first.id, number: 1, missing: [] });
    expect(again.committed).toMatchObject({ number: 1, created: false, liveOn: "preview" });
    expect(await sceneAudit()).toHaveLength(2);

    const second = await edited("hall", 5);
    expect((await publish(second)).committed).toMatchObject({ number: 2, created: true });
    expect(await previewPointer("hall")).toMatchObject({ versionId: second.id });

    // Publishing the first again points preview back at it, under its own number.
    expect((await publish(first)).committed).toMatchObject({ number: 1, created: false });
    expect(await previewPointer("hall")).toMatchObject({ versionId: first.id });
    expect(await db.select().from(engineSceneVersions)).toHaveLength(2);
  });

  it("lets an agent token publish to preview, recorded as the agent acting for its creator", async () => {
    const v = await edited("hall");
    const { committed } = await publish(v, { actor: agent });
    expect(committed).toMatchObject({ number: 1, created: true, liveOn: "preview" });
    const [row] = await db.select().from(engineSceneVersions);
    expect(row).toMatchObject({ createdById: "member", agentTokenId: TOKEN });
    expect(await previewPointer("hall")).toMatchObject({ versionId: v.id });
    const audit = await sceneAudit();
    expect(audit.map((a) => [a.action, a.actorKind, a.agentTokenId])).toEqual([
      ["scene-create", "agent", TOKEN],
      ["scene-promote", "agent", TOKEN],
    ]);
  });

  it("leaves the pointers and the live rev alone for a publish on no channel", async () => {
    const v = await edited("hall");
    const revBefore = (
      await db.select({ liveRev: engineReleaseChannels.liveRev }).from(engineReleaseChannels)
    )[0]?.liveRev;
    const { committed } = await publish(v, { channel: "none" });
    expect(committed).toMatchObject({ number: 1, created: true, liveOn: null });
    expect(await previewPointer("hall")).toBeNull();
    expect((await sceneAudit()).map((a) => a.action)).toEqual(["scene-create"]);
    const [preview] = await db
      .select({ liveRev: engineReleaseChannels.liveRev })
      .from(engineReleaseChannels);
    expect(preview?.liveRev).toBe(revBefore);
  });

  it("refuses at commit a version whose carried scene names an asset it doesn't carry", async () => {
    const v = await tampered(await fixtureVersion(release, { scene: "yard" }), (copy) => {
      delete (copy.assets as Record<string, unknown>).tiles;
      copy.entry = { ...copy.entry, bundle: { entries: [], bytes: 0 } };
    });
    const begun = await begin(v);
    expect(begun.missing).toEqual([]);
    const body = await refusal(() =>
      commitSceneVersion(deps(), { uploadId: begun.uploadId, actor: staff }),
    );
    expect(body).toMatchObject({ code: "asset-missing" });
    expect(body.message).toContain("tiles");
    expect(await db.select().from(engineSceneVersions)).toEqual([]);
  });

  it("refuses an expired upload", async () => {
    const v = await edited("hall");
    const begun = await begin(v);
    await putSceneTexts(deps(), v, begun, staff);
    clock = new Date(NOW.getTime() + 25 * HOUR);
    expect(
      await refusal(() => commitSceneVersion(deps(), { uploadId: begun.uploadId, actor: staff })),
    ).toMatchObject({ code: "release-upload-expired" });
  });

  it("isn't reached through a release upload's id, nor a release commit through a scene upload", async () => {
    const begun = await begin(await edited("hall"));
    expect(
      await refusal(() => commitRelease(deps(), { uploadId: begun.uploadId, actor: staff })),
    ).toMatchObject({ code: "not-found" });
  });
});
