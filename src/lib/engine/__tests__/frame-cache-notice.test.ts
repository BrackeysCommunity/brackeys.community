import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  engineProjects,
  engineReleaseFiles,
  engineReleaseObjects,
  engineReleases,
  imageScans,
} from "@/db/schema";
import {
  ENGINE_RELEASE_NOTICE_CHANNEL,
  type ImageObjectStore,
  parseEngineReleaseNotice,
  quarantineImage,
} from "@/lib/image-quarantine";
import { createTestDb, type TestDb } from "@/test/db";

import { releaseNoticePublisher } from "../../../../services/media-scan/src/release-notice.ts";
import { announceReleaseChange, type NoticeSubscriber } from "../frame-cache-notice";
import { forgetRelease, listenForReleaseNotices, loadRelease } from "../frame-route";
import { engineReleaseObjectKey } from "../storage-keys";

const PROJECT = "notice";
const IMAGE = "c".repeat(64);
const RELEASE = "1".repeat(64);
const KEY = engineReleaseObjectKey(PROJECT, IMAGE);
const NOW = new Date("2026-11-12T15:00:00Z");

/** One Redis channel between processes: what a publish sends reaches every subscriber. */
function fakeRedis() {
  const handlers: ((channel: string, message: string) => void)[] = [];
  const subscribed = new Set<string>();
  const subscriber: NoticeSubscriber = {
    status: "ready",
    on(event, listener) {
      if (event === "message") handlers.push(listener);
      return this;
    },
    async subscribe(channel: string) {
      subscribed.add(channel);
    },
  };
  const publish = async (channel: string, message: string) => {
    if (!subscribed.has(channel)) return 0;
    for (const handler of handlers) handler(channel, message);
    return handlers.length;
  };
  return { subscriber, publish, subscribed };
}

const bucket: ImageObjectStore = { move: async () => {}, remove: async () => {} };

let db: TestDb;
const redis = fakeRedis();

beforeAll(async () => {
  globalThis.__appReleaseNoticeSubscriber = undefined;
  await listenForReleaseNotices({ subscriber: async () => redis.subscriber });
});

beforeEach(async () => {
  forgetRelease(RELEASE);
  db = await createTestDb();
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Notice" });
  await db.insert(engineReleaseObjects).values({
    projectId: PROJECT,
    sha256: IMAGE,
    bytes: 4,
    contentType: "image/png",
    storageKey: KEY,
  });
  await db.insert(engineReleases).values({
    id: RELEASE,
    projectId: PROJECT,
    version: 1,
    manifest: "{}",
    manifestBytes: 2,
    totalBytes: 4,
    fileCount: 1,
    engineVersion: "0.14.1",
    gameId: "tactics",
    snapshot: "a".repeat(64),
    buildHash: "b".repeat(64),
    target: "web",
  });
  await db.insert(engineReleaseFiles).values({
    releaseId: RELEASE,
    projectId: PROJECT,
    path: "assets/hero.png",
    sha256: IMAGE,
    bytes: 4,
    role: "asset",
    source: "release",
  });
  await db.insert(imageScans).values({
    objectKey: KEY,
    ownerType: "engine_release_file",
    ownerId: PROJECT,
    uploaderId: null,
    status: "scanned",
  });
});

const load = () => loadRelease(RELEASE, { db, now: () => NOW });

describe("the frame cache's release notice", () => {
  it("subscribes once to the shared channel", () => {
    expect([...redis.subscribed]).toEqual([ENGINE_RELEASE_NOTICE_CHANNEL]);
  });

  it("drops a release the media-scan worker's quarantine hid", async () => {
    expect((await load())?.hidden).toBe(false);

    await quarantineImage(db, bucket, KEY, {
      purge: async () => {},
      announce: releaseNoticePublisher({ publish: redis.publish }),
    });

    expect((await load())?.hidden).toBe(true);
  });

  it("without the notice, the cached answer stands until its TTL", async () => {
    expect((await load())?.hidden).toBe(false);
    await quarantineImage(db, bucket, KEY, { purge: async () => {} });
    expect((await load())?.hidden).toBe(false);
  });

  it("drops a whole project's releases, here at once and elsewhere through Redis", async () => {
    expect((await load())?.hidden).toBe(false);
    await db.update(engineProjects).set({ hiddenAt: NOW, hiddenReason: "Reported." });
    const sent: string[] = [];
    await announceReleaseChange(
      { releaseIds: [], projectIds: [PROJECT] },
      { publish: async (_channel, message) => void sent.push(message) },
    );

    expect((await load())?.hidden).toBe(true);
    expect(sent.map(parseEngineReleaseNotice)).toEqual([{ releaseIds: [], projectIds: [PROJECT] }]);
  });

  it("ignores a message that isn't a notice", () => {
    expect(parseEngineReleaseNotice("not json")).toBeNull();
    expect(parseEngineReleaseNotice(JSON.stringify({ releaseIds: [1] }))).toBeNull();
    expect(parseEngineReleaseNotice(JSON.stringify({ releaseIds: ["a"] }))).toEqual({
      releaseIds: ["a"],
      projectIds: [],
    });
  });
});
