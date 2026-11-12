import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { checkedTestGame } from "../../__tests__/fixtures/test-game";
import { createRegistry, defineGame } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../agent-surface";
import {
  CHECKS_FORMAT_VERSION,
  CHECKS_MIGRATIONS,
  checksJsonSchema,
  checksPathOf,
  checksSchemaFor,
  checksSchemaId,
  parseChecks,
  type ChecksIssue,
} from "../checks";
import { undescribedProperties } from "../json-schema";

const engine = createRegistry();
const game = createRegistry(checkedTestGame);
const yardChecks = readFileSync(
  new URL("../../scenes/engine-yard.checks.json", import.meta.url),
  "utf8",
);

const text = (checks: unknown[], v: number = CHECKS_FORMAT_VERSION) =>
  JSON.stringify({ v, checks }, null, 2);

function issues(source: string, registry = engine): ChecksIssue[] {
  const r = parseChecks(source, registry);
  if (r.ok) throw new Error("parsed");
  return r.issues;
}

describe("parseChecks", () => {
  it("parses engine-yard's checks under the engine and under the test game", () => {
    for (const registry of [engine, game]) {
      const r = parseChecks(yardChecks, registry);
      expect(r.ok && r.file.checks.map((c) => c.kind)).toEqual(["valid", "reaches", "reaches"]);
    }
  });

  it("parses each engine kind and a game's", () => {
    const r = parseChecks(
      text([
        { id: "ok", kind: "valid", physical: true, max: "warn" },
        { id: "win", kind: "reaches", script: "win.json", result: "won", at: [3, 9.25] },
        { id: "zone", kind: "touches", entity: "zone", atLeast: 3, rollouts: 10, seed: "s" },
        { id: "props", kind: "test-game/props", atLeast: 2, skip: "not yet" },
      ]),
      game,
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.file.checks[3]).toEqual({
      id: "props",
      kind: "test-game/props",
      atLeast: 2,
      skip: "not yet",
    });
  });

  it("points at the field a check got wrong, with its line", () => {
    const [bad] = issues(text([{ id: "win", kind: "reaches", script: "w.json", result: "won" }]));
    expect(bad).toMatchObject({ path: "/checks/0/result", line: 8 });
  });

  it("names an unknown kind with a guess, and a game's kind without its registry", () => {
    expect(
      issues(text([{ id: "a", kind: "reachs", script: "s", result: "timeout" }]))[0],
    ).toMatchObject({
      path: "/checks/0/kind",
      message: 'unknown check kind "reachs"; did you mean "reaches"?',
    });
    expect(issues(text([{ id: "a", kind: "test-game/props", atLeast: 1 }]))[0]!.hint).toContain(
      "--game",
    );
  });

  it("refuses unknown keys, duplicate ids, a bad header and bad JSON", () => {
    expect(issues(text([{ id: "a", kind: "valid", strict: true }]))[0]).toMatchObject({
      path: "/checks/0/strict",
      message: 'unknown key "strict"',
    });
    const dup = issues(
      text([
        { id: "a", kind: "valid" },
        { id: "a", kind: "valid" },
      ]),
    );
    expect(dup).toEqual([expect.objectContaining({ path: "/checks/1/id" })]);
    expect(issues(JSON.stringify({ v: CHECKS_FORMAT_VERSION + 1, checks: [] }))[0]!.path).toBe(
      "/v",
    );
    expect(issues(JSON.stringify({ v: 0, checks: [] }))[0]!.path).toBe("/v");
    expect(issues("{ nope")[0]!.message).toMatch(/not JSON/);
  });

  it("caps a touches check's atLeast at its rollouts", () => {
    const [bad] = issues(
      text([{ id: "t", kind: "touches", entity: "zone", atLeast: 5, rollouts: 4 }]),
    );
    expect(bad!.path).toBe("/checks/0/atLeast");
  });

  it("parses a connected check, from and to as refs or cells", () => {
    const r = parseChecks(
      text([
        {
          id: "exit",
          kind: "connected",
          from: "start",
          to: ["exit", [40, 12], "~solid:0"],
          diagonals: true,
          blockedBy: ["solid", "plain"],
        },
        { id: "near", kind: "connected", from: [0, 0], to: [[1, 1]] },
      ]),
      game,
    );
    expect(r.ok && r.file.checks).toEqual([
      {
        id: "exit",
        kind: "connected",
        from: "start",
        to: ["exit", [40, 12], "~solid:0"],
        diagonals: true,
        blockedBy: ["solid", "plain"],
      },
      { id: "near", kind: "connected", from: [0, 0], to: [[1, 1]] },
    ]);
  });

  it("refuses a connected check with no targets, a fractional cell, or an unknown wall type", () => {
    const bad = (check: Record<string, unknown>) =>
      issues(text([{ id: "c", kind: "connected", from: "start", to: ["exit"], ...check }]));
    expect(bad({ to: [] })[0]!.path).toBe("/checks/0/to");
    expect(bad({ to: [[1.5, 2]] })[0]!.path).toMatch(/^\/checks\/0\/to\/0/);
    expect(bad({ blockedBy: ["rock"] })[0]!.path).toBe("/checks/0/blockedBy/0");
    expect(bad({ from: undefined })[0]!.path).toBe("/checks/0/from");
  });

  it("parses a reaches check's expect with the game's until keys, in the order written", () => {
    const expectClause = { count: { type: "prop", eq: 2 }, exists: "avatar", past: 300, tick: 5 };
    const r = parseChecks(
      text([{ id: "r", kind: "reaches", script: "r.json", result: "won", expect: expectClause }]),
      game,
    );
    expect(r.ok && r.file.checks[0]).toEqual({
      id: "r",
      kind: "reaches",
      script: "r.json",
      result: "won",
      expect: expectClause,
    });
    expect(r.ok && Object.keys((r.file.checks[0] as { expect: object }).expect)).toEqual([
      "count",
      "exists",
      "past",
      "tick",
    ]);
  });

  it("refuses an expect that is empty, names an unknown key or a game's predicate without its registry", () => {
    const bad = (expectClause: unknown, registry = engine) =>
      issues(
        text([
          { id: "r", kind: "reaches", script: "r.json", result: "timeout", expect: expectClause },
        ]),
        registry,
      );
    expect(bad({})[0]).toMatchObject({
      path: "/checks/0/expect",
      message: "an until clause needs at least one predicate",
    });
    expect(bad({ past: 300 })[0]).toMatchObject({
      path: "/checks/0/expect/past",
      message: 'unknown key "past"',
    });
    expect(bad({ tick: -1 }, game)[0]!.path).toBe("/checks/0/expect/tick");
  });

  it("leaves an inline script to the playtest's compiler", () => {
    const r = parseChecks(
      text([{ id: "r", kind: "reaches", script: { v: 2, steps: "?" }, result: "timeout" }]),
      engine,
    );
    expect(r.ok).toBe(true);
  });
});

