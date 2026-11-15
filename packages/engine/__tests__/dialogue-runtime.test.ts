// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { memoryVars } from "../dialogue/vars";
import { createGame } from "../engine";
import { DIALOGUE_ADVANCE_COMMAND, DIALOGUE_CHOOSE_COMMAND } from "../game/commands";
import { createRegistry, defineGame } from "../game/define";
import { formatSaveFile, parseSaveFile, type SaveFile } from "../game/save-file";
import { resolveTime } from "../game/time";
import type { GameCommand, GameDefinition } from "../game/types";
import { legalCommands, startState } from "../headless/legal";
import { tickWakes } from "../headless/play-loop";
import { stableJson } from "../project/canonical";
import { docLookup } from "../project/kinds/define";
import type { DialogueFile } from "../project/kinds/dialogue";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { DIALOGUE_VOICE_KEY, SAVE_DIALOGUE_KEY } from "../runtime/behaviors/dialogue";
import { gamePersistCell } from "../runtime/persist";
import type { PresentRequest } from "../runtime/present";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave, worldSaveBlockers } from "../runtime/save-state";
import {
  DIALOGUE_CHOICES,
  DIALOGUE_END,
  DIALOGUE_LINE,
  type PersistCell,
  type SceneRuntimeHandle,
  type StepResult,
} from "../runtime/types";
import { expandScene } from "../scene/expand";
import { hashText } from "../scene/hash";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { GameInstance } from "../types";
import { createDialogueBox } from "../ui/dialogue";
import { mountUi } from "../ui/layer";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const TALK = "talk";

/** Two voiced lines, then a choice: thanking (gold + 1) ends "agreed"; refusing needs 99 gold and shows disabled. */
const TALK_FILE: DialogueFile = {
  kind: "dialogue",
  v: 1,
  start: "hello",
  speakers: [{ id: "keeper", name: "speaker.keeper" }],
  nodes: [
    {
      id: "hello",
      lines: [
        { speaker: "keeper", text: "talk.hello", voice: "vo-hello" },
        { speaker: "keeper", text: "talk.ask", voice: "vo-ask" },
      ],
      choices: [
        { text: "talk.yes", to: "yes", do: [{ add: "/gold", by: 1 }] },
        { text: "talk.no", to: "no", if: { var: "/gold", gte: 99 }, hidden: "disable" },
      ],
    },
    { id: "yes", lines: [{ speaker: "keeper", text: "talk.thanks" }], end: "agreed" },
    { id: "no", lines: [{ speaker: "keeper", text: "talk.bye" }], end: "refused" },
  ],
};

const lookup = docLookup(new Map([["dialogue", new Map([[TALK, TALK_FILE]])]]));
const project: ProjectRuntimeView = {
  settings: {},
  engine: {},
  table: () => [],
  asset: () => undefined,
  inputMap: null,
  doc: lookup.read,
  docs: lookup.ids,
};

type TalkSnap = { seen: string[] };

/** Starts the conversation on `talk` (and on load with `onLoad`), and keeps every dialogue event it saw. */
function talker(
  time?: GameDefinition["time"],
  opts: { onLoad?: boolean } = {},
): GameDefinition<TalkSnap> {
  return defineGame<TalkSnap>({
    id: "talker",
    types: [],
    actions: [],
    world: { physics: "none" },
    ...(time ? { time } : {}),
    persist: {
      initial: () => ({ gold: 0 }),
      schema: z.object({ gold: z.number() }),
    },
    commands: { talk: { description: "Starts the conversation." } },
    createRuntime(ctx) {
      let seen: string[] = [];
      return {
        ...(opts.onLoad ? { onLoad: () => ctx.dialogue.start(TALK) } : {}),
        beforeStep(_dt, _actions, commands) {
          if (commands.some((c) => c.name === "talk")) ctx.dialogue.start(TALK);
        },
        afterStep(_dt, events) {
          for (const e of events)
            if (e.type.startsWith("dialogue:")) seen.push(`${e.type} ${JSON.stringify(e.data)}`);
        },
        snapshot: () => ({ seen: [...seen] }),
        restore(data) {
          seen = [...(data as TalkSnap).seen];
        },
      };
    },
  });
}

const node = (id: string, at: [number, number]): EntityDef =>
  ({ id, type: "marker", at }) as EntityDef;

