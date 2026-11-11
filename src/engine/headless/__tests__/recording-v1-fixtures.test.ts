// @vitest-environment node
import { readdirSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { pxPerMetreOf } from "../../game/units";
import { parseRecording, type RunRecordingV1 } from "../../scene/recording-schema";
import { pxToMetres } from "../../scene/units";
import type { RapierModule } from "../../types";
import { replayRecording } from "../recording";
import { V1_FIXTURES } from "./fixtures/recordings/v1";
import { readV1Recording, V1_DIR, v1Run } from "./fixtures/recordings/v1/runs";

const TIMEOUT_MS = 120_000;

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

describe("frozen v1 recordings", () => {
  it("lists every recording in the directory, each once", () => {
    const files = readdirSync(V1_DIR).filter((f) => f.endsWith(".recording.json"));
    const listed = V1_FIXTURES.map((f) => f.file);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...files].sort());
    expect(V1_FIXTURES.every((f) => f.made.length > 0)).toBe(true);
    expect(V1_FIXTURES.some((f) => (readV1Recording(f) as RunRecordingV1).start.at)).toBe(true);
  });

  for (const fixture of V1_FIXTURES) {
    it(
      `${fixture.file}, recorded by 0.10.0 in px, migrates to metres and replays (${fixture.replays})`,
      async () => {
        const run = await v1Run(fixture, rapier);
        const raw = readV1Recording(fixture) as RunRecordingV1;
        expect(raw.v).toBe(1);
        expect(raw.engine.version).toBe("0.10.0");
        expect(raw.game).toBe(run.game?.id ?? null);

        const parsed = parseRecording(raw, run.registry);
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
        expect(parsed.migratedFrom).toBe(1);
        const migrated = parsed.recording;
        const ppm = pxPerMetreOf(run.registry);
        const metres = ([x, y]: readonly [number, number]) => [
          pxToMetres(x, ppm),
          pxToMetres(y, ppm),
        ];
        expect(migrated.start.at).toEqual(raw.start.at && metres(raw.start.at));
        expect(migrated.outcome.at).toEqual(raw.outcome.at && metres(raw.outcome.at));
        expect(migrated.markers.map((m) => m.at)).toEqual(raw.markers.map((m) => metres(m.at)));
        expect(migrated.trail?.pts).toEqual(raw.trail?.pts.map(metres));

        const replay = replayRecording({ ...run, recording: raw });
        if (replay.blocked) throw new Error(`blocked: ${JSON.stringify(replay)}`);
        expect(replay.migratedFrom).toBe(1);
        // The frozen scene is the v3 document, so its hash is never the migrated one's.
        expect(replay.stale).toBe(true);
        expect(replay.warnings).toContain("recorded on engine 0.10.0, replayed on 0.11.0");
        if (fixture.replays === "matches") {
          expect(replay.matches, replay.divergence ?? "").toBe(true);
          const named = (ms: typeof migrated.markers) =>
            ms.map(({ tick, type, entityId, other }) => ({ tick, type, entityId, other }));
          expect(named(replay.recording.markers)).toEqual(named(migrated.markers));
        } else {
          expect(replay.matches).toBe(false);
          expect(replay.divergence).toMatch(/^the game's end state differs/);
          // Up to its first input the run starts where it did, in metres.
          const first = raw.inputs[0]?.[0] ?? raw.ticks;
          const before = (ms: { tick: number }[]) => ms.filter((m) => m.tick < first);
          expect(before(replay.recording.markers)).toEqual(before(migrated.markers));
        }
      },
      TIMEOUT_MS,
    );
  }
});