describe("checks schema", () => {
  it("has a URN id beside the scene schema's, the agent surface version, and describes every field", () => {
    expect(checksSchemaId(engine)).toBe("urn:jams-engine:checks:v3");
    expect(checksSchemaId(game)).toBe("urn:jams-engine:checks:test-game:v3");
    const schema = checksJsonSchema(game);
    expect(schema.$id).toBe("urn:jams-engine:checks:test-game:v3");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
    expect(JSON.stringify(schema)).toContain("test-game/props");
    expect(JSON.stringify(checksJsonSchema(engine))).toContain('"connected"');
    const reaches = JSON.stringify(checksJsonSchema(game));
    expect(reaches).toContain("on the run's last tick");
    expect(reaches).toContain('"past"');
  });

  it("accepts what parseChecks accepts, inline scripts checked in full", () => {
    const schema = checksSchemaFor(engine);
    const yard = parseChecks(yardChecks, engine);
    expect(yard.ok && schema.safeParse(yard.file).success).toBe(true);
    const bad = {
      v: CHECKS_FORMAT_VERSION,
      checks: [{ id: "r", kind: "reaches", script: { v: 1 }, result: "timeout" }],
    };
    expect(schema.safeParse(bad).success).toBe(false);
  });

  it("judges an inline script's seats by the input map's players over the game's", () => {
    const seated = (player: number) => ({
      v: CHECKS_FORMAT_VERSION,
      checks: [
        {
          id: "r",
          kind: "reaches",
          script: { v: 2, tracks: [{ player, steps: [{ wait: 1 }] }] },
          result: "timeout",
        },
      ],
    });
    expect(checksSchemaFor(engine).safeParse(seated(0)).success).toBe(true);
    expect(checksSchemaFor(engine).safeParse(seated(2)).success).toBe(false);
    const mapped = checksSchemaFor(engine, { max: 3, join: "auto" });
    expect(mapped.safeParse(seated(2)).success).toBe(true);
    expect(mapped.safeParse(seated(3)).success).toBe(false);
    expect(checksSchemaFor(engine, null).safeParse(seated(2)).success).toBe(false);
  });

  it("puts a scene's checks beside it", () => {
    expect(checksPathOf("/a/scenes/engine-yard.json")).toBe("/a/scenes/engine-yard.checks.json");
  });
});

