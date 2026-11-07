// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { docPrefabs, docToScene, sceneToDoc } from "../collab/convert";
import { createRegistry, defineGame } from "../game/define";
import { PRIMITIVE_TYPES } from "../game/types";
import { runPlaytest } from "../headless/playtest";
import type { PlaytestReport } from "../headless/playtest-types";
import { recordingDivergence, replayRecording } from "../headless/recording";
import { runChecks } from "../headless/run-checks";
import { validatePhysical } from "../headless/validate-physical";
import { SENSOR_ENTER } from "../runtime/types";
import { parseChecks, type ChecksFile } from "../scene/checks";
import { formatPrefab, formatScene } from "../scene/format";
import { parseScene } from "../scene/parse";
import { prefabsUsedBy } from "../scene/prefab";
import { SHAPE_TYPES } from "../scene/shapes";
import type { PrefabLibrary, SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import { readPrefabFiles } from "../vite/prefab-files";
import { testGame } from "./fixtures/test-game";

const scenesDir = new URL("../scenes/", import.meta.url);
const text = readFileSync(new URL("kitchen-sink.json", scenesDir), "utf8");
const checksText = readFileSync(new URL("kitchen-sink.checks.json", scenesDir), "utf8");
const engine = createRegistry();
const game = createRegistry(testGame);

type Body = [id: string, x: number, y: number, rot: number];
const MOVING = ["ball", "crate", "shelf-box", "carrier", "deck", "deck-zone", "orbit"];

/** A game with no actor whose snapshot is every moving body's pose, so a replay's digest covers the world. */
const watcher = defineGame<Body[]>({
  id: "watcher",
  types: [],
  actions: [],
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  createRuntime(ctx) {
    return {
      snapshot: () =>
        MOVING.map((id): Body => {
          const [handle] = ctx.tags.handlesOf(id);
          const c = handle === undefined ? null : ctx.physics.world.getCollider(handle);
          const p = c?.translation() ?? { x: NaN, y: NaN };
          return [id, p.x, p.y, c?.rotation() ?? NaN];
        }),
    };
  },
});

let rapier: RapierModule;
let def: SceneDefinition;
let prefabs: PrefabLibrary;
let prefabTexts: Map<string, string>;
let checks: ChecksFile;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
  const parsed = parseScene(text, engine);
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join("\n"));
  def = parsed.def;
  const files = await readPrefabFiles(fileURLToPath(scenesDir), engine);
  expect(files.problems).toEqual([]);
  prefabs = files.prefabs;
  prefabTexts = files.texts;
  const parsedChecks = parseChecks(checksText, engine);
  if (!parsedChecks.ok) throw new Error(JSON.stringify(parsedChecks.issues));
  checks = parsedChecks.file;
});

const entities = () => def.entities ?? [];

