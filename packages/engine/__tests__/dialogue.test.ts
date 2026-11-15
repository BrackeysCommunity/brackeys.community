// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { layoutFromDoc, layoutToDoc } from "../collab/layout";
import { createDialogueRunner, DIALOGUE_LOG_MAX, type DialogueRunner } from "../dialogue/runner";
import { memoryVars, persistVars, type DialogueVars } from "../dialogue/vars";
import { createRegistry } from "../game/define";
import { resolveTime } from "../game/time";
import type { JsonValue, PersistContext } from "../game/types";
import { deepFreeze } from "../project/canonical";
import { formatAssetDoc, parseAssetDoc, type DocLayout, type KindEnv } from "../project/kinds";
import {
  dialogueExits,
  dialogueKind,
  reachableNodes,
  type DialogueFile,
  type DialogueNode,
} from "../project/kinds/dialogue";
import { buildRefIndex } from "../project/refs";
import { heldProject, type HeldFile } from "../project/runtime-view";
import { validateProject } from "../project/validate-project";
import { runHash } from "../runtime/play-session";
import { expandScene } from "../scene/expand";
import type { SceneIssue } from "../scene/types";
import {
  GATE_DIALOGUE,
  GATE_ID,
  GATE_PORTRAITS,
  GATE_STRINGS,
  GATE_VOICE,
  gateDialogue,
  gateLookup,
} from "./fixtures/dialogue/gate";
import { CC0, heldDocs, physicsFreeFiles, png, scene } from "./fixtures/held-project";

const registry = createRegistry();
const env: KindEnv = { registry, project: null };
const layout = dialogueKind.layout as DocLayout;

const text = (file: DialogueFile) => formatAssetDoc(dialogueKind, file);
/** Every issue a file raises on its own: the schema's, then the kind's `validate`. */
const issuesOf = (file: unknown): SceneIssue[] =>
  parseAssetDoc(dialogueKind, JSON.stringify(file, null, 2), env).issues;
const brief = (issues: readonly SceneIssue[]) =>
  issues.map((i) => ({ code: i.code, severity: i.severity, path: i.path }));
const withNodes = (...nodes: DialogueNode[]): DialogueFile => ({
  kind: "dialogue",
  v: 1,
  start: nodes[0]?.id ?? "start",
  nodes,
});

describe("the gate fixture", () => {
  it("raises nothing, on its own or against its strings", () => {
    expect(issuesOf(GATE_DIALOGUE)).toEqual([]);
    expect(dialogueKind.crossValidate!(GATE_DIALOGUE, gateLookup())).toEqual([]);
  });

  it("round-trips byte-identical through its text and a Y.Doc, on both ends of the wire", () => {
    const written = text(GATE_DIALOGUE);
    const parsed = parseAssetDoc(dialogueKind, written, env);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.value).toEqual(GATE_DIALOGUE);
    expect(text(parsed.value)).toBe(written);

    const doc = layoutToDoc(new Y.Doc(), layout, parsed.value, "seed");
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    for (const back of [layoutFromDoc(doc, layout), layoutFromDoc(remote, layout)])
      expect(text(back as DialogueFile)).toBe(written);
  });

  it("reaches both endings from start", () => {
    expect([...reachableNodes(GATE_DIALOGUE)]).toEqual(["gate", "through", "turned-away"]);
    const ends = GATE_DIALOGUE.nodes.flatMap((n) => (n.end ? [n.end] : []));
    expect(ends).toEqual(["paid", "left"]);
    expect(dialogueExits(GATE_DIALOGUE.nodes[0]!)).toEqual([
      { to: "through", at: ["choices", 0, "to"] },
      { to: "turned-away", at: ["choices", 1, "to"] },
    ]);
  });
});

