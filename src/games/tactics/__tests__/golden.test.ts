// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadHeadless,
  replayRecording,
  runPlaytest,
  type InputScriptV2,
  type PlaytestReport,
  type RunRecording,
} from "@jams/engine/headless";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import { tacticsGame, type TacticsRunSnapshot } from "..";
import { TACTICS_GOLDEN_DIGEST, tacticsGoldenInput } from "./pins";

// The board has no physics: the run must never initialise Rapier.
const init = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@dimforge/rapier2d-compat", () => ({ init, default: { init } }));

/**
 * Level 1 won by `level-1.script.json`, a script of commands alone, and
 * its recording kept as `fixtures/level-1.recording.json`. A replay of the
 * recording must reach `TACTICS_GOLDEN_DIGEST` on every platform.
 * `UPDATE_GOLDENS=1` rewrites the recording (run `vp fmt` on it after);
 * the pin moves only by hand.
 */

const here = (path: string) => new URL(path, import.meta.url);
const SCRIPT = here("../scenes/level-1.script.json");
const RECORDING = here("./fixtures/level-1.recording.json");
const REPO = fileURLToPath(here("../../../../"));
const UPDATE = Boolean(process.env.UPDATE_GOLDENS);

const script = JSON.parse(readFileSync(SCRIPT, "utf8")) as InputScriptV2;
const readRecording = () => JSON.parse(readFileSync(RECORDING, "utf8")) as RunRecording;

/** What a replay reproduces wherever it runs; the engine version, platform and config hash are where it ran. */
const portable = (r: RunRecording) => {
  const { engine: _e, platform: _p, configHash: _c, ...rest } = r;
  return rest;
};

async function play(): Promise<PlaytestReport<TacticsRunSnapshot>> {
  const loaded = await loadHeadless(tacticsGoldenInput());
  const report = runPlaytest<TacticsRunSnapshot>({
    ...loaded,
    rapier: null,
    game: tacticsGame,
    script,
  });
  if (report.blocked) throw new Error(`playtest blocked: ${JSON.stringify(report)}`);
  return report;
}

async function replay(recording: unknown) {
  const loaded = await loadHeadless(tacticsGoldenInput());
  const run = replayRecording<TacticsRunSnapshot>({
    ...loaded,
    rapier: null,
    game: tacticsGame,
    recording,
  });
  if (run.blocked) throw new Error(`replay blocked: ${JSON.stringify(run)}`);
  return run;
}

afterAll(() => {
  expect(init).not.toHaveBeenCalled();
});

describe("level-1.script.json", () => {
  it("sends commands and waits, and holds nothing", () => {
    for (const step of script.steps ?? []) {
      const keys = Object.keys(step).sort();
      if ("command" in step) expect(["args", "command"]).toEqual(expect.arrayContaining(keys));
      else if ("wait" in step) expect(keys).toEqual(["wait"]);
      else expect(step).toMatchObject({ hold: [], until: { side: "blue" } });
    }
    expect(script.tracks).toBeUndefined();
  });

  it("wins level 1 headless with no Rapier", async () => {
    const report = await play();
    expect(report.outcome).toMatchObject({ result: "won", cause: "the red side is gone" });
    expect(report.final?.result).toBe("won");
    expect(report.stream.actions).toEqual([]);
    expect(report.commands.length).toBeGreaterThan(0);
    expect(report.recording.engine.physics).toBeNull();
  });
});

describe("the golden recording", () => {
  it("is the script's recording, and replays it", async () => {
    const report = await play();
    if (UPDATE) writeFileSync(RECORDING, `${JSON.stringify(report.recording, null, 2)}\n`);
    const fixture = readRecording();
    expect(portable(report.recording)).toEqual(portable(fixture));

    const again = await replay(report.recording);
    expect(again.matches, again.divergence ?? "").toBe(true);
    expect(again.recording.end).toBe(report.recording.end);
  });

  it(`replays to the pinned digest ${TACTICS_GOLDEN_DIGEST}`, async () => {
    const run = await replay(readRecording());
    expect(run.stale).toBe(false);
    expect(run.matches, run.divergence ?? "").toBe(true);
    expect(run.issues).toEqual([]);
    expect(run.final?.result).toBe("won");
    expect(run.recording.end, "move TACTICS_GOLDEN_DIGEST in pins.ts only on purpose").toBe(
      TACTICS_GOLDEN_DIGEST,
    );
  });

  it("is what the scene CLI records from the project's own files", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "tactics-golden-"));
    try {
      const out = join(dir, "run.json");
      const scriptPath = fileURLToPath(SCRIPT);
      const args = ["scripts/scene/cli.ts", "playtest", "level-1", "--project", "tactics"];
      const r = spawnSync("bun", [...args, "--script", scriptPath, "--record", out], {
        cwd: REPO,
        encoding: "utf8",
      });
      expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
      const cli = JSON.parse(readFileSync(out, "utf8")) as RunRecording;
      const { project: _project, ...fromCli } = portable(cli);
      const { project: _none, ...fromFixture } = portable(readRecording());
      expect(fromCli).toEqual(fromFixture);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
