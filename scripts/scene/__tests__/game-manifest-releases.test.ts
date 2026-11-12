import type { RunRecording } from "@jams/engine/headless";
import type { ReleaseManifest, Sha256 } from "@jams/engine/project";
import { describe, expect, it } from "vite-plus/test";

import { matchRelease, type FoundRelease } from "../tools/game-manifest";

const SNAPSHOT = "a".repeat(64) as Sha256;
const ENGINE = "0.14.0";

const releaseOf = (
  id: string,
  over: { snapshot?: string; rate?: number; kind?: string; game?: string } = {},
): FoundRelease => ({
  id: id.repeat(64) as Sha256,
  dir: `/builds/${id}`,
  manifest: {
    engine: { version: ENGINE },
    game: { id: over.game ?? "tactics" },
    project: { snapshot: over.snapshot ?? SNAPSHOT },
    time: { kind: over.kind ?? "turns", rate: over.rate ?? 60 },
    replay: { acrossPlatforms: false },
    build: { target: "web" },
  } as unknown as ReleaseManifest,
});

const recordingOf = (over: Partial<RunRecording> = {}): RunRecording =>
  ({
    v: 2,
    engine: { version: ENGINE, physics: null },
    game: "tactics",
    project: { id: "tactics", snapshot: SNAPSHOT },
    time: { kind: "turns", rate: 60 },
    ...over,
  }) as unknown as RunRecording;

describe("matchRelease", () => {
  it("takes the run's own release id as exact", () => {
    const releases = [releaseOf("1"), releaseOf("2")];
    const match = matchRelease(recordingOf({ release: releases[1]!.id }), releases, true);
    expect(match).toMatchObject({ release: releases[1], matchedBy: "release", confirmed: true });
  });

  it("keeps the newest snapshot match that reproduces the run hash", () => {
    const releases = [releaseOf("1", { rate: 30 }), releaseOf("2"), releaseOf("3")];
    const match = matchRelease(recordingOf(), releases, false);
    expect(match).toMatchObject({ release: releases[1], matchedBy: "snapshot", confirmed: true });
  });

  it("skips a release of another snapshot or game", () => {
    const releases = [releaseOf("1", { snapshot: "b".repeat(64) }), releaseOf("2", { game: "x" })];
    const match = matchRelease(recordingOf(), [...releases, releaseOf("3")], false);
    expect(match?.release.id).toBe("3".repeat(64));
    expect(match?.confirmed).toBe(true);
  });

  it("reports the newest snapshot match unconfirmed when the replay is stale", () => {
    const releases = [releaseOf("1"), releaseOf("2")];
    for (const stale of [true, null])
      expect(matchRelease(recordingOf(), releases, stale)).toMatchObject({
        release: releases[0],
        matchedBy: "snapshot",
        confirmed: false,
      });
  });

  it("reports unconfirmed when no candidate's clock is the run's", () => {
    const releases = [releaseOf("1", { kind: "fixed" }), releaseOf("2", { rate: 30 })];
    expect(matchRelease(recordingOf(), releases, false)).toMatchObject({
      release: releases[0],
      confirmed: false,
    });
  });

  it("falls back to the snapshot when the named release isn't among them", () => {
    const releases = [releaseOf("1")];
    const match = matchRelease(recordingOf({ release: "9".repeat(64) as Sha256 }), releases, false);
    expect(match).toMatchObject({ release: releases[0], matchedBy: "snapshot", confirmed: true });
  });

  it("finds nothing without a snapshot", () => {
    expect(matchRelease(recordingOf({ project: null }), [releaseOf("1")], false)).toBeNull();
  });
});
