import { liveCompat, liveCompatKey, type SceneVersion } from "@jams/engine/project";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { PROJECT_QUOTA } from "../limits";
import {
  extraBytesOf,
  pointerTargetVerdict,
  type PointerTargetFacts,
  type PointerTargetVersion,
} from "../live-pointers";
import { fixtureVersion, withVersion, type FixtureVersion } from "./fixtures/live/scene-versions";
import { plannedRelease, type PlannedRelease } from "./release-fixture";

let release: PlannedRelease;
let fixture: FixtureVersion;
let releaseKey: string;
let versionKey: string;

const moved = (scene: Record<string, unknown>): void => {
  const [start] = scene.entities as { at: [number, number] }[];
  start!.at = [4, 1];
};

beforeAll(async () => {
  release = await plannedRelease({
    projectId: "fixture",
    gameId: "fixture-game",
    engineVersion: "0.14.1",
  });
  fixture = await fixtureVersion(release, { scene: "hall", edit: moved });
  releaseKey = await liveCompatKey(liveCompat(release.manifest));
  versionKey = await liveCompatKey(fixture.version.compat);
});

const version = (over: Partial<PointerTargetVersion> = {}): PointerTargetVersion => ({
  scene: "hall",
  number: 3,
  descriptor: fixture.text,
  compatKey: versionKey,
  collectedAt: null,
  hiddenAt: null,
  hiddenReason: null,
  blockedAt: null,
  blockedBy: null,
  blockReason: null,
  reportsOk: 0,
  reportsFailed: 0,
  ...over,
});

const facts = (over: Partial<PointerTargetFacts> = {}): PointerTargetFacts => ({
  channel: "preview",
  scene: "hall",
  version: version(),
  release: { version: 2, manifest: release.text, liveCompatKey: releaseKey, totalBytes: 1_000 },
  extraBytes: 500,
  otherExtraBytes: 0,
  ...over,
});

const refusal = (f: PointerTargetFacts) => {
  const verdict = pointerTargetVerdict(f);
  if (verdict.ok) throw new Error("the version was accepted");
  return verdict;
};

describe("pointerTargetVerdict", () => {
  it("accepts a version that fits the release and answers its extra bytes", () => {
    expect(versionKey).toBe(releaseKey);
    expect(pointerTargetVerdict(facts())).toEqual({ ok: true, extraBytes: 500 });
  });

  it("refuses a version that doesn't exist", () => {
    expect(refusal(facts({ version: null }))).toMatchObject({
      why: "missing",
      label: "hall",
      error: { code: "not-found" },
    });
  });

  it("refuses a collected version as release-immutable, naming its UTC day", () => {
    const at = new Date("2026-12-02T23:30:00Z");
    const verdict = refusal(facts({ version: version({ collectedAt: at, descriptor: null }) }));
    expect(verdict).toMatchObject({
      why: "collected",
      label: "hall@3",
      reason: "it was removed on 2 Dec 2026",
      error: {
        code: "release-immutable",
        message: "hall@3 was removed on 2 Dec 2026; its files are gone.",
      },
    });
  });

  it("refuses a hidden version as release-forbidden with staff's reason", () => {
    const verdict = refusal(
      facts({ version: version({ hiddenAt: new Date(), hiddenReason: "Spam" }) }),
    );
    expect(verdict).toMatchObject({
      why: "hidden",
      error: { code: "release-forbidden", message: "hall@3 is hidden: Spam" },
    });
  });

  it("refuses a blocked version as live-blocked: a person's reason, or the breaker's counts", () => {
    const byPerson = refusal(
      facts({
        version: version({ blockedAt: new Date(), blockedBy: "user", blockReason: "Softlocks" }),
      }),
    );
    expect(byPerson).toMatchObject({
      why: "blocked",
      error: {
        code: "live-blocked",
        message: "hall@3 is blocked: Softlocks",
        hint: "Unblock it on the game's page, or publish a fixed version.",
      },
    });
    const byBreaker = refusal(
      facts({
        version: version({
          blockedAt: new Date(),
          blockedBy: "system",
          reportsOk: 10,
          reportsFailed: 6,
        }),
      }),
    );
    expect(byBreaker.error.message).toBe(
      "hall@3 is blocked: 6 of 16 players' games failed after it.",
    );
  });

  it("checks collected, then hidden, then blocked", () => {
    const all = version({
      collectedAt: new Date("2026-12-02T00:00:00Z"),
      hiddenAt: new Date(),
      blockedAt: new Date(),
      blockedBy: "user",
    });
    expect(refusal(facts({ version: all })).why).toBe("collected");
    expect(refusal(facts({ version: { ...all, collectedAt: null } })).why).toBe("hidden");
  });

  it("refuses a version the release can't take, with the engine's issue", async () => {
    const copy = structuredClone(fixture.version) as SceneVersion;
    copy.project = "another";
    const other = await withVersion(copy, fixture.texts);
    const verdict = refusal(facts({ version: version({ descriptor: other.text }) }));
    expect(verdict).toMatchObject({
      why: "incompatible",
      reason: "it doesn't fit v2",
      error: { code: "live-incompatible" },
    });
  });

  it("refuses every version on a release published before live scenes", () => {
    const old = facts().release;
    expect(refusal(facts({ release: { ...old, liveCompatKey: "" } }))).toMatchObject({
      why: "incompatible",
      error: { code: "live-incompatible" },
    });
    expect(refusal(facts({ release: { ...old, manifest: null } })).why).toBe("incompatible");
  });

  it("refuses a version built against other facts than the release's key", () => {
    expect(refusal(facts({ version: version({ compatKey: "0".repeat(64) }) })).error.code).toBe(
      "live-incompatible",
    );
  });

  it("holds the channel to a release's size: the release, every other pointer and this one", () => {
    const max = PROJECT_QUOTA.releaseBytes;
    const at = (totalBytes: number, otherExtraBytes: number, extraBytes: number) =>
      pointerTargetVerdict(
        facts({ release: { ...facts().release, totalBytes }, otherExtraBytes, extraBytes }),
      );
    expect(at(max - 300, 100, 200)).toEqual({ ok: true, extraBytes: 200 });
    const over = at(max - 300, 100, 201);
    if (over.ok) throw new Error("the channel went past its size");
    expect(over).toMatchObject({
      why: "size",
      error: { code: "quota-exceeded", limit: "releaseBytes", used: max + 1, max },
    });
    expect(over.reason).toMatch(/^it would take preview past /);
  });
});

describe("extraBytesOf", () => {
  it("counts each hash the release doesn't list once", () => {
    const files = [
      { sha256: "a", bytes: 10 },
      { sha256: "b", bytes: 20 },
      { sha256: "b", bytes: 20 },
      { sha256: "c", bytes: 40 },
    ];
    expect(extraBytesOf(files, new Set(["c"]))).toBe(30);
    expect(extraBytesOf(files, new Set(["a", "b", "c"]))).toBe(0);
  });
});