describe("dialogue-dead-end", () => {
  it("is an error for a node with no choices, no next and no end", () => {
    const file = withNodes({ id: "a", lines: [], next: "b" }, { id: "b", lines: [] });
    expect(brief(issuesOf(file))).toEqual([
      { code: "dialogue-dead-end", severity: "error", path: "/nodes/1" },
    ]);
    const empty = withNodes({ id: "a", lines: [], choices: [] });
    expect(brief(issuesOf(empty))).toEqual([
      { code: "dialogue-dead-end", severity: "error", path: "/nodes/0" },
    ]);
  });

  it("is a warning when every choice's if can fail with nothing to fall back on", () => {
    const guarded = (over: Partial<DialogueNode> = {}): DialogueFile =>
      withNodes(
        {
          id: "a",
          lines: [],
          choices: [
            { to: "b", if: { var: "/gold", gte: 3 } },
            { to: "b", if: { visited: "b" } },
          ],
          ...over,
        },
        { id: "b", lines: [], end: "done" },
      );
    const [issue, ...rest] = issuesOf(guarded());
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      code: "dialogue-dead-end",
      severity: "warn",
      path: "/nodes/0/choices",
    });
    expect(issue!.message).toContain('every choice of node "a" has an `if`');

    expect(issuesOf(guarded({ next: "b" }))).toEqual([]);
    expect(issuesOf(guarded({ end: "gave-up" }))).toEqual([]);
    const fallback = guarded();
    const node = fallback.nodes[0]!;
    fallback.nodes[0] = { ...node, choices: [...node.choices!, { to: "b" }] };
    expect(issuesOf(fallback)).toEqual([]);
  });

  it("is a warning for a node whose if has no else", () => {
    const gated = (over: Partial<DialogueNode> = {}) =>
      withNodes(
        { id: "a", lines: [{ say: "hi" }], next: "b" },
        { id: "b", if: { var: "/key", truthy: true }, lines: [{ say: "in" }], end: "in", ...over },
        { id: "c", lines: [], end: "out" },
      );
    const [issue, ...rest] = issuesOf(gated());
    expect(rest.map((i) => i.code)).toEqual(["dialogue-unreachable"]);
    expect(issue).toMatchObject({
      code: "dialogue-dead-end",
      severity: "warn",
      path: "/nodes/1/if",
    });
    expect(issue!.message).toContain('node "b" has an `if` and no `else`');
    expect(issuesOf(gated({ else: "c" }))).toEqual([]);

    const runner = createDialogueRunner(gated(), GATE_ID, memoryVars({}), () => {});
    expect(runner.advance()).toBe(false);
    expect(runner.view()).toMatchObject({ node: "b", stuck: true });
  });

  it("flags a loop of nodes that pass on without a line: an error when nothing breaks it", () => {
    const loop = withNodes(
      { id: "a", lines: [{ say: "go" }], next: "b" },
      { id: "b", lines: [], next: "c" },
      { id: "c", lines: [], next: "b" },
    );
    expect(brief(issuesOf(loop))).toEqual([
      { code: "dialogue-dead-end", severity: "error", path: "/nodes/1" },
    ]);
    expect(issuesOf(loop)[0]!.message).toContain('nodes "b", "c" can pass on round each other');
    const runner = createDialogueRunner(loop, GATE_ID, memoryVars({}), () => {});
    expect(runner.advance()).toBe(false);
    expect(runner.view().stuck).toBe(true);

    const maybe = withNodes(
      { id: "a", lines: [{ say: "go" }], next: "b" },
      { id: "b", lines: [{ say: "once", if: { visited: "a" } }], next: "c" },
      { id: "c", if: { var: "/ok", truthy: true }, else: "c", lines: [{ say: "ok" }], next: "b" },
    );
    const issues = issuesOf(maybe);
    expect(brief(issues)).toEqual([
      { code: "dialogue-dead-end", severity: "warn", path: "/nodes/2" },
    ]);
    expect(issues[0]!.message).toContain('node "c" can pass back to itself');

    const broken = withNodes(
      { id: "a", lines: [{ say: "go" }], next: "b" },
      { id: "b", lines: [], choices: [{ to: "c" }] },
      { id: "c", lines: [], next: "b" },
    );
    expect(issuesOf(broken)).toEqual([]);
  });
});

describe("dialogue-unreachable", () => {
  it("warns of a node no path from start reaches, through choices, next and else", () => {
    const file = withNodes(
      { id: "a", lines: [], if: { var: "/met", truthy: true }, else: "c", next: "b" },
      { id: "b", lines: [], choices: [{ to: "d" }] },
      { id: "c", lines: [], end: "x" },
      { id: "d", lines: [], end: "y" },
      { id: "lost", lines: [], next: "d" },
    );
    expect(brief(issuesOf(file))).toEqual([
      { code: "dialogue-unreachable", severity: "warn", path: "/nodes/4" },
    ]);
    expect([...reachableNodes(file)]).toEqual(["a", "b", "c", "d"]);
    const written = text(file);
    const [issue] = parseAssetDoc(dialogueKind, written, env).issues;
    expect(issue?.line).toBe(written.split("\n").findIndex((l) => l.includes('"id": "lost"')) + 1);
  });

  it("isn't judged when start names no node", () => {
    const file = { ...withNodes({ id: "a", lines: [], end: "x" }), start: "nowhere" };
    expect(brief(issuesOf(file))).toEqual([
      { code: "asset-missing", severity: "error", path: "/start" },
    ]);
    expect(reachableNodes(file).size).toBe(0);
  });
});

