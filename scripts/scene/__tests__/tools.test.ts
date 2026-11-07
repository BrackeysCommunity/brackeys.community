// @vitest-environment node
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { RapierModule } from "@jams/engine/headless";
import { ISSUE_CODES, sceneHash, parseSceneOrThrow, type OpBatch } from "@jams/engine/scene";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { COMMAND_NAMES, runCli } from "../commands";
import type { ToolContext } from "../context";
import { apply } from "../tools/apply";
import { codes } from "../tools/codes";
import { fmt } from "../tools/fmt";
import { list } from "../tools/list";
import { schema } from "../tools/schema";
import { MAX_ROWS, show } from "../tools/show";
import { step } from "../tools/step";
import { validate } from "../tools/validate";

const YARD = fileURLToPath(new URL("../../../src/game/scenes/test-yard.json", import.meta.url));

let dir: string;
let ctx: ToolContext;
let stdin = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scene-cli-"));
  await copyFile(YARD, join(dir, "test-yard.json"));
  stdin = "";
  ctx = {
    scenesDir: dir,
    loadRapier: () => import("@dimforge/rapier2d") as Promise<RapierModule>,
    readStdin: async () => stdin,
  };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const yardText = () => readFile(join(dir, "test-yard.json"), "utf8");

describe("scene tools", () => {
  it("list reports sceneHash, counts and bounds", async () => {
    const r = await list({}, ctx);
    expect(r.exitCode).toBe(0);
    const [yard] = (r.data as { scenes: Record<string, unknown>[] }).scenes;
    expect(yard).toMatchObject({
      name: "test-yard",
      ok: true,
      sceneHash: sceneHash(parseSceneOrThrow(await yardText())),
      bounds: [-2000, -500, 4000, 1200],
      counts: { solid: 17, cloud: 3, mover: 3, anchor: 4, prop: 2, sensor: 3 },
    });
  });

  it("show prints refs with derived geometry and filters", async () => {
    const all = await show({ scene: "test-yard" }, ctx);
    const data = all.data as {
      sceneHash: string;
      entities: { ref: string }[];
      truncated: boolean;
    };
    expect(data.sceneHash).toMatch(/^[0-9a-f]{16}$/);
    expect(data.truncated).toBe(false);
    expect(data.entities[0]).toMatchObject({
      ref: "~solid:0",
      b: "solid",
      bulk: true,
      aabb: { minX: -2000, minY: 1020, maxX: 1490, maxY: 1060 },
      top: [-2000, 1490, 1020],
    });

    const lift = await show({ scene: "test-yard", ref: "elevator" }, ctx);
    expect((lift.data as { entities: unknown[] }).entities).toEqual([
      expect.objectContaining({
        ref: "elevator",
        b: "mover",
        aabb: { minX: 1260, minY: 994, maxX: 1340, maxY: 1006 },
      }),
    ]);

    const movers = await show({ scene: "test-yard", behavior: "mover" }, ctx);
    expect((movers.data as { entities: { ref: string }[] }).entities.map((e) => e.ref)).toEqual([
      "pit-shuttle",
      "elevator",
      "diagonal",
    ]);

    const near = await show({ scene: "test-yard", near: "500,800,20" }, ctx);
    expect((near.data as { entities: { ref: string }[] }).entities.map((e) => e.ref)).toContain(
      "cheese",
    );

    expect((await show({ scene: "test-yard", ref: "nope" }, ctx)).exitCode).toBe(1);
    expect((await show({ scene: "test-yard", near: "1,2" }, ctx)).exitCode).toBe(2);
  });

  it("show refuses an unknown behavior and suggests refs", async () => {
    const typo = await show({ scene: "test-yard", behavior: "movers" }, ctx);
    expect(typo.exitCode).toBe(2);
    expect(typo.text).toContain('did you mean "mover"');

    const miss = await show({ scene: "test-yard", ref: "elevater" }, ctx);
    expect(miss.exitCode).toBe(1);
    expect(miss.text).toContain("did you mean elevator?");
  });

  it("show caps its rows and says so", async () => {
    const yard = JSON.parse(await yardText());
    yard.solid = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ["box", i * 30, 1000, 10, 10]);
    yard.bounds = [-2000, -500, 10000, 1200];
    await writeFile(join(dir, "big.json"), JSON.stringify(yard));
    const r = await show({ scene: "big" }, ctx);
    const data = r.data as { entities: unknown[]; truncated: boolean; total: number };
    expect(data.truncated).toBe(true);
    expect(data.entities).toHaveLength(MAX_ROWS);
    expect(data.total).toBeGreaterThan(MAX_ROWS);
  });

  it("schema prints both schemas and refuses others", async () => {
    expect((await schema({}, ctx)).data).toMatchObject({ $id: "urn:jams-engine:scene:v1" });
    expect((await schema({ which: "ops" }, ctx)).data).toMatchObject({
      $id: "urn:jams-engine:ops:v1",
    });
    expect((await schema({ which: "script" }, ctx)).exitCode).toBe(2);
  });

  it("codes is ISSUE_CODES", async () => {
    expect((await codes({}, ctx)).data).toEqual(ISSUE_CODES);
  });

  it("validate passes test-yard and fails a broken file with lines", async () => {
    const ok = await validate({ target: "test-yard" }, ctx);
    expect(ok.exitCode).toBe(0);
    expect((ok.data as { counts: unknown }).counts).toEqual({ error: 0, warn: 0, info: 1 });

    const bad = join(dir, "bad.json");
    await writeFile(
      bad,
      (await yardText()).replace('["box", 700, 940, 80, 8]', '["box", 700, 940, 80]'),
    );
    const r = await validate({ target: bad }, ctx);
    expect(r.exitCode).toBe(1);
    const [issue] = (r.data as { issues: { code: string; line?: number }[] }).issues;
    expect(issue).toMatchObject({ code: "bad-shape", line: 14 });

    expect((await validate({ target: "../etc/passwd" }, ctx)).exitCode).toBe(1);
    const byFile = await validate({ target: "test-yard.json" }, ctx);
    expect(byFile.exitCode).toBe(1);
    expect(byFile.text).toContain("validate test-yard");
    expect((await validate({ target: "Bad Name" }, ctx)).exitCode).toBe(2);
    expect((await validate({}, ctx)).exitCode).toBe(2);
  });

  it("fmt --check reports and fmt rewrites to canonical text", async () => {
    expect((await fmt({ scene: "test-yard", check: true }, ctx)).exitCode).toBe(0);
    const yard = JSON.parse(await yardText());
    await writeFile(join(dir, "messy.json"), JSON.stringify(yard));
    expect((await fmt({ scene: "messy", check: true }, ctx)).exitCode).toBe(1);
    expect((await fmt({ scene: "messy" }, ctx)).data).toMatchObject({ changed: true });
    expect(await readFile(join(dir, "messy.json"), "utf8")).toBe(await yardText());
  });

  it("apply --dry-run returns the diff and writes nothing", async () => {
    const before = await yardText();
    await writeFile(
      join(dir, "ops.json"),
      JSON.stringify({ ops: [{ op: "update", ref: "elevator", set: { "path.speed": 140 } }] }),
    );
    const r = await apply({ scene: "test-yard", ops: join(dir, "ops.json"), dryRun: true }, ctx);
    expect(r.exitCode).toBe(0);
    expect(r.data).toMatchObject({
      ok: true,
      written: false,
      diff: [{ kind: "modified", ref: "elevator", field: "path.speed", from: 100, to: 140 }],
    });
    expect(r.data).not.toHaveProperty("def");
    expect(await yardText()).toBe(before);
  });

  it("apply writes canonical text, reads stdin, and returns 3 for a stale base", async () => {
    const batch: OpBatch = { ops: [{ op: "rename", from: "plank", to: "seesaw" }] };
    stdin = JSON.stringify(batch);
    const r = await apply({ scene: "test-yard", ops: "-" }, ctx);
    expect(r.exitCode).toBe(0);
    const text = await yardText();
    expect(text).toContain('"id": "seesaw"');
    expect((await fmt({ scene: "test-yard", check: true }, ctx)).exitCode).toBe(0);

    stdin = JSON.stringify({
      base: "0000000000000000",
      ops: [{ op: "remove", refs: ["~solid:3"] }],
    });
    const stale = await apply({ scene: "test-yard", ops: "-" }, ctx);
    expect(stale.exitCode).toBe(3);
    expect(stale.data).toMatchObject({ ok: false, issue: { code: "stale-base" } });
    expect(await yardText()).toBe(text);

    stdin = JSON.stringify({ ops: [{ op: "remove", refs: ["missing"] }] });
    expect((await apply({ scene: "test-yard", ops: "-" }, ctx)).exitCode).toBe(1);
    expect((await apply({ scene: "test-yard" }, ctx)).exitCode).toBe(2);
  });

  it("step runs the probe and carries the scene hash", async () => {
    const r = await step({ scene: "test-yard", ticks: "120", hold: "move_right" }, ctx);
    expect(r.exitCode).toBe(0);
    const data = r.data as {
      sceneHash: string;
      ticks: number;
      final: { position: { x: number } };
      configHash: string;
      landings: { on: string }[];
    };
    expect(data.sceneHash).toBe(sceneHash(parseSceneOrThrow(await yardText())));
    expect(data.configHash).toMatch(/^[0-9a-f]{16}$/);
    expect(data.ticks).toBe(120);
    expect(data.final.position.x).toBeGreaterThan(960);
    expect(data.landings[0]?.on).toBe("~solid:0");

    await writeFile(
      join(dir, "in.json"),
      JSON.stringify([
        [5, "jump", 1],
        [20, "jump", 0],
      ]),
    );
    const jumped = await step(
      { scene: "test-yard", ticks: "30", inputs: join(dir, "in.json") },
      ctx,
    );
    expect((jumped.data as { events: { type: string; tick: number }[] }).events).toContainEqual(
      expect.objectContaining({ type: "left-ground", tick: 5 }),
    );

    expect((await step({ scene: "test-yard", ticks: "0" }, ctx)).exitCode).toBe(2);
    const typo = await step({ scene: "test-yard", hold: "move_rihgt" }, ctx);
    expect(typo.exitCode).toBe(2);
    expect(typo.text).toContain('did you mean "move_right"');
    await writeFile(join(dir, "typo-in.json"), JSON.stringify([[5, "jmup", 1]]));
    expect(
      (await step({ scene: "test-yard", inputs: join(dir, "typo-in.json") }, ctx)).exitCode,
    ).toBe(2);
    await writeFile(join(dir, "bad-in.json"), JSON.stringify([[5, "jump"]]));
    expect(
      (await step({ scene: "test-yard", inputs: join(dir, "bad-in.json") }, ctx)).exitCode,
    ).toBe(2);
  });
});