const sceneOf = (entities: EntityDef[]): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "porch",
  game: "talker",
  bounds: [0, 0, 10, 10],
  settings: { physics: "none", gravity: [0, 0] },
  entities,
});

const PORCH = sceneOf([node("post", [1, 1])]);

function runtime(
  game: GameDefinition<TalkSnap> = talker(),
  opts: {
    dev?: boolean;
    record?: boolean;
    project?: ProjectRuntimeView;
    persist?: PersistCell;
  } = {},
): SceneRuntimeHandle {
  const rt = createSceneRuntime({
    rapier: null,
    view: null,
    game: game as GameDefinition,
    project: opts.project ?? project,
    dev: opts.dev ?? false,
    ...(opts.record ? { recordPresentation: true } : {}),
    ...(opts.persist ? { persist: opts.persist } : {}),
  });
  const report = rt.load(expandScene(PORCH, createRegistry(game as GameDefinition)));
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const advance: GameCommand = { name: DIALOGUE_ADVANCE_COMMAND };
const choose = (choice: number): GameCommand => ({
  name: DIALOGUE_CHOOSE_COMMAND,
  args: { choice },
});

/** The conversation's commands by tick: talk, the second line, the first choice, the end. */
const SCRIPT: Readonly<Record<number, GameCommand[]>> = {
  2: [{ name: "talk" }],
  5: [advance],
  9: [choose(0)],
  12: [advance],
};

const step = (rt: SceneRuntimeHandle, commands: GameCommand[] = []): StepResult =>
  rt.step(rt.ctx.time.tickMs, [], commands);

/**
 * Steps ticks `from` to `to` on SCRIPT; the digest of each tick's events,
 * snapshot, persist and view, key order aside (a save's text sorts keys).
 */
function run(
  rt: SceneRuntimeHandle,
  from: number,
  to: number,
  script: Readonly<Record<number, GameCommand[]>> = SCRIPT,
): string {
  const frames: unknown[] = [];
  for (let t = from; t < to; t++) {
    const result = step(rt, script[t] ?? []);
    frames.push([
      result.tick,
      result.events,
      result.game,
      rt.ctx.persist.value,
      rt.ctx.dialogue.view(),
    ]);
  }
  return hashText(stableJson(frames));
}

const worldSave = (rt: SceneRuntimeHandle, game: GameDefinition<TalkSnap> = talker()): SaveFile => {
  const captured = captureSave(rt, { depth: "world", slot: "s", now: 0 });
  if (!captured.ok) throw new Error(captured.issue.message);
  const parsed = parseSaveFile(formatSaveFile(captured.file), game as GameDefinition);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.file;
};

const audioOf = (results: readonly StepResult[]): PresentRequest[] =>
  results.flatMap((r) => (r.present ?? []).filter((p) => p.kind === "audio"));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the runtime's conversation", () => {
  it("raises a line, the choices and the end as step events, and ends with no view", () => {
    const rt = runtime();
    run(rt, 0, 20);
    expect(rt.snapshot()).toEqual({
      seen: [
        `${DIALOGUE_LINE} {"dialogue":"talk","node":"hello","line":0}`,
        `${DIALOGUE_LINE} {"dialogue":"talk","node":"hello","line":1}`,
        `${DIALOGUE_CHOICES} {"dialogue":"talk","node":"hello","count":2}`,
        `${DIALOGUE_LINE} {"dialogue":"talk","node":"yes","line":0}`,
        `${DIALOGUE_END} {"dialogue":"talk","ending":"agreed"}`,
      ],
    });
    expect(rt.ctx.persist.value).toEqual({ gold: 1 });
    expect(rt.ctx.dialogue.view()).toBeNull();
    rt.destroy();
  });

  it("shows the choices it offers, the refusal disabled, and keeps the view between moves", () => {
    const rt = runtime();
    run(rt, 0, 6);
    const view = rt.ctx.dialogue.view();
    expect(view).toMatchObject({
      dialogue: TALK,
      node: "hello",
      line: 1,
      choices: [
        { index: 0, text: "talk.yes", enabled: true },
        { index: 1, text: "talk.no", enabled: false },
      ],
      ended: null,
    });
    step(rt);
    expect(rt.ctx.dialogue.view()).toBe(view);
    rt.destroy();
  });

  it("ignores, and logs in dev, a command with no dialogue or a choice it can't take", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rt = runtime(talker(), { dev: true });
    step(rt, [advance]);
    expect(rt.ctx.dialogue.view()).toBeNull();
    step(rt, [{ name: "talk" }]);
    step(rt, [advance]);
    const asking = rt.ctx.dialogue.view();
    step(rt, [advance, choose(1), choose(7)]);
    expect(rt.ctx.dialogue.view()).toBe(asking);
    expect(rt.ctx.persist.value).toEqual({ gold: 0 });
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "[dialogue] @dialogue-advance ignored: no dialogue is running",
      '[dialogue] @dialogue-advance ignored: "talk" has no next line to show',
      '[dialogue] @dialogue-choose {"choice":1} ignored: it isn\'t a visible, enabled choice of "talk"',
      '[dialogue] @dialogue-choose {"choice":7} ignored: it isn\'t a visible, enabled choice of "talk"',
    ]);
    rt.destroy();

    warn.mockClear();
    const quiet = runtime();
    step(quiet, [advance, choose(0)]);
    expect(warn).not.toHaveBeenCalled();
    quiet.destroy();
  });

  it("replaces a running conversation on start, with a dev warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rt = runtime(talker(), { dev: true });
    step(rt, [{ name: "talk" }]);
    step(rt, [advance]);
    expect(rt.ctx.dialogue.view()?.line).toBe(1);
    step(rt, [{ name: "talk" }]);
    expect(rt.ctx.dialogue.view()).toMatchObject({ node: "hello", line: 0 });
    expect(warn).toHaveBeenCalledWith(
      '[dialogue] start("talk") replaces the running dialogue "talk"',
    );
    rt.ctx.dialogue.stop();
    expect(rt.ctx.dialogue.view()).toBeNull();
    rt.destroy();
  });
});

