import { z } from "zod";

import { DIALOGUE_ADVANCE_COMMAND, DIALOGUE_CHOOSE_COMMAND } from "../../game/commands";
import { defineGame } from "../../game/define";
import type { LibraryScene, SceneLibrary } from "../../game/flow";
import type { EngineContext, JsonValue } from "../../game/types";
import { DIALOGUE_KIND, type DialogueFile } from "../../project/kinds/dialogue";
import { STRINGS_KIND, type StringsFile } from "../../project/kinds/strings";
import type { HeldFile } from "../../project/runtime-view";
import {
  DIALOGUE_END,
  DIALOGUE_LINE,
  type DialogueEndEvent,
  type DialogueLineEvent,
} from "../../runtime/types";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "visual-novel";
/** Raised when a chapter's conversation ends, before the next scene is asked for. */
export const CHAPTER_END = `${ID}:chapter`;

/** Each chapter's conversation, and the strings every one reads; each file's name is its id. */
export const ARRIVAL_TALK = "vn-arrival-talk";
export const MARKET_TALK = "vn-market-talk";
export const FINALE_TALK = "vn-finale-talk";
export const VN_STRINGS = "vn-strings";
/** The atlas the portraits are frames of, and its texture. */
export const VN_PORTRAITS = "vn-portraits";
const VN_PORTRAIT_SHEET = "vn-portrait-sheet";

/** The slot the game asks the host to keep a progress save in at each chapter's end. */
export const PROGRESS_SLOT = "story";

/** The listed scenes in play order. */
export const ARRIVAL = "vn-arrival";
export const MARKET = "vn-market";
export const FINALE = "vn-finale";

/** Each chapter: the scene that plays it, the conversation it opens with, and the scene after it. */
export const CHAPTERS: readonly { scene: string; dialogue: string; next: string | null }[] = [
  { scene: ARRIVAL, dialogue: ARRIVAL_TALK, next: MARKET },
  { scene: MARKET, dialogue: MARKET_TALK, next: FINALE },
  { scene: FINALE, dialogue: FINALE_TALK, next: null },
];

/** The ending that wins the run and the one that loses it; every other ending closes a chapter. */
export const GOOD_ENDING = "good";
export const BAD_ENDING = "bad";

/** What outlives the scene changes: the chapter reached, the flags and trust the choices set, and every line read. */
export type StoryState = {
  chapter: number;
  trust: number;
  flags: Record<string, boolean>;
  /** `<node>:<line>` of each line shown, oldest first: the text log. */
  log: string[];
};

export type VisualNovelSnapshot = {
  scene: string | null;
  /** The ending this scene's conversation reached, until the next scene loads. */
  ending: string | null;
  story: StoryState;
};

const storySchema = z.strictObject({
  chapter: z.number().int().min(0),
  trust: z.number().int(),
  flags: z.record(z.string(), z.boolean()),
  log: z.array(z.string()),
});

const initialStory = (): StoryState => ({ chapter: 0, trust: 0, flags: {}, log: [] });

const portrait = (frame: string) => ({ asset: VN_PORTRAITS, frame });

const SPEAKERS = [
  { id: "guide", name: "vn.speaker.guide", portrait: portrait("guide") },
  { id: "merchant", name: "vn.speaker.merchant", portrait: portrait("merchant") },
  { id: "warden", name: "vn.speaker.warden", portrait: portrait("warden") },
];

/** A conversation that starts at its first node, with every speaker. */
const talk = (nodes: DialogueFile["nodes"]): DialogueFile => ({
  kind: DIALOGUE_KIND,
  v: 1,
  start: nodes[0]!.id,
  speakers: structuredClone(SPEAKERS),
  nodes,
});

/**
 * The story in three conversations, one per scene, their choices written
 * into `persist`: helping the guide on arrival lets you vouch at the
 * market, which earns the key; the warden opens the gate only to a player
 * holding the key whose trust reached two. Every other path ends badly.
 */