describe("runCli", () => {
  it("exposes the command table in COMMAND_NAMES", () => {
    expect(COMMAND_NAMES).toEqual([
      "list",
      "show",
      "schema",
      "codes",
      "validate",
      "fmt",
      "apply",
      "step",
    ]);
  });

  it("prints JSON with --json and exits 2 on usage errors", async () => {
    const r = await runCli(["validate", "test-yard", "--json"], ctx);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, counts: { error: 0 } });

    expect((await runCli(["validate", "test-yard", "--bogus"], ctx)).exitCode).toBe(2);
    expect((await runCli(["frobnicate"], ctx)).exitCode).toBe(2);
    expect((await runCli([], ctx)).exitCode).toBe(2);
    expect((await runCli(["show", "test-yard", "--ref"], ctx)).exitCode).toBe(2);
    expect((await runCli(["help"], ctx)).stdout).toContain("apply <scene> --ops");
  });

  it("treats Object.prototype names as unknown", async () => {
    for (const name of ["toString", "constructor", "__proto__"]) {
      expect((await runCli([name], ctx)).exitCode, name).toBe(2);
    }
    expect((await runCli(["schema", "constructor"], ctx)).exitCode).toBe(2);
    expect((await runCli(["schema", "toString", "--json"], ctx)).exitCode).toBe(2);
    expect((await runCli(["shw"], ctx)).stderr).toContain('did you mean "show"');
  });

  it("returns a JSON failure when a command throws", async () => {
    const broken: ToolContext = {
      ...ctx,
      loadRapier: () => Promise.reject(new Error("no wasm here")),
    };
    const r = await runCli(["step", "test-yard", "--json"], broken);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, error: "no wasm here" });
  });

  it("accepts --flag=value and switches", async () => {
    const r = await runCli(["show", "test-yard", "--ref=ball", "--json"], ctx);
    expect(JSON.parse(r.stdout).entities).toHaveLength(1);
    expect((await runCli(["fmt", "test-yard", "--check"], ctx)).exitCode).toBe(0);
    expect((await runCli(["fmt", "test-yard", "--check=yes"], ctx)).exitCode).toBe(2);
  });
});