describe("a dialogue effect the persist schema can't hold", () => {
  const BRIBE: DialogueFile = {
    kind: "dialogue",
    v: 1,
    start: "ask",
    nodes: [
      {
        id: "ask",
        lines: [{ say: "Name your price" }],
        choices: [
          {
            say: "Everything",
            to: "done",
            do: [
              { set: "/gold", to: "lots" },
              { add: "/gold", by: 2 },
            ],
          },
        ],
      },
      { id: "done", lines: [{ say: "Deal" }], end: "deal" },
    ],
  };
  const bribes = docLookup(new Map([["dialogue", new Map([[TALK, BRIBE]])]]));
  const bribeProject: ProjectRuntimeView = { ...project, doc: bribes.read, docs: bribes.ids };
  const script = { 1: [{ name: "talk" }], 3: [choose(0)], 5: [advance] };

  it("is dropped alike in dev, headless and production, and only dev logs it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const game = talker();
    const runs = [
      { dev: true },
      { dev: false },
      // Production's cell trusts what it's given; the dialogue still judges its own writes.
      { dev: false, persist: gamePersistCell(game as GameDefinition, false) },
    ].map((setup) => {
      const rt = runtime(game, { ...setup, project: bribeProject });
      const digest = run(rt, 0, 8, script);
      expect(rt.ctx.persist.value).toEqual({ gold: 2 });
      expect(rt.ctx.dialogue.view()).toBeNull();
      expect(rt.snapshot()).toMatchObject({
        seen: expect.arrayContaining([`${DIALOGUE_END} {"dialogue":"talk","ending":"deal"}`]),
      });
      rt.destroy();
      return digest;
    });
    expect(new Set(runs).size).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(
      /^\[dialogue\] "talk"'s effect on "\/gold" ignored: persist then doesn't match the game's persist schema: /,
    );
  });
});

describe("a line's voice", () => {
  it("plays under the dialogue-voice key with its text key as the caption, after stopping the last", () => {
    const rt = runtime(talker(), { record: true });
    const results: StepResult[] = [];
    for (let t = 0; t < 20; t++) results.push(step(rt, SCRIPT[t] ?? []));
    expect(audioOf(results.slice(2, 3))).toEqual([
      {
        kind: "audio",
        op: { op: "play", sound: "vo-hello", key: DIALOGUE_VOICE_KEY, caption: "talk.hello" },
      },
    ]);
    expect(audioOf(results.slice(5, 6))).toEqual([
      { kind: "audio", op: { op: "stop", key: DIALOGUE_VOICE_KEY } },
      {
        kind: "audio",
        op: { op: "play", sound: "vo-ask", key: DIALOGUE_VOICE_KEY, caption: "talk.ask" },
      },
    ]);
    // The unvoiced thanks cuts the question's voice; the end has none left to stop.
    expect(audioOf(results.slice(9, 10))).toEqual([
      { kind: "audio", op: { op: "stop", key: DIALOGUE_VOICE_KEY } },
    ]);
    expect(audioOf(results)).toHaveLength(4);
    rt.destroy();
  });
});