describe("kitchen-sink.json", () => {
  describe("covers", () => {
    it("every engine primitive", () => {
      expect(new Set(entities().map((e) => e.type))).toEqual(new Set(PRIMITIVE_TYPES));
    });

    it("every shape form in bulk, a rotated box among them", () => {
      const rows = def.solid as unknown[][];
      expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(SHAPE_TYPES));
      expect(rows.some((r) => r[0] === "box" && typeof r[5] === "number" && r[5] !== 0)).toBe(true);
    });

    it("a group with three members", () => {
      const sizes = Object.keys(def.groups ?? {}).map(
        (g) => entities().filter((e) => e.group === g).length,
      );
      expect(sizes.some((n) => n >= 3)).toBe(true);
    });

    it("two prefabs placed twice each, one instance overriding a child field", () => {
      const used = prefabsUsedBy(def);
      expect(used.length).toBeGreaterThanOrEqual(2);
      for (const id of used) {
        expect(prefabs.has(id)).toBe(true);
        expect(def.instances!.filter((i) => i.prefab === id).length).toBeGreaterThanOrEqual(2);
      }
      expect(def.instances!.some((i) => Object.keys(i.overrides ?? {}).length > 0)).toBe(true);
    });

    it("a solid and a sensor attached to a follower", () => {
      const followers = new Set(
        entities()
          .filter((e) => e.type === "follower")
          .map((e) => e.id),
      );
      const attached = entities()
        .filter((e) => typeof e.attach === "string" && followers.has(e.attach))
        .map((e) => e.type);
      expect(attached).toEqual(expect.arrayContaining(["solid", "sensor"]));
    });

    it("a note per region", () => {
      expect(entities().filter((e) => e.type === "note").length).toBeGreaterThanOrEqual(5);
    });
  });

  it("validates with no errors, structural and physical", () => {
    const issues = [
      ...validateScene(def, engine, { prefabs }),
      ...validatePhysical({ rapier, scene: def, registry: engine, prefabs }),
    ];
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("is canonical, and formatting is idempotent", () => {
    const once = formatScene(def).text;
    expect(once).toBe(text);
    const again = parseScene(once, engine);
    expect(again.ok && formatScene(again.def).text).toBe(text);
    for (const [id, prefab] of prefabs) expect(formatPrefab(prefab)).toBe(prefabTexts.get(id));
  });

  it("is byte-identical file → doc → file, prefabs included, also after the doc crosses the wire", () => {
    const doc = sceneToDoc(JSON.parse(text) as SceneDefinition, { prefabs });
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    for (const d of [doc, remote]) {
      expect(formatScene(docToScene(d)).text).toBe(text);
      const back = docPrefabs(d);
      expect([...back.keys()]).toEqual([...prefabTexts.keys()]);
      for (const [id, prefab] of back) expect(formatPrefab(prefab)).toBe(prefabTexts.get(id));
    }
  });

  it("records 300 ticks and replays them to the same result and digest", () => {
    const run = runPlaytest<Body[]>({
      rapier,
      game: watcher,
      scene: def,
      prefabs,
      script: { v: 1, scene: "kitchen-sink", steps: [{ wait: 300 }] },
    });
    if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
    const report = run as PlaytestReport<Body[]>;
    expect(report.outcome.result).toBe("script-end");
    expect(report.ticks).toBe(300);
    expect(report.final!.flat().every((v) => typeof v === "string" || Number.isFinite(v))).toBe(
      true,
    );
    expect(report.events).toContainEqual(
      expect.objectContaining({ type: SENSOR_ENTER, entityId: "zone", other: "ball" }),
    );

    const replay = replayRecording<Body[]>({
      rapier,
      game: watcher,
      scene: def,
      prefabs,
      recording: JSON.parse(JSON.stringify(report.recording)),
    });
    if (replay.blocked) throw new Error(`blocked: ${JSON.stringify(replay)}`);
    expect(replay.warnings).toEqual([]);
    expect(replay.divergence).toBeNull();
    expect(replay.matches).toBe(true);
    expect(recordingDivergence(report.recording, replay.recording)).toBeNull();
    expect(replay.recording.end).toBe(report.recording.end);
    expect(replay.final).toEqual(report.final);
  });

  describe("checks", () => {
    it("pass headless under the engine registry, the touches check skipped", () => {
      const report = runChecks({
        rapier,
        scene: def,
        prefabs,
        registry: engine,
        checks,
        readFile: (path) => readFileSync(new URL(path, scenesDir), "utf8"),
      });
      expect(report.results.map((r) => [r.id, r.kind, r.pass, r.skipped !== undefined])).toEqual([
        ["valid", "valid", true, false],
        ["settles", "reaches", true, false],
        ["ball-in-zone", "touches", true, true],
      ]);
      expect(report.ok).toBe(true);
    });

    it("all pass under the test game, the touches check run", () => {
      const unskipped: ChecksFile = {
        ...checks,
        checks: checks.checks.map(({ skip: _, ...check }) => check),
      };
      const report = runChecks({
        rapier,
        scene: def,
        prefabs,
        registry: game,
        checks: unskipped,
        readFile: (path) => readFileSync(new URL(path, scenesDir), "utf8"),
      });
      expect(report.results.map((r) => r.kind)).toEqual(["valid", "reaches", "touches"]);
      for (const r of report.results) {
        expect(r.skipped, r.id).toBeUndefined();
        expect(r.pass, `${r.id}: ${r.message}`).toBe(true);
      }
    });
  });
});