export const VN_DIALOGUES: Readonly<Record<string, DialogueFile>> = {
  [ARRIVAL_TALK]: talk([
    {
      id: "arrival",
      lines: [
        { speaker: "guide", text: "vn.arrival.greet" },
        { speaker: "guide", text: "vn.arrival.ask", portrait: portrait("guide-worried") },
      ],
      choices: [
        {
          text: "vn.arrival.help",
          to: "helped",
          do: [
            { set: "/flags/helped", to: true },
            { add: "/trust", by: 1 },
          ],
        },
        { text: "vn.arrival.ignore", to: "ignored" },
      ],
    },
    {
      id: "helped",
      lines: [{ speaker: "guide", text: "vn.helped", portrait: portrait("guide-smile") }],
      end: "arrived",
    },
    { id: "ignored", lines: [{ speaker: "guide", text: "vn.ignored" }], end: "arrived" },
  ]),
  [MARKET_TALK]: talk([
    {
      id: "market",
      lines: [{ speaker: "merchant", text: "vn.market.offer" }],
      choices: [
        {
          text: "vn.market.vouch",
          if: { var: "/flags/helped", truthy: true },
          hidden: "disable",
          to: "vouched",
          do: [
            { set: "/flags/key", to: true },
            { add: "/trust", by: 1 },
          ],
        },
        { text: "vn.market.haggle", to: "haggled", do: [{ add: "/trust", by: -1 }] },
      ],
    },
    { id: "vouched", lines: [{ speaker: "merchant", text: "vn.vouched" }], end: "bargained" },
    { id: "haggled", lines: [{ speaker: "merchant", text: "vn.haggled" }], end: "bargained" },
  ]),
  [FINALE_TALK]: talk([
    {
      id: "finale",
      lines: [
        { speaker: "warden", text: "vn.finale.halt" },
        { speaker: "warden", text: "vn.finale.trust", vars: { trust: "/trust" } },
      ],
      choices: [
        {
          text: "vn.finale.key",
          if: {
            all: [
              { var: "/flags/key", truthy: true },
              { var: "/trust", gte: 2 },
            ],
          },
          hidden: "disable",
          to: "opened",
        },
        { text: "vn.finale.plead", to: "refused" },
      ],
    },
    { id: "opened", lines: [{ speaker: "warden", text: "vn.opened" }], end: GOOD_ENDING },
    { id: "refused", lines: [{ speaker: "warden", text: "vn.refused" }], end: BAD_ENDING },
  ]),
};

export const VN_STRINGS_FILE: StringsFile = {
  kind: STRINGS_KIND,
  v: 1,
  strings: [
    { key: "vn.title.arrival", en: "I. The arrival" },
    { key: "vn.title.market", en: "II. The market" },
    { key: "vn.title.finale", en: "III. The gate" },
    { key: "vn.speaker.guide", en: "Guide" },
    { key: "vn.speaker.merchant", en: "Merchant" },
    { key: "vn.speaker.warden", en: "Warden" },
    { key: "vn.arrival.greet", en: "You made it. The road was long." },
    { key: "vn.arrival.ask", en: "My cart is stuck. Could you lend a hand?" },
    { key: "vn.arrival.help", en: "Push the cart free." },
    { key: "vn.arrival.ignore", en: "Walk on." },
    { key: "vn.helped", en: "Thank you. Tell the merchant I sent you." },
    { key: "vn.ignored", en: "Suit yourself." },
    { key: "vn.market.offer", en: "The gate key? It isn't for strangers." },
    { key: "vn.market.vouch", en: "The guide sent me." },
    { key: "vn.market.haggle", en: "Name your price." },
    { key: "vn.vouched", en: "Then it's yours. Mind the warden." },
    { key: "vn.haggled", en: "No price is high enough." },
    { key: "vn.finale.halt", en: "Halt. Nobody passes at night." },
    { key: "vn.finale.trust", en: "The town speaks well of you: {trust}." },
    { key: "vn.finale.key", en: "Show the key." },
    { key: "vn.finale.plead", en: "Plead to pass." },
    { key: "vn.opened", en: "The gate swings open." },
    { key: "vn.refused", en: "Come back in the morning." },
  ],
};