describe("world saves of a conversation", () => {
  it("continue to the same digest from a fresh runtime", () => {
    const a = runtime();
    run(a, 0, 7);
    const file = worldSave(a);
    expect(file.world!.systems[SAVE_DIALOGUE_KEY]).toMatchObject({ run: { dialogue: TALK } });
    const viewAt = a.ctx.dialogue.view();
    const digestA = run(a, 7, 20);
    const finalA = a.snapshot();
    a.destroy();

    const b = runtime();
    const restored = restoreSave(b, file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(b.ctx.dialogue.view()).toEqual(viewAt);
    expect(run(b, 7, 20)).toBe(digestA);
    expect(b.snapshot()).toEqual(finalA);
    b.destroy();
  });

  it("hold no dialogue key without a conversation, and drop an ended one", () => {
    const rt = runtime();
    run(rt, 0, 2);
    expect(worldSave(rt).world!.systems).not.toHaveProperty(SAVE_DIALOGUE_KEY);
    run(rt, 2, 20);
    expect(worldSave(rt).world!.systems).not.toHaveProperty(SAVE_DIALOGUE_KEY);
    rt.destroy();
  });

  it("are refused while the conversation reads variables given to start", () => {
    const rt = runtime();
    rt.ctx.dialogue.start(TALK, { vars: memoryVars({ gold: 5 }) });
    expect(worldSaveBlockers(rt).map((b) => b.cause)).toEqual(["dialogue"]);
    rt.ctx.dialogue.stop();
    expect(worldSaveBlockers(rt)).toEqual([]);
    rt.destroy();
  });

  it("refuse a save whose dialogue the project no longer has", () => {
    const a = runtime();
    run(a, 0, 4);
    const file = worldSave(a);
    a.destroy();
    const bare = createSceneRuntime({
      rapier: null,
      view: null,
      game: talker() as GameDefinition,
      project: { ...project, doc: () => undefined },
    });
    expect(bare.load(expandScene(PORCH, createRegistry(talker() as GameDefinition))).ok).toBe(true);
    const restored = restoreSave(bare, file);
    expect(restored.ok).toBe(false);
    if (!restored.ok) expect(restored.issue.message).toContain('no dialogue "talk"');
    bare.destroy();
  });
});

describe("a conversation the load starts, ended before a world save", () => {
  const opener = () => talker(undefined, { onLoad: true });
  /** The load's conversation to its end by tick 6; the later commands find none to move. */
  const ENDED: Readonly<Record<number, GameCommand[]>> = {
    1: [advance],
    3: [choose(0)],
    5: [advance],
    9: [advance],
    11: [choose(0)],
    13: [advance],
  };

  it("stays ended when the save is restored onto a fresh load", () => {
    const a = runtime(opener());
    run(a, 0, 8, ENDED);
    expect(a.ctx.dialogue.view()).toBeNull();
    const file = worldSave(a, opener());
    expect(file.world!.systems).not.toHaveProperty(SAVE_DIALOGUE_KEY);
    const digestA = run(a, 8, 20, ENDED);
    const finalA = a.snapshot();
    a.destroy();

    const b = runtime(opener(), { record: true });
    expect(b.ctx.dialogue.view()).toMatchObject({ node: "hello", line: 0 });
    const restored = restoreSave(b, file);
    if (!restored.ok) throw new Error(restored.issue.message);
    expect(b.ctx.dialogue.view()).toBeNull();
    expect(legalCommands(null, startState(b))).toBeNull();
    const first = step(b, ENDED[8] ?? []);
    expect(audioOf([first]).at(-1)).toEqual({
      kind: "audio",
      op: { op: "stop", key: DIALOGUE_VOICE_KEY },
    });
    run(b, 9, 20, ENDED);
    expect(b.snapshot()).toEqual(finalA);
    expect(b.ctx.persist.value).toEqual({ gold: 1 });
    b.destroy();

    const c = runtime(opener());
    const again = restoreSave(c, file);
    if (!again.ok) throw new Error(again.issue.message);
    expect(run(c, 8, 20, ENDED)).toBe(digestA);
    c.destroy();
  });

  it.each(["auto", "reload"] as const)("stays ended across a live swap (%s)", (strategy) => {
    const a = runtime(opener());
    const b = runtime(opener());
    run(a, 0, 8, ENDED);
    run(b, 0, 8, ENDED);
    const moved = expandScene(
      sceneOf([node("post", [2, 1]), node("lamp", [3, 3])]),
      createRegistry(opener() as GameDefinition),
    );
    const report = b.swap(moved, { prefabs: new Map(), strategy });
    if (!report.ok) throw new Error(report.issue.message);
    expect(b.ctx.dialogue.view()).toBeNull();
    expect(legalCommands(null, startState(b))).toBeNull();
    const events = (rt: SceneRuntimeHandle) => {
      const out: unknown[] = [];
      for (let t = 8; t < 20; t++) out.push(step(rt, ENDED[t] ?? []).events);
      return out;
    };
    expect(events(b)).toEqual(events(a));
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.ctx.persist.value).toEqual({ gold: 1 });
    a.destroy();
    b.destroy();
  });
});