describe("asset-missing for a node", () => {
  it("names a to, next, else or start naming no node, with the closest id", () => {
    const file: DialogueFile = {
      ...withNodes(
        { id: "gate", lines: [], choices: [{ to: "throgh" }, { to: "gate" }] },
        { id: "through", lines: [], if: { visited: "gate" }, else: "nope", next: "gone" },
      ),
      start: "gat",
    };
    const issues = issuesOf(file).filter((i) => i.code === "asset-missing");
    expect(issues.map((i) => [i.path, i.got, i.detail])).toEqual([
      ["/start", "gat", { kind: "node" }],
      ["/nodes/0/choices/0/to", "throgh", { kind: "node" }],
      ["/nodes/1/next", "gone", { kind: "node" }],
      ["/nodes/1/else", "nope", { kind: "node" }],
    ]);
    expect(issues[1]!.message).toBe(
      'node "gate" names node "throgh", which the dialogue doesn\'t have; did you mean "through"?',
    );
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });
});

describe("schema", () => {
  it("refuses a variable that isn't a JSON pointer, in a condition, an effect or a line's vars", () => {
    const bad = [
      (f: DialogueFile) => ((f.nodes[0]!.choices![0]!.if as { var: string }).var = "gold"),
      (f: DialogueFile) => ((f.nodes[0]!.choices![0]!.do![0] as { add: string }).add = "gold"),
      (f: DialogueFile) => ((f.nodes[1]!.do![0] as { set: string }).set = "flags/gate-open"),
      (f: DialogueFile) =>
        ((f.nodes[0]!.lines[0] as { vars?: Record<string, string> }).vars = { n: "~2" }),
      (f: DialogueFile) =>
        ((f.nodes[0]!.choices![0]! as { if: unknown }).if = { not: { var: "" } }),
    ];
    for (const spoil of bad) {
      const file = gateDialogue();
      spoil(file);
      const issues = issuesOf(file);
      expect(issues.length, JSON.stringify(file)).toBeGreaterThan(0);
      expect(issues.every((i) => i.code === "schema")).toBe(true);
      expect(issues.map((i) => i.message).join("\n")).toContain("JSON Pointer");
    }
    const escaped = gateDialogue();
    (escaped.nodes[1]!.do![0] as { set: string }).set = "/flags/gate~1open/~0x";
    expect(issuesOf(escaped)).toEqual([]);
  });
});

describe("string-key-missing", () => {
  const without = (key: string, locale?: string) => ({
    ...GATE_STRINGS,
    strings: GATE_STRINGS.strings.flatMap((row) => {
      if (row.key !== key) return [row];
      if (!locale) return [];
      const { [locale]: _, ...rest } = row;
      return [rest as typeof row];
    }),
  });
  const cross = (lookup = gateLookup(), file = GATE_DIALOGUE) =>
    dialogueKind.crossValidate!(file, lookup);

  it("is an error for a key the default locale has no text for, with its pointer", () => {
    const issues = cross(gateLookup({ strings: without("gate.pay") }));
    expect(issues.map((i) => [i.severity, i.path, i.got])).toEqual([
      ["error", "/nodes/0/choices/0/text", "gate.pay"],
    ]);
    expect(issues[0]!.message).toBe(
      'string key "gate.pay" has no text in the default locale "en" nor in fr',
    );
  });

  it("is info for another locale, and a fallback chain's text clears it", () => {
    const strings = without("speaker.guard", "fr");
    expect(brief(cross(gateLookup({ strings })))).toEqual([
      { code: "string-key-missing", severity: "info", path: "/speakers/0/name" },
    ]);
    const chained = gateLookup({
      strings: {
        ...strings,
        strings: strings.strings.map((r) =>
          r.key === "speaker.guard" ? { ...r, de: "Wache" } : r,
        ),
      },
      locales: { default: "en", available: ["en", "fr"], fallback: { fr: ["de"] } },
    });
    expect(cross(chained)).toEqual([]);
  });

  it("raises only a warning for literal say text", () => {
    const file = gateDialogue();
    const line = file.nodes[2]!.lines[0] as { text?: string; say?: string };
    delete line.text;
    line.say = "Come back with coin.";
    const choice = file.nodes[0]!.choices![1] as { text?: string; say?: string };
    choice.say = "Turn back.";
    expect(brief(cross(gateLookup({ dialogue: file }), file))).toEqual([
      { code: "string-key-missing", severity: "warn", path: "/nodes/2/lines/0/say" },
    ]);
  });

  it("is reported by validateProject on the dialogue's doc", () => {
    const held = heldDocs({
      "talk/gate-talk.json": GATE_DIALOGUE,
      "talk/gate-strings.json": without("gate.later"),
    });
    const project = heldProject(held.files, registry, { projectId: "talk", name: "Talk" });
    const texts = new Map(
      [...project.view.byId.values()].map((e) => [e.id, held.texts.get(e.path)!]),
    );
    const issues = validateProject(project.view, texts, project.kinds, {
      registry,
      project: project.view,
    });
    const talk = issues.filter((i) => i.entityIds[0] === GATE_ID);
    expect(talk.map((i) => [i.code, i.severity, i.entityIds, i.path])).toEqual([
      ["string-key-missing", "error", [GATE_ID], "/nodes/2/lines/0/text"],
    ]);
  });
});

