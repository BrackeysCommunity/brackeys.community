// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { compileInputScript, heldEdges } from "../compile-input-script";
import type { CompileResult, ScriptIssue } from "../playtest-types";

const game = createRegistry(testGame);
const engine = createRegistry();

function issues(result: CompileResult): ScriptIssue[] {
  if (result.ok) throw new Error("compiled");
  return result.issues;
}

describe("compileInputScript", () => {
  it("compiles every step kind (golden)", () => {
    const result = compileInputScript(
      {
        $schema: "../input-script.schema.json",
        v: 1,
        scene: "engine-yard",
        at: [600, 500],
        timeOffsetMs: 250,
        game: { push: false },
        maxTicks: 900,
        steps: [
          { hold: ["right"], for: 40 },
          { hold: ["right", "push", "right"], forMs: 250 },
          { hold: ["right"], until: { event: "goal", past: 800 }, max: 90 },
          { press: "push" },
          { press: ["left", "push"] },
          { wait: 10 },
          { hold: [], until: { tick: 400 } },
        ],
      },
      game,
    );
    expect(result).toEqual({
      ok: true,
      script: {
        scene: "engine-yard",
        maxTicks: 900,
        play: { at: { x: 600, y: 500 }, timeOffsetMs: 250, game: { push: false } },
        steps: [
          { index: 0, hold: ["right"], ticks: 40 },
          { index: 1, hold: ["right", "push"], ticks: 15 },
          { index: 2, hold: ["right"], until: { event: "goal", past: 800 }, max: 90 },
          { index: 3, hold: ["push"], ticks: 1 },
          { index: 4, hold: ["left", "push"], ticks: 1 },
          { index: 5, hold: [], ticks: 10 },
          { index: 6, hold: [], until: { tick: 400 }, max: 600 },
        ],
        edges: null,
      },
    });
  });

  it("gives a static script its edges, releases before presses, up to maxTicks", () => {
    const result = compileInputScript(
      {
        v: 1,
        maxTicks: 60,
        steps: [
          { hold: ["right"], for: 10 },
          { hold: ["right", "push"], for: 5 },
          { press: "left" },
          { wait: 4 },
          { hold: ["right"], for: 100 },
          { hold: ["left"], for: 10 },
        ],
      },
      game,
    );
    expect(result.ok && result.script).toMatchObject({
      maxTicks: 60,
      play: {},
      edges: [
        [0, "right", 1],
        [10, "push", 1],
        [15, "right", 0],
        [15, "push", 0],
        [15, "left", 1],
        [16, "left", 0],
        [20, "right", 1],
      ],
    });
    expect(compileInputScript({ v: 1, steps: [{ wait: 1 }] }, engine)).toMatchObject({
      ok: true,
      script: { maxTicks: 1800, edges: [] },
    });
  });

  it("converts forMs at 60 Hz, at least one tick", () => {
    const ticksOf = (forMs: number) => {
      const r = compileInputScript({ v: 1, steps: [{ hold: ["left"], forMs }] }, game);
      return r.ok ? r.script.steps[0]!.ticks : null;
    };
    expect(ticksOf(1000)).toBe(60);
    expect(ticksOf(250)).toBe(15);
    expect(ticksOf(25)).toBe(2);
    expect(ticksOf(1)).toBe(1);
  });

  it("converts forMs at the game's rate, or the run's when given", () => {
    const script = { v: 1, steps: [{ hold: ["left"], forMs: 1000 }] };
    const ticksOf = (r: CompileResult) => (r.ok ? r.script.steps[0]!.ticks : null);
    const at30 = createRegistry({ ...testGame, time: { kind: "fixed", rate: 30 } });
    expect(ticksOf(compileInputScript(script, at30))).toBe(30);
    expect(ticksOf(compileInputScript(script, game, { rate: 30 }))).toBe(30);
    expect(ticksOf(compileInputScript(script, at30, { rate: 120 }))).toBe(120);
    expect(ticksOf(compileInputScript({ v: 1, steps: [{ hold: [], forMs: 1 }] }, at30))).toBe(1);
  });

  it("suggests the action an unknown name meant", () => {
    const found = issues(
      compileInputScript(
        {
          v: 1,
          steps: [
            { hold: ["right", "pussh"], for: 5 },
            { press: "lft" },
            { press: ["left", "rigt"] },
          ],
        },
        game,
      ),
    );
    expect(found).toEqual([
      expect.objectContaining({ path: "/steps/0/hold/1", got: '"pussh"' }),
      expect.objectContaining({ path: "/steps/1/press" }),
      expect.objectContaining({ path: "/steps/2/press/1" }),
    ]);
    expect(found.map((i) => i.message)).toEqual([
      'unknown action "pussh"; did you mean "push"? (actions: left, right, push)',
      'unknown action "lft"; did you mean "left"? (actions: left, right, push)',
      'unknown action "rigt"; did you mean "right"? (actions: left, right, push)',
    ]);
    expect(
      issues(compileInputScript({ v: 1, steps: [{ press: "jump" }] }, engine))[0]!.message,
    ).toBe('unknown action "jump" (actions: none)');
  });

  it("suggests keys and predicates, and names what a step is missing", () => {
    const found = issues(
      compileInputScript(
        {
          v: 1,
          maxTick: 10,
          steps: [
            { hold: ["right"], forr: 10 },
            { hold: ["right"] },
            { hold: ["right"], for: 5, until: { tick: 3 } },
            { hold: ["right"], for: 5, max: 3 },
            { hold: ["right"], until: { pastt: 3 } },
            { hold: ["right"], until: {} },
            { hold: ["right"], until: { past: "far" } },
            { press: "left", wait: 3 },
            {},
            "wait",
          ],
        },
        game,
      ),
    );
    const at = (path: string) => found.find((i) => i.path === path)?.message;
    expect(at("/maxTick")).toBe('unknown key "maxTick"; did you mean "maxTicks"?');
    expect(at("/steps/0/forr")).toBe('unknown key "forr"; did you mean "for"?');
    expect(at("/steps/1")).toBe("a hold step needs one of for, forMs or until");
    expect(at("/steps/2")).toBe("a hold step takes one of for, forMs or until, not for and until");
    expect(at("/steps/3/max")).toMatch(/max caps an until step/);
    expect(at("/steps/4/until/pastt")).toBe('unknown key "pastt"; did you mean "past"?');
    expect(at("/steps/5/until")).toBe("an until clause needs at least one predicate");
    expect(at("/steps/6/until/past")).toMatch(/expected number/);
    expect(at("/steps/7")).toBe(
      "a step is one of hold, press, wait, command or elapse, not press and wait",
    );
    expect(at("/steps/8")).toBe("a step needs one of hold, press, wait, command or elapse");
    expect(at("/steps/9")).toMatch(/a step is an object/);
  });

  it("checks the header: version, steps, play options and caps", () => {
    expect(issues(compileInputScript({ steps: [{ wait: 1 }] }, game))[0]!.path).toBe("/v");
    expect(issues(compileInputScript({ v: 1, steps: [] }, game))[0]!.path).toBe("/steps");
    expect(issues(compileInputScript({ v: 1 }, game))[0]!.path).toBe("/steps");
    expect(issues(compileInputScript("hold right", game))[0]!.path).toBe("");
    expect(
      issues(compileInputScript({ v: 1, game: { push: 3 }, steps: [{ wait: 1 }] }, game))[0]!.path,
    ).toBe("/game/push");
    expect(
      issues(compileInputScript({ v: 1, game: {}, steps: [{ wait: 1 }] }, engine))[0]!.path,
    ).toBe("/game");
    expect(
      issues(compileInputScript({ v: 1, maxTicks: 0, steps: [{ wait: 1 }] }, game))[0]!.path,
    ).toBe("/maxTicks");
    expect(issues(compileInputScript({ v: 1, steps: [{ wait: 0 }] }, game))[0]!.path).toBe(
      "/steps/0/wait",
    );
  });
});