/** Each speaker's face, and the guide's worried and smiling moods. */
const PORTRAIT_FRAMES = ["guide", "guide-worried", "guide-smile", "merchant", "warden"];

const PORTRAIT_FILES: readonly HeldFile[] = [
  {
    path: "art/vn-portraits.png",
    sidecar: {
      kind: "asset-sidecar",
      v: 1,
      key: "key-vn-portrait-sheet",
      id: VN_PORTRAIT_SHEET,
      sha256: "a".repeat(64),
      bytes: 2_048,
      meta: { format: "png", width: 320, height: 64 },
    },
  },
  {
    path: "art/vn-portraits.json",
    sidecar: {
      kind: "asset-sidecar",
      v: 1,
      key: "key-vn-portraits",
      id: VN_PORTRAITS,
      assetKind: "atlas",
      sha256: "b".repeat(64),
      bytes: 512,
      import: { texture: VN_PORTRAIT_SHEET },
      meta: {
        tool: "aseprite",
        frames: Object.fromEntries(
          PORTRAIT_FRAMES.map((f, i) => [f, { x: i * 64, y: 0, w: 64, h: 64, durationMs: 100 }]),
        ),
        order: PORTRAIT_FRAMES,
        tags: [],
        slices: [],
      },
    },
  },
];

/**
 * The story as the snapshot holds it, its keys in one order: a save's text
 * writes `persist` with its keys sorted, so a restored value reads in
 * another order than the one the run built.
 */
const snapshotStory = (s: StoryState): StoryState => ({
  chapter: s.chapter,
  trust: s.trust,
  flags: Object.fromEntries(
    Object.keys(s.flags)
      .sort()
      .map((k) => [k, s.flags[k]!]),
  ),
  log: [...s.log],
});

const chapterOf = (scene: string | null) => CHAPTERS.findIndex((c) => c.scene === scene);

/**
 * A visual novel on the event clock with no physics: only the recorded
 * `@dialogue-advance` and `@dialogue-choose` wake it. Each listed scene
 * plays its chapter's part of one conversation from its node; the choices
 * write flags and trust into `persist`, which carries them to the next
 * scene. When a chapter's part ends the game asks for a progress save and
 * for the next listed scene; the finale's endings win or lose the run.
 */
const game = defineGame<VisualNovelSnapshot>({
  id: ID,
  types: [],
  time: { kind: "event" },
  world: { physics: "none" },
  actions: [],
  persist: { initial: initialStory, schema: storySchema },
  play: {
    results: ["won", "lost"],
    markers: [CHAPTER_END],
    outcome: ({ events }) => {
      for (const e of events) {
        if (e.type !== DIALOGUE_END) continue;
        const { ending } = e.data as DialogueEndEvent;
        if (ending === GOOD_ENDING) return { result: "won", cause: "the gate opened" };
        if (ending === BAD_ENDING) return { result: "lost", cause: "the warden refused" };
      }
      return null;
    },
  },
  createRuntime(ctx: EngineContext) {
    let scene: string | null = null;
    let ending: string | null = null;
    const story = () => ctx.persist.value as unknown as StoryState;
    const write = (next: StoryState) => ctx.persist.set(next as unknown as JsonValue);
    const logged = (node: string, line: number) =>
      write({ ...story(), log: [...story().log, `${node}:${line}`] });

    return {
      onLoad(loaded) {
        scene = ctx.flow.scene ?? loaded.name;
        ending = null;
        const at = chapterOf(scene);
        const chapter = CHAPTERS[at];
        if (!chapter) return;
        write({ ...story(), chapter: at + 1 });
        ctx.dialogue.start(chapter.dialogue);
        // The line a conversation opens on is shown at the load, outside any step's events.
        const opened = ctx.dialogue.view();
        if (opened && opened.line >= 0) logged(opened.node, opened.line);
      },
      afterStep(_dtMs, events) {
        for (const e of events) {
          if (e.type === DIALOGUE_LINE) {
            const { node, line } = e.data as DialogueLineEvent;
            logged(node, line);
          } else if (e.type === DIALOGUE_END) {
            ending = (e.data as DialogueEndEvent).ending;
            const next = CHAPTERS[chapterOf(scene)]?.next ?? null;
            ctx.emit({ type: CHAPTER_END, at: { x: 0, y: 0 }, data: { scene, ending } });
            if (next === null) continue;
            ctx.saves.request(PROGRESS_SLOT, { depth: "progress", title: next });
            ctx.flow.request({ to: next });
          }
        }
      },
      snapshot: () => ({ scene, ending, story: snapshotStory(story()) }),
      restore(s) {
        scene = s.scene;
        ending = s.ending;
      },
    };
  },
});