describe("the dialogue kind's refs", () => {
  it("names portraits as an atlas or a texture and voices as a sound or an audio clip", () => {
    const file = gateDialogue();
    file.nodes[1]!.lines = [
      { speaker: "guard", text: "gate.go-on", portrait: { asset: "guard-smile" } },
    ];
    expect(dialogueKind.refs!(file)).toEqual([
      {
        pointer: "/speakers/@guard/portrait/asset",
        id: GATE_PORTRAITS,
        kinds: ["atlas", "texture"],
      },
      { pointer: "/nodes/@gate/lines/0/voice", id: GATE_VOICE, kinds: ["sound", "audio"] },
      {
        pointer: "/nodes/@through/lines/0/portrait/asset",
        id: "guard-smile",
        kinds: ["atlas", "texture"],
      },
    ]);
  });

  it("dangle in a project without them, and hold with a texture and a sound", () => {
    const talk = heldDocs({ "talk/gate-talk.json": GATE_DIALOGUE });
    const refsOf = (files: HeldFile[]) => {
      const project = heldProject(files, registry, { projectId: "talk", name: "Talk" });
      const values = new Map(
        files.flatMap((f) => {
          const entry = [...project.view.byId.values()].find((e) => e.path === f.path);
          return entry && f.json !== undefined ? [[entry.id, f.json] as const] : [];
        }),
      );
      return buildRefIndex(project.view, values, project.kinds, {
        registry,
        project: project.view,
      });
    };
    expect(
      refsOf(talk.files)
        .dangling()
        .map((i) => [i.code, i.path, i.got, i.expected]),
    ).toEqual([
      ["asset-missing", "/speakers/@guard/portrait/asset", GATE_PORTRAITS, "atlas or texture"],
      ["asset-missing", "/nodes/@gate/lines/0/voice", GATE_VOICE, "sound or audio"],
    ]);

    const media = heldDocs({
      [`sfx/${GATE_VOICE}.json`]: { kind: "sound", v: 1, bus: "voice", variants: [] },
    });
    const full = [
      ...talk.files,
      ...media.files,
      {
        path: `art/${GATE_PORTRAITS}.png`,
        sidecar: png(GATE_PORTRAITS, "d".repeat(64), 64, 16, CC0),
      },
    ];
    const index = refsOf(full);
    expect(index.dangling()).toEqual([]);
    expect(index.referrers(GATE_VOICE)).toEqual([
      { id: GATE_ID, kind: "dialogue", pointer: "/nodes/@gate/lines/0/voice" },
    ]);
  });
});

describe("a dialogue in a run's hash", () => {
  it("joins only in a project that has one, and a changed line changes it", () => {
    const yard = expandScene(scene("yard"), registry);
    const time = resolveTime({});
    const base = physicsFreeFiles();
    const runOf = (files: HeldFile[]) =>
      runHash(
        yard,
        time,
        registry,
        heldProject(files, registry, { projectId: "free", name: "Free" }).runtime,
      );
    const withTalk = (file: DialogueFile) => [
      ...base.files,
      ...heldDocs({ "talk/gate-talk.json": file }).files,
    ];
    const strings = [...base.files, ...heldDocs({ "talk/gate-strings.json": GATE_STRINGS }).files];
    expect(runOf(strings)).toBe(runOf(base.files));
    const talk = runOf(withTalk(GATE_DIALOGUE));
    expect(talk).not.toBe(runOf(base.files));
    const changed = gateDialogue();
    changed.nodes[0]!.choices![0]!.do = [{ add: "/gold", by: -4 }];
    expect(runOf(withTalk(changed))).not.toBe(talk);
  });
});

