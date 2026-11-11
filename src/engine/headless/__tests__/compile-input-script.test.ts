// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry, defineGame } from "../../game/define";
import { resolveTime } from "../../game/time";
import type { GameDefinition, PlayState, Registry } from "../../game/types";
import type { TickInput } from "../../input/stream";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { createRunRecorder, recordingRapier } from "../../runtime/recorder";
import { resolveGame } from "../../runtime/runtime";
import { parseInputScript } from "../../scene/input-script";
import { SCENE_FORMAT_VERSION, type PrefabLibrary, type SceneDefinition } from "../../scene/types";
import type { RapierModule } from "../../types";
import {
  compileInputScript,
  heldEdges,
  pointerAt,
  scriptSource,
  type CompiledScript,
} from "../compile-input-script";
import { prepareRun, runLibrary, runLoop, startRun } from "../play-loop";
import { runPlaytest, untilHolds } from "../playtest";
import type { CompileResult, InputEdge, ScriptIssue } from "../playtest-types";
import { replayRecording } from "../recording";
import { V1_FIXTURES } from "./fixtures/recordings/v1";
import { readV1Recording, v1Run } from "./fixtures/recordings/v1/runs";

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

  it("compiles the engine's exists and count predicates", () => {
    const result = compileInputScript(
      {
        v: 1,
        steps: [
          { hold: [], until: { exists: "boss#1" }, max: 600 },
          { hold: [], until: { exists: { id: "boss#1", enabled: false } } },
          { hold: [], until: { count: { type: "lamp", max: 0 } } },
          { hold: [], until: { count: { type: ["lamp", "sensor"], tag: "coin", min: 3, max: 5 } } },
          { hold: [], until: { count: { tag: "coin", eq: 3, enabled: false }, tick: 9 } },
        ],
      },
      game,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.script.steps.map((s) => s.until)).toEqual([
      { exists: "boss#1" },
      { exists: { id: "boss#1", enabled: false } },
      { count: { type: "lamp", max: 0 } },
      { count: { type: ["lamp", "sensor"], tag: "coin", min: 3, max: 5 } },
      { count: { tag: "coin", eq: 3, enabled: false }, tick: 9 },
    ]);
  });

  it("refuses a malformed exists or count, with a guess for a misspelt key", () => {
    const found = issues(
      compileInputScript(
        {
          v: 1,
          steps: [
            { hold: [], until: { count: { type: "lamp" } } },
            { hold: [], until: { count: { type: "lamp", eq: 1, min: 0 } } },
            { hold: [], until: { count: { type: "lamp", min: 3, max: 1 } } },
            { hold: [], until: { count: { tags: "coin", min: 1 } } },
            { hold: [], until: { count: { type: "lampp", min: 1 } } },
            { hold: [], until: { count: { min: -1 } } },
            { hold: [], until: { exists: { id: "boss#1", enabled: true } } },
            { hold: [], until: { exists: "" } },
            { hold: [], until: { exist: "boss#1" } },
          ],
        },
        game,
      ),
    );
    const at = (path: string) => found.find((i) => i.path === path)?.message;
    expect(at("/steps/0/until/count")).toBe("a count needs min, max or eq");
    expect(at("/steps/1/until/count/eq")).toBe("eq goes alone, without min or max");
    expect(at("/steps/2/until/count/min")).toBe("min 3 is over max 1");
    expect(at("/steps/3/until/count/tags")).toBe('unknown key "tags"; did you mean "tag"?');
    expect(at("/steps/4/until/count/type")).toBe(
      'unknown entity type "lampp"; did you mean "lamp"?',
    );
    expect(at("/steps/5/until/count/min")).toMatch(/>=0/);
    expect(at("/steps/6/until/exists")).toBeDefined();
    expect(at("/steps/7/until/exists")).toBeDefined();
    expect(at("/steps/8/until/exist")).toBe('unknown key "exist"; did you mean "exists"?');
  });

  it("checks the header: version, steps, play options and caps", () => {
    expect(issues(compileInputScript({ steps: [{ wait: 1 }] }, game))[0]!.path).toBe("/v");
    expect(issues(compileInputScript({ v: 1, steps: [] }, game))[0]!.path).toBe("/steps");
    expect(issues(compileInputScript({ v: 1 }, game))[0]).toMatchObject({
      path: "",
      message: "a script needs `steps` (seat 0's) or `tracks` (one per seat)",
    });
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

  it("points a duration on a step other than hold at the hold step", () => {
    const found = issues(
      compileInputScript(
        {
          v: 1,
          steps: [
            { wait: 1, until: { tick: 5 } },
            { press: "right", max: 10 },
          ],
        },
        game,
      ),
    );
    expect(found.map((i) => [i.path, i.message])).toEqual([
      [
        "/steps/0/until",
        'until goes with a hold step; { "hold": [], "until": … } waits holding nothing',
      ],
      [
        "/steps/1/max",
        'max goes with a hold step; { "hold": [], "until": … } waits holding nothing',
      ],
    ]);
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

// ─── input-script v2 ─────────────────────────────────────

type PadsSnapshot = { log: unknown[] };

/**
 * Two seats a host assigns, a button, an axis, a vector and a command; each
 * tick it logs what `ctx.input` holds for both seats, the commands and the
 * seats' devices.
 */
const padsGame = defineGame<PadsSnapshot>({
  id: "pads",
  types: [],
  actions: [
    { action: "fire", bindings: [{ device: "key", code: "Space" }], description: "Fire." },
    {
      action: "steer",
      kind: "axis",
      bindings: [{ device: "pad", axis: "left-x" }],
      description: "Steer.",
    },
    {
      action: "move",
      kind: "vector",
      bindings: [{ device: "pad", stick: "left" }],
      description: "Move.",
    },
  ],
  commands: { ping: { description: "Ping." } },
  input: { players: { max: 2, join: "host" } },
  world: { physics: "none" },
  createRuntime: (ctx) => {
    const log: unknown[] = [];
    return {
      beforeStep(_dt, _actions, commands) {
        const i = ctx.input;
        log.push([
          ctx.tick,
          [0, 1].map((p) => [
            i.held("fire", p),
            i.value("steer", p),
            i.vector("move", p),
            i.pointer(p),
          ]),
          commands.map((c) => [c.name, c.player ?? 0]),
          i.players().map((p) => [...p.devices]),
        ]);
      },
      snapshot: () => ({ log: structuredClone(log) }),
    };
  },
});
const pads = createRegistry(padsGame);
const padsScene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "pads",
  game: "pads",
  bounds: [0, 0, 10, 10],
  entities: [{ id: "start", type: "marker", at: [1, 1], tags: ["spawn"] }],
};

function compiled(script: unknown, registry: Registry): CompiledScript {
  const result = compileInputScript(script, registry);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.script as CompiledScript;
}

describe("input-script v2", () => {
  it("compiles a v2 script written with v1's steps exactly as the v1 script", () => {
    const v1 = {
      v: 1,
      at: [6, 5],
      steps: [
        { hold: ["right"], for: 3 },
        { command: "nudge", args: { dx: 1 } },
        { press: "push" },
        { wait: 2 },
        { hold: ["left"], until: { tick: 9 } },
      ],
    };
    expect(compileInputScript({ ...v1, v: 2 }, game)).toEqual(compileInputScript(v1, game));
  });

  it("compiles set, pointer, join and leave; one-slot steps carry the values before them", () => {
    const script = compiled(
      {
        v: 2,
        players: 2,
        steps: [
          { set: { steer: 0.5, move: [0.6, -0.8] }, for: 10 },
          { hold: ["fire"], set: { steer: -0.12345 }, forMs: 50 },
          { command: "ping" },
          { pointer: { at: [1.5, 2], press: "primary" } },
          { pointer: { at: [1.5, 2], drag: [3.5, 2], release: "primary" }, for: 5 },
          { join: "pad:0" },
          { leave: "pad:0" },
          { wait: 2 },
          { set: { move: [0, 1] }, until: { tick: 40 }, max: 30 },
          { pointer: { at: [0, 0] }, until: { tick: 50 } },
        ],
      },
      pads,
    );
    const carried = { hold: ["fire"], set: { steer: -0.123 } };
    expect(script).toEqual({
      maxTicks: 1800,
      play: {},
      players: 2,
      edges: null,
      steps: [
        { index: 0, hold: [], ticks: 10, set: { steer: 0.5, move: { x: 0.6, y: -0.8 } } },
        { index: 1, ticks: 3, ...carried },
        { index: 2, ticks: 1, ...carried, commands: [{ name: "ping" }] },
        { index: 3, ticks: 1, ...carried, pointer: { at: { x: 1.5, y: 2 }, press: "primary" } },
        {
          index: 4,
          ticks: 5,
          ...carried,
          pointer: { at: { x: 1.5, y: 2 }, drag: { x: 3.5, y: 2 }, release: "primary" },
        },
        { index: 5, ticks: 1, ...carried, joins: [{ device: "pad:0", joined: true }] },
        { index: 6, ticks: 1, ...carried, joins: [{ device: "pad:0", joined: false }] },
        { index: 7, hold: [], ticks: 2 },
        { index: 8, hold: [], set: { move: { x: 0, y: 1 } }, until: { tick: 40 }, max: 30 },
        {
          index: 9,
          hold: [],
          set: { move: { x: 0, y: 1 } },
          pointer: { at: { x: 0, y: 0 } },
          until: { tick: 50 },
          max: 600,
        },
      ],
    });
  });

  it("compiles tracks, one per seat, with seat 0's button edges", () => {
    const script = compiled(
      {
        v: 2,
        tracks: [
          { player: 1, steps: [{ join: "pad:0" }, { set: { steer: 1 }, for: 4 }] },
          { player: 0, steps: [{ hold: ["fire"], for: 2 }, { wait: 1 }] },
        ],
      },
      pads,
    );
    expect(script.steps).toEqual([]);
    expect(script.tracks).toEqual([
      {
        player: 1,
        steps: [
          { index: 0, hold: [], ticks: 1, joins: [{ device: "pad:0", joined: true }] },
          { index: 1, hold: [], ticks: 4, set: { steer: 1 } },
        ],
      },
      {
        player: 0,
        steps: [
          { index: 0, hold: ["fire"], ticks: 2 },
          { index: 1, hold: [], ticks: 1 },
        ],
      },
    ]);
    expect(script.edges).toEqual([
      [0, "fire", 1],
      [2, "fire", 0],
    ]);
  });

  it("refuses bad values, buttons set, a value held and set, and a drag or release with no fixed end", () => {
    const found = issues(
      compileInputScript(
        {
          v: 2,
          steps: [
            { set: { fire: 1 }, for: 2 },
            { set: { stear: 1 }, for: 2 },
            { set: { steer: 2 }, for: 2 },
            { set: { move: [1, 1] }, for: 2 },
            { set: { steer: 1 } },
            { hold: ["steer"], set: { steer: 1 }, for: 2 },
            { pointer: { at: [0, 0], drag: [1, 0] }, until: { tick: 3 } },
            { pointer: { at: [0, 0], release: "primary" }, until: { tick: 3 } },
            { pointer: { at: [0, 0], press: "primary", release: "primary" } },
            { pointer: { at: [0, 0], press: "left" } },
            { join: "pad:x" },
            { join: "pad:0", for: 3 },
            { pointer: { at: [0, 0], presss: "primary" } },
            { pointer: { at: [0, 0] }, for: 2, max: 3 },
            { set: { steer: 1 }, press: "fire" },
          ],
        },
        pads,
      ),
    );
    const at = (path: string) => found.find((i) => i.path === path)?.message;
    expect(at("/steps/0/set/fire")).toBe("fire is a button; hold it instead of setting it");
    expect(at("/steps/1/set/stear")).toMatch(/unknown action "stear"; did you mean "steer"\?/);
    expect(at("/steps/2/set/steer")).toBeDefined();
    expect(at("/steps/3/set/move")).toMatch(/unit disc/);
    expect(at("/steps/4")).toBe("a set step needs one of for, forMs or until");
    expect(at("/steps/5/set/steer")).toBe("steer is held and set; a step does one or the other");
    expect(at("/steps/6/pointer/drag")).toMatch(/^a drag moves over a fixed length/);
    expect(at("/steps/7/pointer/release")).toMatch(/^a release lands over a fixed length/);
    expect(at("/steps/8/pointer")).toMatch(/pressing and releasing primary on one slot/);
    expect(at("/steps/9/pointer/press")).toBeDefined();
    expect(at("/steps/10/join")).toBeDefined();
    expect(at("/steps/11/for")).toMatch(/^for goes with a hold, set or pointer step/);
    expect(at("/steps/12/pointer/presss")).toBe('unknown key "presss"; did you mean "press"?');
    expect(at("/steps/13/max")).toMatch(/max caps an until step/);
    expect(at("/steps/14")).toBe(
      "a step is one of hold, set, pointer, press, wait, command, elapse, join or leave, not press and set",
    );
  });

  it("keeps v1 to v1's steps and header", () => {
    const found = issues(
      compileInputScript(
        { v: 1, players: 2, tracks: [], steps: [{ set: { steer: 1 }, for: 2 }, { join: "pad:0" }] },
        pads,
      ),
    );
    expect(found.map((i) => [i.path, i.message, i.hint])).toEqual([
      ["/tracks", "tracks needs input-script v2", 'Set "v": 2.'],
      ["/players", "players needs input-script v2", 'Set "v": 2.'],
      ["/steps/0/set", 'unknown key "set"', 'set steps need input-script v2: set "v": 2.'],
      ["/steps/1/join", 'unknown key "join"', 'join steps need input-script v2: set "v": 2.'],
    ]);
  });

  it("refuses tracks that share a seat or name one the run hasn't, and steps beside tracks", () => {
    const at = (script: unknown) => issues(compileInputScript(script, pads)).map((i) => i.path);
    const fire = [{ press: "fire" }];
    expect(
      at({
        v: 2,
        tracks: [
          { player: 0, steps: fire },
          { player: 0, steps: fire },
        ],
      }),
    ).toEqual(["/tracks/1/player"]);
    expect(at({ v: 2, tracks: [{ player: 2, steps: fire }] })).toEqual(["/tracks/0/player"]);
    expect(at({ v: 2, players: 1, tracks: [{ player: 1, steps: fire }] })).toEqual([
      "/tracks/0/player",
    ]);
    expect(at({ v: 2, steps: fire, tracks: [{ player: 0, steps: fire }] })).toEqual(["/tracks"]);
    expect(at({ v: 2, tracks: [{ player: 0 }] })).toEqual(["/tracks/0/steps"]);
    expect(at({ v: 2, tracks: [{ player: 0, steps: [{ set: { stear: 1 }, for: 1 }] }] })).toEqual([
      "/tracks/0/steps/0/set/stear",
    ]);
  });
});

// ─── Playing a compiled script ───────────────────────────

const stateAt = (tick: number) => ({ tick, snapshot: null, events: [] }) as unknown as PlayState;

/** Every slot's input, `after` called as if each slot simulated a tick. */
function drive(
  script: CompiledScript,
  holds: (until: Record<string, unknown>, state: PlayState) => boolean = () => false,
) {
  const source = scriptSource(script, holds);
  const ticks: TickInput[] = [];
  for (let slot = 0; !source.done() && slot < 100; slot++) {
    ticks.push(source.tick(slot));
    source.after!(stateAt(slot));
  }
  return { ticks, log: source.log() };
}

const actionsOf = (t: TickInput) =>
  t.actions.map((a) => [
    a.action,
    a.pressed,
    a.value ?? (a.x === undefined ? null : [a.x, a.y]),
    a.player ?? 0,
  ]);

describe("scriptSource", () => {
  it("plays a v1 script's edges, commands and log as the held-actions path does", () => {
    const script = compiled(
      {
        v: 1,
        steps: [
          { hold: ["right"], for: 2 },
          { hold: ["right", "push"], for: 1 },
          { command: "nudge", args: { dx: 1 } },
          { wait: 1 },
        ],
      },
      game,
    );
    const { ticks, log } = drive(script);
    expect(ticks.map((t) => actionsOf(t))).toEqual([
      [["right", true, null, 0]],
      [],
      [["push", true, null, 0]],
      [],
      [
        ["right", false, null, 0],
        ["push", false, null, 0],
      ],
    ]);
    expect(ticks.map((t) => t.commands)).toEqual([
      [],
      [],
      [],
      [{ name: "nudge", args: { dx: 1 } }],
      [],
    ]);
    expect(ticks.every((t) => t.pointers.length === 0 && t.joins.length === 0)).toBe(true);
    let held: string[] = [];
    const viaHeld = script.steps.flatMap((step) =>
      Array.from({ length: step.ticks! }, () => {
        const edges = heldEdges(held, step.hold, 0);
        held = step.hold;
        return edges.map(([, a, p]) => [a, p === 1, null, 0]);
      }),
    );
    expect(ticks.map((t) => actionsOf(t))).toEqual(viaHeld);
    expect(log).toEqual([
      { index: 0, start: 0, ticks: 2, end: "done" },
      { index: 1, start: 2, ticks: 1, end: "done" },
      { index: 2, start: 3, ticks: 1, end: "done" },
      { index: 3, start: 4, ticks: 1, end: "done" },
    ]);
  });

  it("sets analog values for a step, changes only what changed and returns dropped ones to 0", () => {
    const { ticks } = drive(
      compiled(
        {
          v: 2,
          steps: [
            { set: { steer: 0.5, move: [0.6, 0.8] }, for: 2 },
            { set: { steer: 0.5 }, for: 1 },
            { hold: ["fire"], set: { steer: -1 }, for: 1 },
            { wait: 1 },
          ],
        },
        pads,
      ),
    );
    expect(ticks.map(actionsOf)).toEqual([
      [
        ["steer", true, 0.5, 0],
        ["move", true, [0.6, 0.8], 0],
      ],
      [],
      [["move", false, [0, 0], 0]],
      [
        ["fire", true, null, 0],
        ["steer", true, -1, 0],
      ],
      [
        ["fire", false, null, 0],
        ["steer", false, 0, 0],
      ],
    ]);
  });

  it("moves the pointer along a drag, pressing on the first slot and releasing on the last", () => {
    const { ticks } = drive(
      compiled(
        {
          v: 2,
          steps: [
            { pointer: { at: [1, 2], press: "secondary" } },
            { pointer: { at: [1, 2], drag: [3, 2], release: "secondary" }, for: 5 },
            { pointer: { at: [3, 2] }, for: 2 },
            { wait: 1 },
          ],
        },
        pads,
      ),
    );
    const p = (x: number, buttons: number) => [{ x, y: 2, buttons, over: true }];
    expect(ticks.map((t) => t.pointers)).toEqual([
      p(1, 2),
      [],
      p(1.5, 2),
      p(2, 2),
      p(2.5, 2),
      p(3, 0),
      [],
      [],
      [],
    ]);
  });

  it("places the pointer by the one rule: a one-slot drag lands on drag, an until step stays at at", () => {
    const drag = { at: { x: 0, y: 0 }, drag: { x: 4, y: -2 }, press: "primary" as const };
    expect(pointerAt(drag, 0, 1, 0)).toEqual({ x: 4, y: -2, buttons: 1, over: true });
    expect(pointerAt(drag, 1, 3, 1)).toEqual({ x: 2, y: -1, buttons: 1, over: true });
    expect(pointerAt({ at: { x: 1, y: 1 } }, 7, undefined, 4)).toEqual({
      x: 1,
      y: 1,
      buttons: 4,
      over: true,
    });
  });

  it("runs tracks at once, each with its own until, until every track ran out", () => {
    const script = compiled(
      {
        v: 2,
        tracks: [
          {
            player: 1,
            steps: [
              { join: "pad:0" },
              { set: { steer: 1 }, until: { tick: 4 }, max: 10 },
              { command: "ping" },
            ],
          },
          { player: 0, steps: [{ hold: ["fire"], for: 3 }, { command: "ping" }] },
        ],
      },
      pads,
    );
    const { ticks, log } = drive(script, (until, state) => state.tick >= (until.tick as number));
    expect(ticks).toHaveLength(6);
    expect(ticks.map((t) => [actionsOf(t), t.commands, t.joins])).toEqual([
      [[["fire", true, null, 0]], [], [{ player: 1, device: "pad:0", joined: true }]],
      [[["steer", true, 1, 1]], [], []],
      [[], [], []],
      [[], [{ name: "ping" }], []],
      [[], [], []],
      [[], [{ name: "ping", player: 1 }], []],
    ]);
    expect(log).toEqual([
      { player: 1, index: 0, start: 0, ticks: 1, end: "done" },
      { player: 0, index: 0, start: 0, ticks: 3, end: "done" },
      { player: 0, index: 1, start: 3, ticks: 1, end: "done" },
      { player: 1, index: 1, start: 1, ticks: 4, end: "until" },
      { player: 1, index: 2, start: 5, ticks: 1, end: "done" },
    ]);
  });

  it("counts skipped slots toward a step's length", () => {
    const source = scriptSource(
      compiled({ v: 2, steps: [{ set: { steer: 1 }, for: 2 }] }, pads),
      () => false,
    );
    source.tick(0);
    source.skipped!(0);
    expect(source.done()).toBe(false);
    source.tick(1);
    source.skipped!(1);
    expect(source.done()).toBe(true);
    expect(source.log()).toEqual([{ index: 0, start: 0, ticks: 2, end: "done" }]);
  });
});

// ─── Runs ────────────────────────────────────────────────

type Run = {
  rapier: RapierModule | null;
  game: GameDefinition | null;
  registry: Registry;
  scene: SceneDefinition;
  prefabs?: PrefabLibrary;
  library?: PrefabLibrary;
  project?: ProjectRuntimeView | null;
};

/** A run the way `runPlaytest` starts and records one, its input from `scriptSource`. */
function playScript(run: Run, raw: unknown) {
  const { registry, game } = resolveGame({ game: run.game, registry: run.registry });
  const engine = run.project?.engine;
  const result = compileInputScript(
    raw,
    registry,
    resolveTime({ project: engine, game: registry.time }),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  const script = result.script;
  const library = runLibrary(run);
  const prepared = prepareRun(run.scene, registry, false, run.prefabs, engine, {
    project: run.project,
    library,
  });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.blocked));
  const started = startRun({
    rapier: run.rapier,
    game,
    registry,
    scene: prepared.scene,
    play: script.play,
    project: run.project,
    prefabs: library,
  });
  if (!started.ok) throw new Error(JSON.stringify(started.load));
  const { runtime } = started;
  try {
    const time = runtime.ctx.time;
    const source = scriptSource(script, (u, s) => untilHolds(u, s, registry), time);
    const recorder = createRunRecorder({
      rapier: recordingRapier(prepared.scene, run.rapier),
      game,
      scene: run.scene.name,
      sceneHash: prepared.hash,
      runHash: prepared.runHash,
      start: script.play,
      time,
      players: runtime.ctx.input.players(),
    });
    const inputs: InputEdge[] = [];
    const events: string[] = [];
    const end = runLoop({
      runtime,
      game,
      maxTicks: script.maxTicks,
      input: source,
      record: inputs,
      onTick(state, focus, _edges, _commands, input) {
        recorder.tick(state, input, focus);
        for (const e of state.events) events.push(e.type);
      },
    });
    const final = runtime.snapshot();
    return {
      end,
      final,
      inputs,
      events,
      steps: source.log(),
      recording: recorder.finish(end, final),
    };
  } finally {
    runtime.destroy();
  }
}

const padsRun: Run = {
  rapier: null,
  game: padsGame as GameDefinition,
  registry: pads,
  scene: padsScene,
};

describe("compiled tracks in a run", () => {
  it("feeds every seat's values, pointer, seat changes and commands to ctx.input, and replays", () => {
    const played = playScript(padsRun, {
      v: 2,
      tracks: [
        {
          player: 0,
          steps: [
            { hold: ["fire"], set: { move: [0.6, 0.8] }, for: 2 },
            { pointer: { at: [1, 2], drag: [2, 2], press: "primary" }, for: 3 },
          ],
        },
        {
          player: 1,
          steps: [{ join: "pad:0" }, { set: { steer: -0.5 }, for: 2 }, { command: "ping" }],
        },
      ],
    });
    expect(played.end).toMatchObject({ result: "script-end", ticks: 5 });
    expect(played.events).toEqual(["player:joined"]);
    const noPointer = null;
    const log = (played.final as PadsSnapshot).log;
    expect(log).toEqual([
      [
        0,
        [
          [true, 0, { x: 0.6, y: 0.8 }, noPointer],
          [false, 0, { x: 0, y: 0 }, noPointer],
        ],
        [],
        [[], ["pad:0"]],
      ],
      [
        1,
        [
          [true, 0, { x: 0.6, y: 0.8 }, noPointer],
          [false, -0.5, { x: 0, y: 0 }, noPointer],
        ],
        [],
        [[], ["pad:0"]],
      ],
      [
        2,
        [
          [true, 0, { x: 0.6, y: 0.8 }, { x: 1, y: 2, buttons: 1, over: true }],
          [false, -0.5, { x: 0, y: 0 }, noPointer],
        ],
        [],
        [[], ["pad:0"]],
      ],
      [
        3,
        [
          [true, 0, { x: 0.6, y: 0.8 }, { x: 1.5, y: 2, buttons: 1, over: true }],
          [false, -0.5, { x: 0, y: 0 }, noPointer],
        ],
        [["ping", 1]],
        [[], ["pad:0"]],
      ],
      [
        4,
        [
          [true, 0, { x: 0.6, y: 0.8 }, { x: 2, y: 2, buttons: 1, over: true }],
          [false, -0.5, { x: 0, y: 0 }, noPointer],
        ],
        [],
        [[], ["pad:0"]],
      ],
    ]);
    expect(played.inputs).toEqual([[0, "fire", 1]]);

    const replay = replayRecording({ ...padsRun, recording: played.recording });
    if (replay.blocked) throw new Error(JSON.stringify(replay));
    expect(replay.matches, replay.divergence ?? "").toBe(true);
  });

  it("is what runPlaytest plays for a script that names no v2 step", () => {
    const script = { v: 2, steps: [{ hold: ["fire"], for: 3 }, { command: "ping" }, { wait: 2 }] };
    const played = playScript(padsRun, script);
    const report = runPlaytest({ ...padsRun, script: script as never });
    if (report.blocked) throw new Error(JSON.stringify(report));
    expect(played.recording.end).toBe(report.recording.end);
    expect(played.steps).toEqual(report.steps);
    expect(played.inputs).toEqual(report.inputs);
    expect(played.final).toEqual(report.final);
  });
});

describe("v1 scripts unchanged in behaviour", () => {
  let rapier: RapierModule;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
  });

  for (const fixture of V1_FIXTURES) {
    it(`${fixture.file}'s script plays to the run it recorded`, async () => {
      const run = await v1Run(fixture, rapier);
      const played = playScript(run, run.script);
      const report = runPlaytest(run);
      if (report.blocked) throw new Error(JSON.stringify(report));
      expect(played.end).toMatchObject({ result: report.outcome.result, ticks: report.ticks });
      expect(played.steps).toEqual(report.steps);
      expect(played.inputs).toEqual(report.inputs);
      expect(played.final).toEqual(report.final);
      expect(played.recording.end).toBe(report.recording.end);
      expect(played.recording.end).toBe((readV1Recording(fixture) as { end: string }).end);
    }, 120_000);
  }

  it("the platformer's hop-left script, read as its file holds it, compiles and replays", async () => {
    const fixture = V1_FIXTURES.find((f) => f.file === "platformer.hop-left.recording.json")!;
    const run = await v1Run(fixture, rapier);
    const text = readFileSync(
      new URL("../../../../scripts/scene/examples/hop-left.json", import.meta.url),
      "utf8",
    );
    const parsed = parseInputScript(text, run.registry);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.script.v).toBe(2);
    const played = playScript(run, parsed.script);
    expect(played.end.result).toBe("script-end");
    expect(played.recording.end).toBe((readV1Recording(fixture) as { end: string }).end);
    const replay = replayRecording({ ...run, recording: played.recording });
    if (replay.blocked) throw new Error(JSON.stringify(replay));
    expect(replay.matches, replay.divergence ?? "").toBe(true);
  }, 120_000);
});
