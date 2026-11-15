// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { GATE_DIALOGUE, GATE_ID, gateLookup } from "../../__tests__/fixtures/dialogue/gate";
import { exploreDialogue } from "../../dialogue/explore";
import type { DialogueView } from "../../dialogue/runner";
import { createRegistry, defineGame } from "../../game/define";
import type { GameDefinition, JsonValue, PlayState } from "../../game/types";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { DIALOGUE_END, type DialogueEndEvent, type StepEvent } from "../../runtime/types";
import { expandScene } from "../../scene/expand";
import { parseSceneOrThrow } from "../../scene/parse";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
import { fuzz } from "../fuzz";
import { createHeadlessRuntime } from "../headless";
import { dialogueCommands, legalCommands, startState } from "../legal";
import { runPlaytest, untilHolds } from "../playtest";
import type { InputScriptV2, PlaytestReport, PlaytestRun } from "../playtest-types";
import { replayRecording } from "../recording";

/** A game that opens the gate conversation on load and ends its run on the conversation's ending. */
function talkGame(opts: { gold: number; turns?: boolean }): GameDefinition<null> {
  return defineGame<null>({
    id: "talk-game",
    types: [],
    actions: [],
    ...(opts.turns ? { time: { kind: "turns" as const } } : {}),
    persist: { initial: () => ({ gold: opts.gold }) },
    createRuntime: (ctx) => ({
      onLoad: () => ctx.dialogue.start(GATE_ID),
      snapshot: () => null,
    }),
    play: {
      results: ["paid", "left"],
      outcome: ({ events }) => {
        const end = events.find((e) => e.type === DIALOGUE_END);
        return end ? { result: (end.data as DialogueEndEvent).ending } : null;
      },
    },
  });
}

const lookup = gateLookup();
const project: ProjectRuntimeView = {
  settings: {},
  engine: {},
  table: () => [],
  asset: () => undefined,
  inputMap: null,
  doc: lookup.read,
  docs: lookup.ids,
};

function sceneFor(game: GameDefinition<null>) {
  const registry = createRegistry(game);
  const text = JSON.stringify({
    v: SCENE_FORMAT_VERSION,
    game: game.id,
    name: "gate",
    bounds: [0, 0, 4, 3],
    settings: { physics: "none" },
    entities: [],
  });
  return { registry, scene: parseSceneOrThrow(text, registry) };
}

function played(run: PlaytestRun<null>): PlaytestReport<null> {
  if (run.blocked) throw new Error(`blocked at ${run.stage}: ${JSON.stringify(run)}`);
  return run;
}

const PAY: InputScriptV2 = {
  v: 2,
  steps: [
    { hold: [], until: { dialogue: { node: "gate", active: true } }, max: 5 },
    { command: "@dialogue-choose", args: { choice: 0 } },
    { hold: [], until: { dialogue: { node: "through" } }, max: 5 },
    { command: "@dialogue-advance" },
    { hold: [], for: 2 },
  ],
} as InputScriptV2;

const LEAVE: InputScriptV2 = {
  v: 2,
  steps: [
    { command: "@dialogue-choose", args: { choice: 1 } },
    { hold: [], until: { dialogue: { node: "turned-away" } }, max: 5 },
    { command: "@dialogue-advance" },
    { hold: [], until: { dialogue: { active: false } }, max: 5 },
  ],
} as InputScriptV2;

