// @vitest-environment node
import { existsSync, readdirSync, writeFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { RapierModule } from "../../types";
import { runPlaytest } from "../playtest";
import { replayRecording } from "../recording";
import { V1_FIXTURES, type V1Fixture } from "./fixtures/recordings/v1";
import { readV1Recording, V1_DIR, v1Run, type V1Run } from "./fixtures/recordings/v1/runs";

const WRITE = process.env.UPDATE_V1_RECORDINGS === "1";
const TIMEOUT_MS = 120_000;

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** Writes a missing fixture with the v1 recorder; refuses once the recorder writes another version. */
function writeFixture(fixture: V1Fixture, run: V1Run): void {
  const played = runPlaytest(run);
  if (played.blocked) throw new Error(`${fixture.file}: blocked ${JSON.stringify(played)}`);
  const { v } = played.recording as { v: number };
  if (v !== 1) throw new Error(`${fixture.file}: the recorder writes v${v}; v1 is frozen`);
  writeFileSync(new URL(fixture.file, V1_DIR), `${JSON.stringify(played.recording, null, 2)}\n`);
}

describe("frozen v1 recordings", () => {
  it("lists every recording in the directory, each once", () => {
    const files = readdirSync(V1_DIR).filter((f) => f.endsWith(".recording.json"));
    const listed = V1_FIXTURES.map((f) => f.file);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...files].sort());
    expect(V1_FIXTURES.every((f) => f.made.length > 0)).toBe(true);
  });

  for (const fixture of V1_FIXTURES) {
    it(
      `${fixture.file} replays to the run it recorded`,
      async () => {
        const run = await v1Run(fixture, rapier, { write: WRITE });
        if (WRITE && !existsSync(new URL(fixture.file, V1_DIR))) writeFixture(fixture, run);
        const raw = readV1Recording(fixture) as {
          v: number;
          game: string | null;
          engine: { version: string };
        };
        expect(raw.v).toBe(1);
        expect(raw.engine.version).toBe("0.10.0");
        expect(raw.game).toBe(run.game?.id ?? null);

        const replay = replayRecording({ ...run, recording: raw });
        if (replay.blocked) throw new Error(`blocked: ${JSON.stringify(replay)}`);
        expect(replay.matches, replay.divergence ?? "").toBe(true);
      },
      TIMEOUT_MS,
    );
  }
});