describe("command and elapse steps", () => {
  const catchUp = createRegistry({
    ...testGame,
    time: { kind: "turns", catchUp: { maxMs: 5000 } },
  });

  it("compile to one slot each that sends the command and holds what the hold before held", () => {
    const result = compileInputScript(
      {
        v: 1,
        steps: [
          { hold: ["right"], for: 3 },
          { command: "nudge", args: { dx: 12 } },
          { elapse: 9000.7 },
          { press: "push" },
          { command: "nudge", args: { dx: -4 } },
          { elapse: 250.5 },
        ],
      },
      catchUp,
    );
    expect(result).toEqual({
      ok: true,
      script: {
        maxTicks: 1800,
        play: {},
        steps: [
          { index: 0, hold: ["right"], ticks: 3 },
          { index: 1, hold: ["right"], ticks: 1, commands: [{ name: "nudge", args: { dx: 12 } }] },
          {
            index: 2,
            hold: ["right"],
            ticks: 1,
            commands: [{ name: "@elapsed", args: { ms: 5000 } }],
          },
          { index: 3, hold: ["push"], ticks: 1 },
          { index: 4, hold: [], ticks: 1, commands: [{ name: "nudge", args: { dx: -4 } }] },
          { index: 5, hold: [], ticks: 1, commands: [{ name: "@elapsed", args: { ms: 250 } }] },
        ],
        edges: [
          [0, "right", 1],
          [5, "right", 0],
          [5, "push", 1],
          [6, "push", 0],
        ],
      },
    });
  });

  it("suggests the command an unknown name meant", () => {
    const found = issues(
      compileInputScript({ v: 1, steps: [{ command: "nuge", args: { dx: 1 } }] }, game),
    );
    expect(found).toEqual([
      {
        path: "/steps/0/command",
        message: 'unknown command "nuge"; did you mean "nudge"? (commands: nudge)',
        expected: '"nudge"',
        got: '"nuge"',
      },
    ]);
    expect(issues(compileInputScript({ v: 1, steps: [{ command: "go" }] }, engine))[0]).toEqual(
      expect.objectContaining({
        path: "/steps/0/command",
        message: 'unknown command "go" (commands: none)',
      }),
    );
  });

  it("refuses bad args, engine commands, stray args and elapse without catch-up", () => {
    const found = issues(
      compileInputScript(
        {
          v: 1,
          steps: [
            { command: "nudge", args: { dx: "far" } },
            { command: "nudge" },
            { command: "nudge", args: { dx: 1, dy: 2 } },
            { command: "@elapsed", args: { ms: 10 } },
            { wait: 2, args: {} },
            { elapse: 100 },
            { command: "nudge", elapse: 3 },
          ],
        },
        game,
      ),
    );
    const at = (path: string) => found.find((i) => i.path === path)?.message;
    expect(at("/steps/0/args")).toMatch(/^bad args for nudge: dx: .*expected number/i);
    expect(at("/steps/1/args")).toMatch(/^bad args for nudge: /);
    expect(at("/steps/2/args")).toMatch(/^bad args for nudge: .*dy/);
    expect(at("/steps/3/command")).toBe("@elapsed is the engine's; send it with an elapse step");
    expect(at("/steps/4/args")).toBe("args goes with a command step");
    expect(at("/steps/5/elapse")).toBe(
      "elapse needs the game's time.catchUp, and this game has none",
    );
    expect(at("/steps/6")).toBe(
      "a step is one of hold, press, wait, command or elapse, not command and elapse",
    );
    expect(issues(compileInputScript({ v: 1, steps: [{ elapse: 0 }] }, catchUp))[0]!.path).toBe(
      "/steps/0/elapse",
    );
  });
});

describe("heldEdges", () => {
  it("releases what's no longer held, then presses what's new", () => {
    expect(heldEdges(["a", "b"], ["b", "c"], 7)).toEqual([
      [7, "a", 0],
      [7, "c", 1],
    ]);
    expect(heldEdges(["a"], ["a"], 3)).toEqual([]);
  });
});