describe("a world save restored over the load's voiced line", () => {
  const opener = () => talker(undefined, { onLoad: true });
  const stopVoice: PresentRequest = { kind: "audio", op: { op: "stop", key: DIALOGUE_VOICE_KEY } };
  const stops = (result: StepResult) => audioOf([result]).filter((p) => p.op.op === "stop");

  /** A save of the load's conversation after `script` runs to `ticks`. */
  function saveAt(ticks: number, script: Readonly<Record<number, GameCommand[]>>): SaveFile {
    const a = runtime(opener());
    run(a, 0, ticks, script);
    const file = worldSave(a, opener());
    a.destroy();
    return file;
  }

  function restoredOnLoad(file: SaveFile): SceneRuntimeHandle {
    const b = runtime(opener(), { record: true });
    expect(b.ctx.dialogue.view()).toMatchObject({ node: "hello", line: 0 });
    const restored = restoreSave(b, file);
    if (!restored.ok) throw new Error(restored.issue.message);
    return b;
  }

  it("cuts that voice for another voiced line, and the next line cuts the saved one's", () => {
    const file = saveAt(2, { 1: [advance] });
    expect(file.world!.systems[SAVE_DIALOGUE_KEY]).toMatchObject({ run: { voiced: true } });
    const b = restoredOnLoad(file);
    expect(b.ctx.dialogue.view()).toMatchObject({ node: "hello", line: 1 });
    expect(stops(step(b))).toEqual([stopVoice]);
    expect(stops(step(b, [choose(0)]))).toEqual([stopVoice]);
    b.destroy();
  });

  it("cuts that voice for an unvoiced line, and has none left for the end to stop", () => {
    const file = saveAt(4, { 1: [advance], 3: [choose(0)] });
    expect(file.world!.systems[SAVE_DIALOGUE_KEY]).toMatchObject({ run: { dialogue: TALK } });
    expect(file.world!.systems[SAVE_DIALOGUE_KEY]).not.toHaveProperty("run.voiced");
    const b = restoredOnLoad(file);
    expect(b.ctx.dialogue.view()).toMatchObject({ node: "yes", line: 0 });
    expect(stops(step(b))).toEqual([stopVoice]);
    const end = step(b, [advance]);
    expect(end.events.map((e) => e.type)).toContain(DIALOGUE_END);
    expect(stops(end)).toEqual([]);
    b.destroy();
  });

  it("lets it play on when the saved line is the one on screen, until the next line", () => {
    const b = restoredOnLoad(saveAt(1, {}));
    expect(stops(step(b))).toEqual([]);
    expect(stops(step(b, [advance]))).toEqual([stopVoice]);
    b.destroy();
  });
});