describe("checks v1 → v2: lengths in metres", () => {
  const reach = (at: [number, number]) => ({
    id: "win",
    kind: "reaches",
    script: "win.json",
    result: "won",
    at,
  });
  const measured = defineGame({
    id: "measured",
    types: [],
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
    world: { lengthUnit: 32 },
    checks: {
      "measured/near": {
        description: "The scene holds a spot within reach.",
        arg: z.strictObject({
          reach: z.number().describe("How far, m.").meta({ unit: "m" }),
          times: z.number().int().describe("How many."),
        }),
        run: () => ({ pass: true, message: "ok" }),
      },
    },
  });

  it("divides a reaches check's at by the game's px per metre, and nothing else", () => {
    const v1 = { v: 1, checks: [{ id: "ok", kind: "valid" }, reach([300, 910])] };
    expect(CHECKS_MIGRATIONS[1]!(v1, { registry: engine })).toEqual({
      v: 2,
      checks: [{ id: "ok", kind: "valid" }, reach([3, 9.1])],
    });
    const at32 = CHECKS_MIGRATIONS[1]!(v1, { registry: createRegistry(measured) });
    expect((at32 as { checks: unknown[] }).checks[1]).toEqual(reach([9.375, 28.4375]));
  });

  it("scales a game check's length fields by their unit", () => {
    const v1 = { v: 1, checks: [{ id: "n", kind: "measured/near", reach: 64, times: 3 }] };
    expect(CHECKS_MIGRATIONS[1]!(v1, { registry: createRegistry(measured) })).toEqual({
      v: 2,
      checks: [{ id: "n", kind: "measured/near", reach: 2, times: 3 }],
    });
  });

  it("refuses without the game's registry", () => {
    const out = CHECKS_MIGRATIONS[1]!({ v: 1, checks: [] }, {}) as {
      refused: { code: string; path: string };
    };
    expect(out.refused).toMatchObject({ code: "migration-unresolved", path: "/v" });
  });

  it("parseChecks reads a v1 file in metres", () => {
    const r = parseChecks(text([reach([300, 900])], 1), game);
    expect(r.ok && r.file).toEqual({ v: CHECKS_FORMAT_VERSION, checks: [reach([3, 9])] });
    const yard = parseChecks(yardChecks, engine);
    expect(yard.ok && yard.file.v).toBe(CHECKS_FORMAT_VERSION);
  });
});

describe("checks v2 → v3: inline scripts in the current input-script format", () => {
  const inline = (script: unknown) => ({ id: "r", kind: "reaches", script, result: "script-end" });
  const v1Script = { v: 1, at: [320, 912], steps: [{ hold: [], until: { past: 400 } }] };

  it("lifts each inline v1 script through the script migrations, its lengths in metres", () => {
    const v2 = { v: 2, checks: [{ id: "ok", kind: "valid" }, inline(v1Script), inline("a.json")] };
    expect(CHECKS_MIGRATIONS[2]!(v2, { registry: game })).toEqual({
      v: 3,
      checks: [
        { id: "ok", kind: "valid" },
        inline({ v: 2, at: [3.2, 9.12], steps: [{ hold: [], until: { past: 4 } }] }),
        inline("a.json"),
      ],
    });
  });

  it("leaves a current inline script alone, and refuses without the game's registry", () => {
    const current = { v: 2, steps: [{ wait: 1 }] };
    const lifted = CHECKS_MIGRATIONS[2]!({ v: 2, checks: [inline(current)] }, { registry: game });
    expect((lifted as { checks: { script: unknown }[] }).checks[0]!.script).toBe(current);
    const out = CHECKS_MIGRATIONS[2]!({ v: 2, checks: [] }, {}) as { refused: { code: string } };
    expect(out.refused.code).toBe("migration-unresolved");
  });

  it("parseChecks reads a v1 or v2 file with an inline v1 script as v3", () => {
    for (const v of [1, 2]) {
      const r = parseChecks(text([inline(v1Script)], v), game);
      expect(r.ok && r.file.v).toBe(3);
      expect(r.ok && r.file.checks[0]).toMatchObject({ script: { v: 2, at: [3.2, 9.12] } });
    }
    const yard = parseChecks(yardChecks, engine);
    expect(
      yard.ok && yard.file.checks.map((c) => (c as { script?: { v: number } }).script?.v),
    ).toEqual([undefined, 2, 2]);
  });
});