describe("a playtest walks a conversation by command steps", () => {
  const game = talkGame({ gold: 3 });
  const { registry, scene } = sceneFor(game);
  const run = (script: InputScriptV2) => {
    let persist: JsonValue | undefined;
    const report = played(
      runPlaytest({
        game,
        registry,
        scene,
        project,
        script,
        onEnd: (runtime) => {
          persist = runtime.ctx.persist.value;
        },
      }),
    );
    return { report, persist };
  };

  it.each([
    ["paid", PAY, ["through"], { gold: 0, flags: { "gate-open": true } }],
    ["left", LEAVE, ["turned-away"], { gold: 3 }],
  ] as const)("reaches %s and replays to the same end", (ending, script, nodes, persist) => {
    const { report, persist: after } = run(script);
    expect(report.outcome.result).toBe(ending);
    expect(report.steps.map((s) => s.end)).not.toContain("max");
    const lines = report.events.filter((e) => e.type === "dialogue:line");
    expect(lines.map((e) => (e.data as { node: string }).node)).toEqual(nodes);
    expect(report.events.filter((e) => e.type === DIALOGUE_END).map((e) => e.data)).toEqual([
      { dialogue: GATE_ID, ending },
    ]);
    expect(report.dialogue).toBeNull();
    expect(after).toEqual(persist);

    const replay = replayRecording({ game, registry, scene, project, recording: report.recording });
    if (replay.blocked) throw new Error(`replay blocked: ${JSON.stringify(replay)}`);
    expect(replay.divergence).toBeNull();
    expect(replay.matches).toBe(true);
    expect(replay.recording.end).toEqual(report.recording.end);
  });

  it("hides the toll's choice without the gold, so choosing it is ignored", () => {
    const poor = talkGame({ gold: 1 });
    const at = sceneFor(poor);
    const report = played(runPlaytest({ game: poor, ...at, project, script: PAY, dev: false }));
    expect(report.outcome.result).toBe("script-end");
    expect(report.steps.map((s) => s.end)).toEqual(["until", "done", "max", "done", "done"]);
    expect(report.dialogue?.node).toBe("gate");
    expect(report.dialogue?.choices).toEqual([{ index: 1, text: "gate.leave", enabled: true }]);
    expect(report.legal).toEqual([{ name: "@dialogue-choose", args: { choice: 1 } }]);
  });
});

describe("legal commands walk a conversation", () => {
  it("lists the enabled choices, then the advance, then nothing once it ends", () => {
    const game = talkGame({ gold: 3 });
    const { registry, scene } = sceneFor(game);
    const rt = createHeadlessRuntime({
      game,
      registry,
      scene: expandScene(scene, registry),
      project,
    });
    const start = startState(rt);
    expect(start.dialogue?.node).toBe("gate");
    expect(legalCommands(game.play, start)).toEqual({
      legal: [
        { name: "@dialogue-choose", args: { choice: 0 } },
        { name: "@dialogue-choose", args: { choice: 1 } },
      ],
    });
    rt.step(rt.ctx.time.tickMs, [], [{ name: "@dialogue-choose", args: { choice: 0 } }]);
    expect(legalCommands(game.play, startState(rt))).toEqual({
      legal: [{ name: "@dialogue-advance" }],
    });
    rt.step(rt.ctx.time.tickMs, [], [{ name: "@dialogue-advance" }]);
    expect(legalCommands(game.play, startState(rt))).toBeNull();
    rt.destroy();
  });

  it("puts the dialogue's commands ahead of the game's", () => {
    const view = { ended: null, choices: null } as unknown as DialogueView;
    const state = { dialogue: view } as PlayState;
    const play = { commands: () => [{ name: "wave" }] };
    expect(legalCommands(play, state)?.legal).toEqual([
      { name: "@dialogue-advance" },
      { name: "wave" },
    ]);
    expect(legalCommands(play, state, 1)).toEqual({
      legal: [{ name: "@dialogue-advance" }],
      legalTruncated: true,
    });
    expect(dialogueCommands({ ...view, ended: "paid" })).toEqual([]);
    expect(dialogueCommands({ ...view, stuck: true })).toEqual([]);
    expect(
      dialogueCommands({
        ...view,
        choices: [
          { index: 0, enabled: false },
          { index: 2, enabled: true },
        ],
      }),
    ).toEqual([{ name: "@dialogue-choose", args: { choice: 2 } }]);
  });

  it.each([
    ["a fixed clock", false],
    ["a turns clock", true],
  ])("fuzz reaches both endings within 32 rollouts on %s", (_, turns) => {
    const game = talkGame({ gold: 3, turns });
    const { registry, scene } = sceneFor(game);
    const run = fuzz({ game, registry, scene, project, seed: "gate", rollouts: 32, ticks: 600 });
    if (run.blocked) throw new Error(`fuzz blocked: ${JSON.stringify(run)}`);
    expect(run.results.paid).toBeGreaterThan(0);
    expect(run.results.left).toBeGreaterThan(0);
    expect(run.results.paid! + run.results.left!).toBe(32);
    expect(run.legal!.sent).toBeGreaterThanOrEqual(64);
  });
});