/** A `ctx.persist` that freezes what it holds, as the runtime's does, and counts its writes. */
function fakePersist(initial: JsonValue): PersistContext & { writes: number } {
  let value = deepFreeze(initial);
  return {
    writes: 0,
    get value() {
      return value;
    },
    set(next) {
      this.writes++;
      value = deepFreeze(next);
    },
  };
}

type Event = { type: string; data?: JsonValue };

function run(
  file: DialogueFile,
  vars: DialogueVars,
  opts?: { node?: string; visited?: readonly string[] },
): { runner: DialogueRunner; events: Event[] } {
  const events: Event[] = [];
  const runner = createDialogueRunner(
    file,
    GATE_ID,
    vars,
    (type, data) => events.push(data === undefined ? { type } : { type, data }),
    opts,
  );
  return { runner, events };
}

const gold = (n: number) => fakePersist({ gold: n });
const where = (r: DialogueRunner) => {
  const v = r.view();
  return { node: v.node, line: v.line, ended: v.ended, choices: v.choices };
};

describe("the dialogue runner over persistVars", () => {
  it("pays the toll: the condition reads gold, the effects spend it and open the gate", () => {
    const persist = gold(5);
    const { runner, events } = run(GATE_DIALOGUE, persistVars({ persist }));
    const view = runner.view();
    expect(view.current).toMatchObject({
      speaker: "guard",
      speakerName: "speaker.guard",
      text: "gate.halt",
      voice: GATE_VOICE,
      portrait: { asset: GATE_PORTRAITS, frame: "guard" },
    });
    expect(view.choices).toEqual([
      { index: 0, text: "gate.pay", enabled: true },
      { index: 1, text: "gate.leave", enabled: true },
    ]);
    expect(runner.advance()).toBe(false);

    expect(runner.choose(0)).toBe(true);
    expect(persist.value).toEqual({ gold: 2, flags: { "gate-open": true } });
    expect(where(runner)).toEqual({ node: "through", line: 0, ended: null, choices: null });
    expect(runner.advance()).toBe(true);
    expect(runner.view().ended).toBe("paid");
    expect(runner.advance()).toBe(false);
    expect(runner.choose(0)).toBe(false);
    expect(events).toEqual([
      { type: "dialogue:line", data: { dialogue: GATE_ID, node: "gate", line: 0 } },
      { type: "dialogue:choices", data: { dialogue: GATE_ID, node: "gate", count: 2 } },
      { type: "dialogue:line", data: { dialogue: GATE_ID, node: "through", line: 0 } },
      { type: "dialogue:end", data: { dialogue: GATE_ID, ending: "paid" } },
    ]);
    expect(runner.view().log.map((l) => [l.node, l.speaker, l.text])).toEqual([
      ["gate", "speaker.guard", "gate.halt"],
      ["through", "speaker.guard", "gate.go-on"],
    ]);
  });

  it("hides the toll without the coin, and ignores picking it", () => {
    const persist = gold(1);
    const { runner, events } = run(GATE_DIALOGUE, persistVars({ persist }));
    expect(runner.view().choices).toEqual([{ index: 1, text: "gate.leave", enabled: true }]);
    const before = runner.view();
    expect(runner.choose(0)).toBe(false);
    expect(runner.choose(7)).toBe(false);
    expect(runner.choose(-1)).toBe(false);
    expect(runner.view()).toBe(before);
    expect(persist.writes).toBe(0);
    expect(runner.choose(1)).toBe(true);
    expect(runner.advance()).toBe(true);
    expect(runner.view().ended).toBe("left");
    expect(events.at(-1)).toEqual({
      type: "dialogue:end",
      data: { dialogue: GATE_ID, ending: "left" },
    });
    expect(persist.value).toEqual({ gold: 1 });
  });

  it("shows a disabled choice it can't take, and refuses it", () => {
    const file = gateDialogue();
    file.nodes[0]!.choices![0]!.hidden = "disable";
    const { runner } = run(file, persistVars({ persist: gold(2) }));
    expect(runner.view().choices).toEqual([
      { index: 0, text: "gate.pay", enabled: false },
      { index: 1, text: "gate.leave", enabled: true },
    ]);
    expect(runner.choose(0)).toBe(false);
    expect(runner.view().node).toBe("gate");
  });

  it("reads and writes through ctx.persist without touching the frozen value", () => {
    const persist = fakePersist(null);
    const vars = persistVars({ persist });
    expect(vars.get("/a")).toBeUndefined();
    vars.set("/a/b", 1);
    vars.set("/list", []);
    vars.set("/list/-", "x");
    vars.set("/list/0", "y");
    vars.set("/list/1", "z");
    vars.set("/odd~1key/~0", true);
    expect(persist.value).toEqual({ a: { b: 1 }, list: ["y", "z"], "odd/key": { "~": true } });
    expect(vars.get("/list/1")).toBe("z");
    expect(vars.get("/list/01")).toBeUndefined();
    expect(vars.get("/a/b/c")).toBeUndefined();
    expect(vars.get("/constructor")).toBeUndefined();
    expect(persist.writes).toBe(6);
    expect(Object.isFrozen(persist.value)).toBe(true);
  });
});

