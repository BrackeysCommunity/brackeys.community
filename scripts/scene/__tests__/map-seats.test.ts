// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineGame } from "@jams/engine/game";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import type { ToolContext } from "../context";
import { fmt } from "../tools/fmt";
import { step } from "../tools/step";
import { tempProject } from "./fixtures";

/** A physics-free turns game whose snapshot logs each command it stepped with its seat. */
const seatGame = defineGame({
  id: "seat-game",
  types: [],
  actions: [{ action: "right", keys: ["d"], description: "Unused." }],
  time: { kind: "turns" },
  commands: {
    bump: { description: "Adds n.", args: z.strictObject({ n: z.number().int() }) },
    reset: { description: "Back to zero." },
  },
  createRuntime() {
    let tick = 0;
    const log: string[] = [];
    return {
      beforeStep(_dt, _actions, commands) {
        for (const c of commands) log.push(`${tick}@${c.player ?? 0}:${c.name}`);
        tick++;
      },
      snapshot: () => ({ log: [...log] }),
    };
  },
});

const YARD = {
  v: 1,
  name: "seat-yard",
  game: seatGame.id,
  bounds: [0, 0, 320, 240],
  settings: { physics: "none" },
  entities: [{ id: "start", type: "marker", at: [16, 16] }],
};

const seated = (player: number) => ({ v: 2, tracks: [{ player, steps: [{ wait: 1 }] }] });

let root: string;
let dir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-map-seats-"));
  dir = join(root, seatGame.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "seat-yard.json"), JSON.stringify(YARD, null, 2));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function ctxWith(files: Record<string, unknown>): Promise<ToolContext> {
  for (const [name, value] of Object.entries(files))
    await writeFile(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
  return {
    projects: [await tempProject(dir, { game: seatGame })],
    loadRapier: () => Promise.reject(new Error("a physics-free run loaded Rapier")),
  };
}

const inputMap = (max: number) => ({ kind: "input-map", v: 1, players: { max, join: "auto" } });

const checksFile = (player: number) => ({
  v: 3,
  checks: [{ id: "seated", kind: "reaches", script: seated(player), result: "timeout" }],
});

type Row = { id: string; kind: string; issues?: { path: string; message: string }[] };
const rowsOf = (data: unknown) => (data as { assets: Row[] }).assets;

describe("fmt judges script seats by the project's input map", () => {
  it("accepts a seat the map has in an input script and an inline checks script", async () => {
    const ctx = await ctxWith({
      "input-map.json": inputMap(3),
      "hop.script.json": seated(2),
      "seat-yard.checks.json": checksFile(2),
    });
    const r = await fmt({}, ctx);
    expect(r.exitCode, r.text).toBe(0);
    const rows = rowsOf(r.data);
    expect(rows.find((row) => row.id === "hop-script")).not.toHaveProperty("issues");
    expect(rows.find((row) => row.kind === "checks")).not.toHaveProperty("issues");
  });

  it("refuses a seat past the map's, and one past the game's without a map", async () => {
    for (const files of [
      {
        "input-map.json": inputMap(2),
        "hop.script.json": seated(2),
        "seat-yard.checks.json": checksFile(2),
      },
      { "hop.script.json": seated(1), "seat-yard.checks.json": checksFile(1) },
    ]) {
      const r = await fmt({ check: true }, await ctxWith(files));
      expect(r.exitCode, r.text).toBe(1);
      const failed = rowsOf(r.data).filter((row) => row.issues !== undefined);
      expect(failed.map((row) => row.kind).sort()).toEqual(["checks", "input-script"]);
      await rm(join(dir, "input-map.json"), { force: true });
    }
  });
});

describe("step names a command's seat", () => {
  it("prints @seat in data.commands and the tN command lines", async () => {
    const ctx = await ctxWith({ "input-map.json": inputMap(3) });
    const r = await step(
      {
        scene: "seat-yard",
        ticks: "4",
        command: ['1@2:bump={"n":3}', "2:reset", "3@1:reset"],
      },
      ctx,
    );
    expect(r.exitCode, r.text).toBe(0);
    expect(r.data).toMatchObject({
      final: { log: ["1@2:bump", "2@0:reset", "3@1:reset"] },
      commands: [
        [1, "bump", { n: 3 }, 2],
        [2, "reset"],
        [3, "reset", null, 1],
      ],
    });
    expect(r.text).toContain(
      '  t1 command @2 bump {"n":3}\n  t2 command reset\n  t3 command @1 reset',
    );
  });
});