describe("a live swap mid-conversation", () => {
  it.each(["auto", "reload"] as const)("keeps the conversation (%s)", (strategy) => {
    const a = runtime();
    const b = runtime();
    run(a, 0, 7);
    run(b, 0, 7);
    const view = b.ctx.dialogue.view();
    const moved = expandScene(
      sceneOf([node("post", [2, 1]), node("lamp", [3, 3])]),
      createRegistry(talker() as GameDefinition),
    );
    const report = b.swap(moved, { prefabs: new Map(), strategy });
    if (!report.ok) throw new Error(report.issue.message);
    expect(b.ctx.dialogue.view()).toEqual(view);
    const events = (rt: SceneRuntimeHandle) => {
      const out: unknown[] = [];
      for (let t = 7; t < 20; t++) out.push(step(rt, SCRIPT[t] ?? []).events);
      return out;
    };
    expect(events(b)).toEqual(events(a));
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.ctx.persist.value).toEqual({ gold: 1 });
    a.destroy();
    b.destroy();
  });
});

describe("a turns game", () => {
  it("wakes on @dialogue-advance, by the headless rule", () => {
    const time = resolveTime({ game: { kind: "turns", rate: 30 } });
    expect(tickWakes(time, { actions: [], commands: [advance], pointers: [] })).toBe(true);
    expect(tickWakes(time, { actions: [], commands: [], pointers: [] })).toBe(false);
  });

  describe("in the shell", () => {
    let canvas: HTMLCanvasElement;
    let pending: FrameRequestCallback[] = [];
    let now = 0;
    const games: GameInstance[] = [];
    const wall = (ms: number) => {
      for (let t = 0; t < ms; t += 1000 / 120) {
        now += 1000 / 120;
        const due = pending;
        pending = [];
        for (const cb of due) cb(now);
      }
    };

    beforeEach(() => {
      canvas = document.createElement("canvas");
      document.body.appendChild(canvas);
      pending = [];
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
      vi.stubGlobal("cancelAnimationFrame", () => {});
    });
    afterEach(() => {
      for (const g of games.splice(0)) g.destroy();
      document.body.replaceChildren();
      vi.unstubAllGlobals();
    });

    it("sleeps until a dialogue command, which ticks it, and the store follows the view", async () => {
      const game = talker({ kind: "turns", rate: 30 }) as GameDefinition;
      const instance = await createGame(canvas, {
        game,
        project,
        scene: expandScene(PORCH, createRegistry(game)),
      });
      games.push(instance);
      instance.start();
      const played = instance.play(PORCH);
      expect(played, JSON.stringify(played)).toMatchObject({ ok: true });
      const store = instance.getStore();
      expect(instance.send({ name: "talk" })).toBe(true);
      wall(500);
      expect(store.state.dialogue).toMatchObject({ node: "hello", line: 0 });
      const idle = store.state.tick;
      wall(500);
      expect(store.state.tick).toBe(idle);

      expect(instance.send(advance)).toBe(true);
      wall(500);
      expect(store.state.tick).toBe(idle + 1);
      expect(store.state.dialogue).toMatchObject({ node: "hello", line: 1 });
      expect(instance.send(choose(0))).toBe(true);
      wall(500);
      expect(store.state.dialogue).toMatchObject({ node: "yes", line: 0 });
      expect(instance.send(advance)).toBe(true);
      wall(500);
      expect(store.state.dialogue).toBeNull();
    });

    it("shows a conversation an event game's load starts at Play, and its box advances it", async () => {
      const game = talker({ kind: "event" }, { onLoad: true }) as GameDefinition;
      const instance = await createGame(canvas, {
        game,
        project,
        scene: expandScene(PORCH, createRegistry(game)),
      });
      games.push(instance);
      instance.start();
      const store = instance.getStore();
      instance.setMode("edit");
      expect(store.state.dialogue).toBeNull();

      const played = instance.play(PORCH);
      expect(played, JSON.stringify(played)).toMatchObject({ ok: true });
      expect(store.state.dialogue).toMatchObject({ node: "hello", line: 0 });
      const idle = store.state.tick;
      wall(500);
      expect(store.state.tick).toBe(idle);

      const send = vi.spyOn(instance, "send");
      const unmount = mountUi(instance, canvas, (ctx) =>
        createDialogueBox(ctx, { speed: Infinity }),
      );
      const box = document.querySelector<HTMLElement>("[data-jams-dialogue]")!;
      expect(box.hidden).toBe(false);
      box.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      expect(send).toHaveBeenCalledWith({ name: DIALOGUE_ADVANCE_COMMAND });
      wall(500);
      expect(store.state.dialogue).toMatchObject({ node: "hello", line: 1 });

      instance.setMode("edit");
      expect(store.state.dialogue).toBeNull();
      expect(box.hidden).toBe(true);
      unmount();
    });
  });
});