describe("conditions and effects", () => {
  const talk = (...nodes: DialogueNode[]) => withNodes(...nodes);

  it("filters lines by `if` and fills each line's {name} values when shown", () => {
    const vars = memoryVars({ name: "Ada", coins: 4, tags: ["a"], hero: { lvl: 2 } });
    const file = talk({
      id: "start",
      lines: [
        { say: "hi {who}", vars: { who: "/name", n: "/coins", none: "/nope", obj: "/hero" } },
        { say: "rich", if: { var: "/coins", gt: 10 } },
        {
          say: "some",
          if: {
            all: [
              { var: "/coins", gte: 4, lte: 4 },
              { var: "/name", ne: "Bob" },
            ],
          },
        },
        { say: "tagged", if: { var: "/tags", eq: ["a"] } },
        {
          say: "any",
          if: { any: [{ var: "/coins", lt: 0 }, { not: { var: "/x", truthy: true } }] },
        },
        { say: "text", if: { var: "/name", gt: 0 } },
        { say: "hero", if: { var: "/hero", eq: { lvl: 2 } } },
      ],
      end: "done",
    });
    const { runner } = run(file, vars);
    expect(runner.view().current.vars).toEqual({ who: "Ada", n: "4", obj: '{"lvl":2}' });
    const shown = [runner.view().current.say];
    while (runner.advance() && runner.view().ended === null) shown.push(runner.view().current.say);
    expect(shown).toEqual(["hi {who}", "some", "tagged", "any", "hero"]);
    expect(runner.view().log.map((l) => l.line)).toEqual([0, 2, 3, 4, 6]);
    expect(runner.view().ended).toBe("done");
  });

  it("runs a node's `do` on entry: set, add, push and emit, before its lines' conditions", () => {
    const vars = memoryVars({});
    const { runner, events } = run(
      talk({
        id: "start",
        do: [
          { add: "/n", by: 2 },
          { add: "/n", by: -0.5 },
          { push: "/seen", value: "start" },
          { push: "/seen", value: { at: 1 } },
          { set: "/deep/flag", to: true },
          { emit: "shop:open", data: { stall: 3 } },
          { emit: "ping" },
        ],
        lines: [{ say: "open", if: { var: "/deep/flag", truthy: true } }],
        end: "done",
      }),
      vars,
    );
    expect(vars.value).toEqual({ n: 1.5, seen: ["start", { at: 1 }], deep: { flag: true } });
    expect(runner.view().current.say).toBe("open");
    expect(events.slice(0, 2)).toEqual([
      { type: "shop:open", data: { stall: 3 } },
      { type: "ping" },
    ]);
  });

  it("goes to `else` when a node's `if` fails, skipping its effects", () => {
    const vars = memoryVars({ key: false });
    const file = talk(
      { id: "start", lines: [{ say: "door" }], next: "locked" },
      {
        id: "locked",
        if: { var: "/key", truthy: true },
        else: "no-key",
        do: [{ set: "/opened", to: true }],
        lines: [{ say: "it opens" }],
        end: "in",
      },
      { id: "no-key", lines: [{ say: "it's locked" }], end: "out" },
    );
    const { runner } = run(file, vars);
    expect(runner.advance()).toBe(true);
    expect(where(runner)).toMatchObject({ node: "no-key", line: 0 });
    expect(runner.advance()).toBe(true);
    expect(runner.view().ended).toBe("out");
    expect(vars.get("/opened")).toBeUndefined();

    const open = run(file, memoryVars({ key: true }));
    open.runner.advance();
    expect(open.runner.view().current.say).toBe("it opens");
  });

  it("passes through lineless nodes and offers a lineless node's choices at once", () => {
    const file = talk(
      { id: "start", lines: [], do: [{ set: "/a", to: 1 }], next: "ask" },
      { id: "ask", lines: [], choices: [{ say: "ok", to: "fin" }] },
      { id: "fin", lines: [], end: "done" },
    );
    const { runner } = run(file, memoryVars());
    expect(where(runner)).toEqual({
      node: "ask",
      line: -1,
      ended: null,
      choices: [{ index: 0, say: "ok", enabled: true }],
    });
    expect(runner.view().current).toEqual({});
    expect(runner.choose(0)).toBe(true);
    expect(runner.view().ended).toBe("done");
  });

  it("stops in place where the file gives no way on, and on a loop of lineless nodes", () => {
    const dead = run(talk({ id: "start", lines: [{ say: "…" }] }), memoryVars());
    expect(dead.runner.view().stuck).toBeUndefined();
    expect(dead.runner.advance()).toBe(false);
    expect(where(dead.runner)).toMatchObject({ node: "start", line: 0, ended: null });
    expect(dead.runner.view().stuck).toBe(true);
    expect((dead.runner.save() as { view: object }).view).not.toHaveProperty("stuck");
    const again = run(talk({ id: "start", lines: [{ say: "…" }] }), memoryVars());
    again.runner.restore(dead.runner.save());
    expect(again.runner.view().stuck).toBe(true);
    expect(again.runner.advance()).toBe(false);

    const loop = run(
      talk({ id: "start", lines: [], next: "b" }, { id: "b", lines: [], next: "start" }),
      memoryVars(),
    );
    expect(loop.runner.advance()).toBe(false);
    expect(loop.runner.view().ended).toBeNull();

    const missing = run(talk({ id: "start", lines: [{ say: "x" }], next: "gone" }), memoryVars());
    expect(missing.runner.advance()).toBe(false);
    expect(missing.runner.advance()).toBe(false);
    expect(missing.runner.view()).toMatchObject({ node: "gone", stuck: true });
  });

  describe("a node none of whose choices can be taken", () => {
    const guarded = (over: Partial<DialogueNode>, hidden?: "disable") =>
      talk(
        {
          id: "start",
          lines: [{ say: "toll?" }],
          choices: [
            { say: "pay", to: "paid", if: { var: "/gold", gte: 3 }, ...(hidden && { hidden }) },
            { say: "sneak", to: "paid", if: { visited: "paid" } },
          ],
          ...over,
        },
        { id: "paid", lines: [{ say: "go on" }], end: "through" },
        { id: "away", lines: [{ say: "off you go" }], end: "turned-away" },
      );

    it("goes on through its next after its last line, offering nothing", () => {
      for (const hidden of [undefined, "disable"] as const) {
        const { runner, events } = run(guarded({ next: "away" }, hidden), memoryVars({ gold: 1 }));
        expect(where(runner)).toEqual({ node: "start", line: 0, ended: null, choices: null });
        expect(runner.advance()).toBe(true);
        expect(where(runner)).toEqual({ node: "away", line: 0, ended: null, choices: null });
        expect(runner.advance()).toBe(true);
        expect(runner.view().ended).toBe("turned-away");
        expect(events.map((e) => e.type)).not.toContain("dialogue:choices");
      }
    });

    it("ends with its end", () => {
      const { runner, events } = run(guarded({ end: "gave-up" }), memoryVars({ gold: 1 }));
      expect(runner.advance()).toBe(true);
      expect(runner.view()).toMatchObject({ node: "start", ended: "gave-up", choices: null });
      expect(events.at(-1)).toEqual({
        type: "dialogue:end",
        data: { dialogue: GATE_ID, ending: "gave-up" },
      });
    });

    it("is stuck with neither, with no choices offered", () => {
      const { runner } = run(guarded({}), memoryVars({ gold: 1 }));
      expect(runner.advance()).toBe(false);
      expect(runner.view()).toMatchObject({ node: "start", line: 0, choices: null, stuck: true });
      expect(runner.choose(0)).toBe(false);

      const lineless = guarded({ lines: [] });
      expect(run(lineless, memoryVars({ gold: 1 })).runner.view()).toMatchObject({
        node: "start",
        choices: null,
        stuck: true,
      });
    });

    it("still offers them once one can be taken", () => {
      const { runner } = run(guarded({ next: "away" }), memoryVars({ gold: 3 }));
      expect(runner.view().choices).toEqual([{ index: 0, say: "pay", enabled: true }]);
      expect(runner.advance()).toBe(false);
      expect(runner.choose(0)).toBe(true);
      expect(runner.view().node).toBe("paid");
    });
  });

  it("keeps the last 200 lines in the log", () => {
    const { runner } = run(
      talk({ id: "start", lines: [{ say: "again" }, { say: "and" }], next: "start" }),
      memoryVars(),
    );
    for (let i = 0; i < 300; i++) expect(runner.advance()).toBe(true);
    const { log } = runner.view();
    expect(log).toHaveLength(DIALOGUE_LOG_MAX);
    expect(log[0]).toEqual({ node: "start", line: 1, say: "and" });
    expect(log.at(-1)).toEqual({ node: "start", line: 0, say: "again" });
  });
});