const TITLES: Record<string, string> = {
  [ARRIVAL]: "vn.title.arrival",
  [MARKET]: "vn.title.market",
  [FINALE]: "vn.title.finale",
};

/** Who stands on each side of a chapter's stage. */
const CAST: Record<string, readonly [left: string, right: string]> = {
  [ARRIVAL]: ["guide", "merchant"],
  [MARKET]: ["guide", "merchant"],
  [FINALE]: ["merchant", "warden"],
};

/** A chapter's stage: its title sign by string key and its two portraits as sprites. */
function chapterScene(name: string): SceneDefinition {
  const [left, right] = CAST[name]!;
  const entities: EntityDef[] = [
    { id: "stage", type: "marker", at: [8, 4.5], tags: ["spawn"] },
    { id: "title", type: "marker", at: [8, 1], behaviors: { text: { key: TITLES[name]! } } },
    {
      id: "portrait-left",
      type: "marker",
      at: [3, 5],
      behaviors: { sprite: { asset: VN_PORTRAITS, frame: left, size: [3, 3] } },
    },
    {
      id: "portrait-right",
      type: "marker",
      at: [13, 5],
      behaviors: { sprite: { asset: VN_PORTRAITS, frame: right, size: [3, 3], flipX: true } },
    },
  ] as EntityDef[];
  return {
    v: SCENE_FORMAT_VERSION,
    game: ID,
    name,
    bounds: [0, 0, 16, 9],
    settings: { physics: "none" },
    entities,
  };
}

const SCENES = CHAPTERS.map((c) => chapterScene(c.scene));

/** The scene list: the three chapters in order, each scene with no prefabs. */
export const VN_FLOW: SceneLibrary = {
  list: CHAPTERS.map((c) => ({ scene: c.scene, title: TITLES[c.scene]! })),
  scenes: new Map<string, LibraryScene>(
    SCENES.map((def) => [def.name, { def, prefabs: new Map() }]),
  ),
};

const advance = { command: DIALOGUE_ADVANCE_COMMAND };
const choose = (choice: number) => ({ command: DIALOGUE_CHOOSE_COMMAND, args: { choice } });

/** In the market, the second scene, after vouching and before the line that ends its part. */
export const SAVE_AT = 3;

/**
 * Helps the guide, vouches at the market and shows the warden the key:
 * every command one the run offers as legal, the good ending on the last.
 */
export const visualNovelProbe: GenreProbe<VisualNovelSnapshot> & { flow: SceneLibrary } = {
  id: ID,
  rows: ["visual-novel"],
  game,
  scene: SCENES[0]!,
  flow: VN_FLOW,
  project: {
    files: [
      ...Object.entries(VN_DIALOGUES).map(([id, json]) => ({ path: `dialogue/${id}.json`, json })),
      { path: `text/${VN_STRINGS}.json`, json: VN_STRINGS_FILE },
      ...PORTRAIT_FILES,
    ],
  },
  script: {
    v: 2,
    scene: ARRIVAL,
    maxTicks: 40,
    // The event clock steps only on a command, so each one is a tick: one per line or choice.
    steps: [
      // The arrival: the guide's second line, then help.
      advance,
      choose(0),
      advance,
      // The market: vouching is enabled because the guide was helped.
      choose(0),
      advance,
      // The gate: the key and a trust of two enable showing it.
      advance,
      choose(0),
      advance,
    ],
  },
  expect: { result: "won", maxTicks: 8 },
  variants: [{ name: "saved-at-market", saveAt: SAVE_AT }],
};
