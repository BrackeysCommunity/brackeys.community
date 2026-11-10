import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { checkedTestGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../agent-surface";
import {
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

const text = (checks: unknown[]) => JSON.stringify({ v: 1, checks }, null, 2);

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
        { id: "win", kind: "reaches", script: "win.json", result: "won", at: [300, 900] },
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
    expect(issues(JSON.stringify({ v: 2, checks: [] }))[0]!.path).toBe("/v");
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

  it("leaves an inline script to the playtest's compiler", () => {
    const r = parseChecks(
      text([{ id: "r", kind: "reaches", script: { v: 1, steps: "?" }, result: "timeout" }]),
      engine,
    );
    expect(r.ok).toBe(true);
  });
});

describe("checks schema", () => {
  it("has a URN id beside the scene schema's, the agent surface version, and describes every field", () => {
    expect(checksSchemaId(engine)).toBe("urn:jams-engine:checks:v1");
    expect(checksSchemaId(game)).toBe("urn:jams-engine:checks:test-game:v1");
    const schema = checksJsonSchema(game);
    expect(schema.$id).toBe("urn:jams-engine:checks:test-game:v1");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
    expect(JSON.stringify(schema)).toContain("test-game/props");
    expect(JSON.stringify(checksJsonSchema(engine))).toContain('"connected"');
  });

  it("accepts what parseChecks accepts, inline scripts checked in full", () => {
    const schema = checksSchemaFor(engine);
    expect(schema.safeParse(JSON.parse(yardChecks)).success).toBe(true);
    const bad = {
      v: 1,
      checks: [{ id: "r", kind: "reaches", script: { v: 1 }, result: "timeout" }],
    };
    expect(schema.safeParse(bad).success).toBe(false);
  });

  it("puts a scene's checks beside it", () => {
    expect(checksPathOf("/a/scenes/engine-yard.json")).toBe("/a/scenes/engine-yard.checks.json");
  });
});