describe("visited", () => {
  const file = withNodes(
    {
      id: "hub",
      lines: [
        { say: "welcome", if: { not: { visited: "shop" } } },
        { say: "back again", if: { visited: "shop" } },
      ],
      choices: [
        { say: "shop", to: "shop", if: { not: { visited: "shop" } } },
        { say: "leave", to: "bye" },
      ],
    },
    { id: "shop", lines: [{ say: "wares" }], next: "hub" },
    { id: "bye", lines: [], end: "bye" },
  );

  it("sees nodes entered in this conversation", () => {
    const { runner } = run(file, memoryVars());
    expect(runner.view().current.say).toBe("welcome");
    expect(runner.choose(0)).toBe(true);
    expect(runner.advance()).toBe(true);
    expect(runner.view().current.say).toBe("back again");
    expect(runner.view().choices).toEqual([{ index: 1, say: "leave", enabled: true }]);
  });

  it("sees the saved history it starts with", () => {
    const { runner } = run(file, memoryVars(), { visited: ["shop"] });
    expect(runner.view().current.say).toBe("back again");
    expect(runner.choose(0)).toBe(false);
  });

  it("starts at a given node", () => {
    const { runner } = run(file, memoryVars(), { node: "shop" });
    expect(where(runner)).toMatchObject({ node: "shop", line: 0 });
  });
});