describe("the dialogue predicate", () => {
  const registry = createRegistry();
  const view = (patch: Partial<DialogueView>): DialogueView => ({
    dialogue: GATE_ID,
    node: "through",
    line: 0,
    current: {},
    choices: null,
    log: [],
    ended: null,
    ...patch,
  });
  const state = (
    dialogue: DialogueView | null | undefined,
    events: StepEvent[] = [],
  ): PlayState => ({
    tick: 3,
    snapshot: null,
    events,
    world: { exists: () => false, count: () => 0 },
    ...(dialogue !== undefined ? { dialogue } : {}),
  });
  const holds = (dialogue: Record<string, JsonValue>, at: PlayState) =>
    untilHolds({ dialogue }, at, registry);
  const ended = (ending: string): StepEvent => ({
    tick: 3,
    type: DIALOGUE_END,
    at: { x: 0, y: 0 },
    data: { dialogue: GATE_ID, ending },
  });

  it("answers the node and whether a conversation runs", () => {
    expect(holds({ node: "through" }, state(view({})))).toBe(true);
    expect(holds({ node: "gate" }, state(view({})))).toBe(false);
    expect(holds({ active: true }, state(view({})))).toBe(true);
    expect(holds({ active: false }, state(view({})))).toBe(false);
    expect(holds({ active: false }, state(null))).toBe(true);
    expect(holds({ active: false }, state(undefined))).toBe(true);
    expect(holds({ node: "through" }, state(null))).toBe(false);
    expect(holds({ node: "through", active: true }, state(view({})))).toBe(true);
  });

  it("answers an ending from the view or from this tick's dialogue:end", () => {
    expect(holds({ ended: "paid" }, state(view({ ended: "paid" })))).toBe(true);
    expect(holds({ ended: true }, state(view({ ended: "paid" })))).toBe(true);
    expect(holds({ ended: "left" }, state(view({ ended: "paid" })))).toBe(false);
    expect(holds({ active: false }, state(view({ ended: "paid" })))).toBe(true);
    expect(holds({ ended: "paid" }, state(null, [ended("paid")]))).toBe(true);
    expect(holds({ ended: true }, state(null, [ended("left")]))).toBe(true);
    expect(holds({ ended: "paid" }, state(null, [ended("left")]))).toBe(false);
    expect(holds({ ended: true }, state(view({})))).toBe(false);
  });
});

describe("exploreDialogue", () => {
  it("lists both endings with their choice paths", () => {
    expect(exploreDialogue(GATE_DIALOGUE, { vars: { gold: 3 } })).toEqual({
      endings: [
        { ending: "paid", path: [0], nodes: ["gate", "through"] },
        { ending: "left", path: [1], nodes: ["gate", "turned-away"] },
      ],
      truncated: false,
    });
  });

  it("reads the variables: without the toll only turning back ends it", () => {
    expect(exploreDialogue(GATE_DIALOGUE).endings).toEqual([
      { ending: "left", path: [1], nodes: ["gate", "turned-away"] },
    ]);
    expect(exploreDialogue(GATE_DIALOGUE, { vars: { gold: 2 } }).endings).toHaveLength(1);
  });

  it("walks a loop once per state and stops at maxDepth", () => {
    const file = structuredClone(GATE_DIALOGUE);
    const [pay, leave] = file.nodes[0]!.choices!;
    file.nodes[0]!.choices = [
      { ...pay!, if: { var: "/asked", gte: 2 } },
      leave!,
      { say: "Ask again.", to: "gate", do: [{ add: "/asked", by: 1 }] },
    ];
    const deep = exploreDialogue(file, { vars: { gold: 3 } });
    expect(deep.endings).toEqual([
      { ending: "left", path: [1], nodes: ["gate", "turned-away"] },
      { ending: "paid", path: [2, 2, 0], nodes: ["gate", "through"] },
    ]);
    expect(deep.truncated).toBe(true);
    const shallow = exploreDialogue(file, { vars: { gold: 3 }, maxDepth: 2 });
    expect(shallow.endings.map((e) => e.ending)).toEqual(["left"]);
    expect(shallow.truncated).toBe(true);
  });

  it("finds nothing when start names no node", () => {
    expect(exploreDialogue({ ...GATE_DIALOGUE, start: "nowhere" })).toEqual({
      endings: [],
      truncated: false,
    });
  });
});