describe("save and restore", () => {
  const file = withNodes(
    {
      id: "start",
      lines: [{ say: "one" }, { say: "two {g}", vars: { g: "/gold" } }, { say: "three" }],
      choices: [
        { say: "a", to: "a", do: [{ add: "/gold", by: 1 }] },
        { say: "b", to: "b", if: { visited: "a" }, hidden: "disable" },
      ],
    },
    { id: "a", lines: [{ say: "in a" }], end: "a" },
    { id: "b", lines: [{ say: "in b" }], end: "b" },
  );
  /** The rest of a conversation from here: each view after advancing, then after choosing 0. */
  const finish = (runner: DialogueRunner) => {
    const out = [runner.view()];
    while (runner.advance()) out.push(runner.view());
    runner.choose(0);
    out.push(runner.view());
    while (runner.advance()) out.push(runner.view());
    return out;
  };

  it("continues mid-node to the same views, events and variables", () => {
    const persist = gold(3);
    const first = run(file, persistVars({ persist }));
    first.runner.advance();
    const saved = JSON.parse(JSON.stringify(first.runner.save())) as JsonValue;
    const savedGold = persist.value;
    const eventsAt = first.events.length;
    const expected = finish(first.runner);

    const again = fakePersist(savedGold);
    const second = run(file, persistVars({ persist: again }), { node: "a" });
    second.events.length = 0;
    second.runner.restore(saved);
    expect(where(second.runner)).toMatchObject({ node: "start", line: 1 });
    expect(second.runner.view().current.vars).toEqual({ g: "3" });
    expect(finish(second.runner)).toEqual(expected);
    expect(second.events).toEqual(first.events.slice(eventsAt));
    expect(again.value).toEqual(persist.value);
  });

  it("keeps offered choices and the visited history", () => {
    const { runner } = run(file, memoryVars(), { visited: ["a"] });
    runner.advance();
    runner.advance();
    const saved = runner.save();
    const other = run(file, memoryVars());
    other.runner.restore(saved);
    expect(other.runner.view().choices).toEqual([
      { index: 0, say: "a", enabled: true },
      { index: 1, say: "b", enabled: true },
    ]);
    expect(other.runner.choose(1)).toBe(true);
    expect(other.runner.view().node).toBe("b");
  });

  it("refuses a save that isn't this dialogue's runner state", () => {
    const { runner } = run(file, memoryVars());
    const saved = runner.save() as { view: { dialogue: string; node: string } };
    expect(() => runner.restore(null)).toThrow(/runner save/);
    expect(() =>
      runner.restore({ ...saved, view: { ...saved.view, dialogue: "other" } } as JsonValue),
    ).toThrow(/other/);
    expect(() =>
      runner.restore({ ...saved, view: { ...saved.view, node: "gone" } } as JsonValue),
    ).toThrow(/no node "gone"/);
    expect(runner.view().node).toBe("start");
  });
});
