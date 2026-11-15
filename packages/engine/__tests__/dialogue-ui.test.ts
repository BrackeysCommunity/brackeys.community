// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { DialogueLogEntry, DialogueView, DialogueViewChoice } from "../dialogue/runner";
import { DIALOGUE_ADVANCE_COMMAND, DIALOGUE_CHOOSE_COMMAND } from "../game/commands";
import type { GameCommand } from "../game/types";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { parseRichText } from "../text/rich";
import { localeDirection, type StringTable } from "../text/strings";
import type { GameInstance, GameStoreState, UiActionEvent } from "../types";
import { UI_FONT, UI_THEME } from "../ui/bind";
import { createCaptions } from "../ui/captions";
import { createDialogueBox, createTextLog, DIALOGUE_INSET } from "../ui/dialogue";
import { createUiLayer } from "../ui/layer";
import { renderRichText } from "../ui/rich-dom";
import type { UiAssetUrl, UiContext } from "../ui/types";

const STRINGS: Record<string, Record<string, string>> = {
  en: {
    "guide.name": "Guide",
    "guide.hello": "Hello, {who}!",
    "choice.stay": "Stay a while",
    "choice.leave": "Leave",
  },
  ar: {
    "guide.name": "المرشد",
    "guide.hello": "مرحبا {who}",
    "choice.stay": "ابق قليلا",
    "choice.leave": "غادر",
  },
};

function table(locale: string): StringTable {
  const strings = STRINGS[locale] ?? {};
  return {
    get: (key) => strings[key] ?? `[${key}]`,
    has: (key) => key in strings,
    locale,
    direction: localeDirection(locale),
  };
}

const CHOICES: DialogueViewChoice[] = [
  { index: 0, text: "choice.stay", enabled: true },
  { index: 1, text: "choice.leave", enabled: true },
  { index: 2, say: "Locked", enabled: false },
  { index: 4, say: "[b]Wave[/b]", enabled: true },
];

function view(patch: Partial<DialogueView> = {}): DialogueView {
  return {
    dialogue: "intro",
    node: "start",
    line: 0,
    current: { speakerName: "guide.name", text: "guide.hello", vars: { who: "Ada" } },
    choices: null,
    log: [
      { node: "start", line: 0, speaker: "guide.name", text: "guide.hello", vars: { who: "Ada" } },
    ],
    ended: null,
    ...patch,
  };
}

/** A UiContext over a real UI layer, with a fake game that records what it's sent. */
function harness(
  opts: {
    reducedMotion?: boolean;
    locale?: string;
    assets?: Record<string, UiAssetUrl>;
    project?: ProjectRuntimeView;
    /** The actions the game binds; by default every one these tests name. */
    bound?: readonly string[];
    /** Further actions by the key codes they bind. */
    keys?: Record<string, readonly string[]>;
  } = {},
) {
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  document.body.append(canvas);
  const layer = createUiLayer(canvas);

  let state = { dialogue: null } as unknown as GameStoreState;
  const listeners = new Set<() => void>();
  const setDialogue = (dialogue: DialogueView | null) => {
    state = { ...state, dialogue };
    for (const l of [...listeners]) l();
  };

  const actionListeners = new Set<{
    fn: (e: UiActionEvent) => void;
    actions?: readonly string[];
  }>();
  const act = (action: string, e: Partial<UiActionEvent> = {}) => {
    for (const l of [...actionListeners])
      if (!l.actions || l.actions.includes(action))
        l.fn({ action, player: 0, kind: "button", device: "keyboard", down: true, ...e });
  };

  const handlers = new Map<string, Set<(p: unknown) => void>>();
  let locale = opts.locale ?? "en";
  const sent: GameCommand[] = [];
  const send = vi.fn((c: GameCommand) => {
    sent.push(c);
    return true;
  });

  const game = {
    send,
    project: () => opts.project ?? null,
    on: (event: string, fn: (p: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off: (event: string, fn: (p: unknown) => void) => handlers.get(event)?.delete(fn),
    input: {
      bindings: () => ({
        ...Object.fromEntries(
          (opts.bound ?? ["confirm", "up", "down", "talk", "prev", "next"]).map((a) => [
            a,
            [{ device: "key", code: "KeyZ" }],
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(opts.keys ?? {}).map(([a, codes]) => [
            a,
            codes.map((code) => ({ device: "key", code })),
          ]),
        ),
      }),
      onAction: (fn: (e: UiActionEvent) => void, o?: { actions?: readonly string[] }) => {
        const entry = { fn, ...(o?.actions && { actions: o.actions }) };
        actionListeners.add(entry);
        return () => actionListeners.delete(entry);
      },
    },
  } as unknown as GameInstance;

  const ctx: UiContext = {
    root: layer.root,
    canvas,
    game,
    slice: () => null,
    watch(select, fn) {
      let current = select(state);
      const l = () => {
        const next = select(state);
        if (Object.is(next, current)) return;
        const prev = current;
        current = next;
        fn(next, prev);
      };
      listeners.add(l);
      fn(current, undefined);
      return () => listeners.delete(l);
    },
    settings: {},
    reducedMotion: opts.reducedMotion ?? false,
    assetUrl: (id, frame) => opts.assets?.[frame === undefined ? id : `${id}:${frame}`] ?? null,
    strings: () => table(locale),
  };

  const setLocale = (to: string) => {
    const from = locale;
    locale = to;
    for (const fn of handlers.get("locale:change") ?? []) fn({ from, to });
  };

  const emit = (event: string, payload: unknown) => {
    for (const fn of handlers.get(event) ?? []) fn(payload);
  };

  return { ctx, layer, setDialogue, act, send, sent, setLocale, emit };
}

const box = () => document.querySelector<HTMLElement>("[data-jams-dialogue]")!;
const buttons = () => [
  ...document.querySelectorAll<HTMLButtonElement>("[data-jams-dialogue-choices] button"),
];
const live = () => document.querySelector<HTMLElement>("[aria-live]")!;
const lineEl = () => document.querySelector<HTMLElement>("[data-jams-dialogue-line]")!;
/** The typed line's characters still hidden. */
const hiddenText = () =>
  [...lineEl().querySelectorAll<HTMLElement>("span")]
    .filter((s) => s.style.visibility === "hidden")
    .map((s) => s.textContent)
    .join("");

/** The pointer-events a click meets at `el`: its own value, else the nearest ancestor's. */
function pointerEventsAt(el: Element): string {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const own = getComputedStyle(at).pointerEvents;
    if (own !== "" && own !== "inherit") return own;
  }
  return "auto";
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("createDialogueBox", () => {
  it("renders the line in a live region and the choices as buttons", () => {
    const h = harness({ reducedMotion: true });
    const ui = createDialogueBox(h.ctx);
    expect(box().hidden).toBe(true);

    h.setDialogue(view({ choices: CHOICES }));
    expect(box().hidden).toBe(false);
    expect(box().getAttribute("role")).toBe("dialog");
    expect(box().getAttribute("aria-label")).toBe("Guide");
    expect(live().getAttribute("aria-live")).toBe("polite");
    expect(live().textContent).toBe("Guide: Hello, Ada!");
    expect(lineEl().textContent).toBe("Hello, Ada!");
    expect(document.querySelector("[data-jams-dialogue-speaker]")!.textContent).toBe("Guide");

    const bs = buttons();
    expect(bs.map((b) => b.textContent)).toEqual(["Stay a while", "Leave", "Locked", "Wave"]);
    expect(bs.every((b) => b.tagName === "BUTTON" && b.type === "button")).toBe(true);
    expect(bs.map((b) => b.disabled)).toEqual([false, false, true, false]);
    // `say` is literal markup: the bold span renders, not the tags.
    expect(bs[3]!.querySelector("span")!.style.fontWeight).toBe("bold");
    ui.destroy();
    expect(box()).toBeNull();
  });

  it("shows `say` lines literally and a missing key bracketed", () => {
    const h = harness({ reducedMotion: true });
    const ui = createDialogueBox(h.ctx);
    h.setDialogue(view({ current: { say: "[i]psst[/i]" } }));
    expect(lineEl().textContent).toBe("psst");
    expect(lineEl().querySelector("span")!.style.fontStyle).toBe("italic");
    expect(document.querySelector<HTMLElement>("[data-jams-dialogue-speaker]")!.hidden).toBe(true);
    h.setDialogue(view({ line: 1, current: { text: "nope" } }));
    expect(lineEl().textContent).toBe("[nope]");
    ui.destroy();
  });

  it("moves focus with up and down past disabled choices, and confirm sends @dialogue-choose", () => {
    const h = harness({ reducedMotion: true });
    const ui = createDialogueBox(h.ctx);
    h.setDialogue(view({ choices: CHOICES }));
    h.ctx.canvas.focus();
    const bs = buttons();
    expect(bs[0]!.hasAttribute("data-selected")).toBe(true);

    h.act("down");
    expect(document.activeElement).toBe(bs[1]);
    h.act("down");
    expect(document.activeElement).toBe(bs[3]);
    h.act("down");
    expect(document.activeElement).toBe(bs[0]);
    h.act("up");
    expect(document.activeElement).toBe(bs[3]);
    h.act("up");
    expect(document.activeElement).toBe(bs[1]);
    expect(bs[1]!.hasAttribute("data-selected")).toBe(true);
    expect(h.send).not.toHaveBeenCalled();

    h.act("confirm");
    expect(h.sent).toEqual([{ name: DIALOGUE_CHOOSE_COMMAND, args: { choice: 1 }, player: 0 }]);
    // One command per view: a repeat press, or the button's own Enter, sends nothing more.
    h.act("confirm");
    bs[1]!.click();
    expect(h.send).toHaveBeenCalledTimes(1);

    // The next line drops the choices and gives focus back.
    h.setDialogue(view({ node: "stay", line: 0, log: [...view().log, view().log[0]!] }));
    expect(buttons()).toHaveLength(0);
    expect(document.activeElement).toBe(h.ctx.canvas);
    ui.destroy();
  });

  it("chooses on a click, by the choice's own index, and the arrows move focus once it's inside", () => {
    const h = harness({ reducedMotion: true });
    const ui = createDialogueBox(h.ctx);
    h.setDialogue(view({ choices: CHOICES }));
    const bs = buttons();
    bs[0]!.focus();
    bs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(bs[1]);
    bs[3]!.click();
    expect(h.sent).toEqual([{ name: DIALOGUE_CHOOSE_COMMAND, args: { choice: 4 } }]);
    // A disabled choice can't be clicked into a command.
    h.setDialogue(view({ choices: CHOICES, line: 1 }));
    buttons()[2]!.click();
    expect(h.send).toHaveBeenCalledTimes(1);
    ui.destroy();
  });

  it("types the line out and completes it on the first advance, before advancing", async () => {
    const h = harness();
    const ui = createDialogueBox(h.ctx);
    const long = "x".repeat(400);
    h.setDialogue(view({ current: { say: long }, choices: CHOICES }));
    expect(hiddenText()).toBe(long);
    expect(buttons()).toHaveLength(0);
    // The live region holds the whole line from the start, so a reader hears it once.
    expect(live().textContent).toBe(long);

    await vi.waitFor(() => expect(hiddenText().length).toBeLessThan(long.length), {
      timeout: 5000,
    });
    expect(hiddenText().length).toBeGreaterThan(0);
    expect(lineEl().textContent).toBe(long);

    h.act("confirm");
    expect(hiddenText()).toBe("");
    expect(buttons()).toHaveLength(4);
    expect(h.send).not.toHaveBeenCalled();
    ui.destroy();
  });

  it("sends @dialogue-advance on the advance after a whole line, and on a click of the box", () => {
    const h = harness();
    const ui = createDialogueBox(h.ctx, { speed: 40 });
    h.setDialogue(view());
    expect(hiddenText()).not.toBe("");
    box().click();
    expect(hiddenText()).toBe("");
    expect(h.send).not.toHaveBeenCalled();
    h.act("confirm");
    expect(h.sent).toEqual([{ name: DIALOGUE_ADVANCE_COMMAND, player: 0 }]);
    h.setDialogue(view({ line: 1, log: [...view().log, view().log[0]!] }));
    h.act("confirm");
    expect(h.send).toHaveBeenCalledTimes(1);
    box().click();
    box().click();
    expect(h.sent.map((c) => c.name)).toEqual([DIALOGUE_ADVANCE_COMMAND, DIALOGUE_ADVANCE_COMMAND]);
    ui.destroy();
  });

  it("shows lines whole under reduced motion and at speed Infinity", () => {
    for (const setup of [{ reducedMotion: true }, { speed: Infinity }]) {
      const h = harness({ reducedMotion: "reducedMotion" in setup });
      const ui = createDialogueBox(h.ctx, "speed" in setup ? { speed: setup.speed } : {});
      h.setDialogue(view({ choices: CHOICES }));
      expect(hiddenText()).toBe("");
      expect(buttons()).toHaveLength(4);
      ui.destroy();
      document.body.replaceChildren();
    }
  });

  it("uses custom action names", () => {
    const h = harness({ reducedMotion: true });
    const ui = createDialogueBox(h.ctx, { actions: { advance: "talk", up: "prev", down: "next" } });
    h.setDialogue(view({ choices: CHOICES }));
    h.act("confirm");
    h.act("down");
    expect(h.send).not.toHaveBeenCalled();
    h.act("next");
    h.act("talk");
    expect(h.sent).toEqual([{ name: DIALOGUE_CHOOSE_COMMAND, args: { choice: 1 }, player: 0 }]);
    ui.destroy();
  });

  it("sets dir and lang from the locale, rtl for ar, and follows a locale change", () => {
    const h = harness({ reducedMotion: true, locale: "ar" });
    const ui = createDialogueBox(h.ctx);
    h.setDialogue(view({ choices: CHOICES }));
    expect(box().dir).toBe("rtl");
    expect(box().lang).toBe("ar");
    expect(lineEl().textContent).toBe("مرحبا Ada");
    expect(buttons()[0]!.textContent).toBe("ابق قليلا");

    h.setLocale("en");
    expect(box().dir).toBe("ltr");
    expect(lineEl().textContent).toBe("Hello, Ada!");
    expect(buttons()[0]!.textContent).toBe("Stay a while");
    ui.destroy();
  });

  it("draws the portrait as a CSS background of the frame's rect, scaled to fill its slot", () => {
    const h = harness({
      reducedMotion: true,
      assets: {
        "faces:guide": { url: "blob:faces", rect: { x: 64, y: 32, w: 48, h: 40 } },
        "faces:big": { url: "blob:faces", rect: { x: 0, y: 0, w: 192, h: 128 } },
        photo: { url: "blob:photo" },
      },
    });
    const ui = createDialogueBox(h.ctx);
    const portrait = () => document.querySelector<HTMLElement>("[data-jams-dialogue-portrait]")!;
    const art = () => portrait().querySelector<HTMLElement>("[data-jams-dialogue-portrait-art]")!;
    h.setDialogue(view({ current: { say: "hi", portrait: { asset: "faces", frame: "guide" } } }));
    expect(portrait().hidden).toBe(false);
    expect(art().style.backgroundImage).toContain("blob:faces");
    expect(art().style.backgroundPosition).toBe("-64px -32px");
    expect(art().style.width).toBe("48px");
    expect(art().style.height).toBe("40px");
    // The 96px slot: the longer side fills it, and pixel art stays crisp as it grows.
    expect(art().style.transform).toBe("scale(2)");
    expect(art().style.imageRendering).toBe("pixelated");
    // A frame larger than the slot shrinks, smoothly.
    h.setDialogue(
      view({ line: 1, current: { say: "hi", portrait: { asset: "faces", frame: "big" } } }),
    );
    expect(art().style.transform).toBe("scale(0.5)");
    expect(art().style.imageRendering).toBe("");
    // A whole image fits the slot, with nothing of the last frame's size left.
    h.setDialogue(view({ line: 2, current: { say: "hi", portrait: { asset: "photo" } } }));
    expect(art().style.backgroundSize).toBe("contain");
    expect(art().style.width).toBe("");
    expect(art().style.transform).toBe("");
    // An asset the host doesn't hold shows no portrait.
    h.setDialogue(view({ line: 3, current: { say: "hi", portrait: { asset: "gone" } } }));
    expect(portrait().hidden).toBe(true);
    ui.destroy();
  });

  it("keeps the advance hint's row while a line types, so the box holds its height", async () => {
    const h = harness();
    const ui = createDialogueBox(h.ctx, { speed: 40 });
    const hint = () => document.querySelector<HTMLElement>("[data-jams-dialogue-hint]")!;
    h.setDialogue(view());
    expect(hint().hidden).toBe(false);
    expect(hint().style.visibility).toBe("hidden");
    h.act("confirm");
    expect(hint().hidden).toBe(false);
    expect(hint().style.visibility).toBe("");
    // A line with choices after it shows the choices in the hint's place.
    h.setDialogue(view({ line: 1, choices: CHOICES }));
    expect(hint().hidden).toBe(true);
    ui.destroy();
  });

  describe("with none of its actions bound, as in a project without game code", () => {
    const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      return e;
    };

    it("advances on Enter and Space, finishing a typing line first", () => {
      const h = harness({ bound: [] });
      const ui = createDialogueBox(h.ctx, { speed: 40 });
      h.setDialogue(view());
      h.ctx.canvas.focus();
      expect(hiddenText()).not.toBe("");
      expect(press(h.ctx.canvas, "Enter").defaultPrevented).toBe(true);
      expect(hiddenText()).toBe("");
      expect(h.send).not.toHaveBeenCalled();
      press(h.ctx.canvas, " ");
      expect(h.sent).toEqual([{ name: DIALOGUE_ADVANCE_COMMAND }]);
      h.setDialogue(
        view({ line: 1, current: { say: "next" }, log: [...view().log, view().log[0]!] }),
      );
      // With focus fallen to the page, the keys still reach the box; a held key doesn't repeat.
      (document.activeElement as HTMLElement | null)?.blur();
      press(document.body, "Enter", { repeat: true });
      press(document.body, "Enter");
      press(document.body, "Enter");
      expect(h.sent).toHaveLength(2);
      ui.destroy();
    });

    it("focuses the first choice when they appear, moves with the arrows and picks on Enter", () => {
      const h = harness({ bound: [], reducedMotion: true });
      const ui = createDialogueBox(h.ctx);
      h.ctx.canvas.focus();
      h.setDialogue(view({ choices: CHOICES }));
      const bs = buttons();
      expect(document.activeElement).toBe(bs[0]);
      press(document.activeElement!, "ArrowDown");
      expect(document.activeElement).toBe(bs[1]);
      press(document.activeElement!, "ArrowDown");
      expect(document.activeElement).toBe(bs[3]);
      press(document.activeElement!, "ArrowUp");
      expect(document.activeElement).toBe(bs[1]);
      // The focused button's own Enter is its click; the box adds nothing to it.
      const enter = press(document.activeElement!, "Enter");
      expect(enter.defaultPrevented).toBe(false);
      expect(h.send).not.toHaveBeenCalled();
      bs[1]!.click();
      expect(h.sent).toEqual([{ name: DIALOGUE_CHOOSE_COMMAND, args: { choice: 1 } }]);
      // The next line hands focus back to the canvas.
      h.setDialogue(view({ node: "stay", line: 0, log: [...view().log, view().log[0]!] }));
      expect(document.activeElement).toBe(h.ctx.canvas);

      // From the canvas the arrows reach the choices too, and Enter picks the selected one.
      h.setDialogue(view({ node: "again", choices: CHOICES }));
      h.ctx.canvas.focus();
      press(h.ctx.canvas, "ArrowDown");
      expect(document.activeElement).toBe(buttons()[1]);
      h.ctx.canvas.focus();
      press(h.ctx.canvas, "Enter");
      expect(h.sent.at(-1)).toEqual({ name: DIALOGUE_CHOOSE_COMMAND, args: { choice: 1 } });
      ui.destroy();
    });

    it("leaves keys alone in a field, on another control, with a modifier, or while nothing shows", () => {
      const h = harness({ bound: [] });
      const ui = createDialogueBox(h.ctx, { speed: Infinity });
      const field = document.createElement("input");
      const other = document.createElement("button");
      document.body.append(field, other);
      press(h.ctx.canvas, "Enter");
      h.setDialogue(view());
      for (const target of [field, other]) {
        target.focus();
        expect(press(target, "Enter").defaultPrevented).toBe(false);
        press(target, " ");
      }
      press(h.ctx.canvas, "Enter", { ctrlKey: true });
      expect(h.send).not.toHaveBeenCalled();
      ui.destroy();
      press(h.ctx.canvas, "Enter");
      expect(h.send).not.toHaveBeenCalled();
    });

    it("leaves a key one of the game's own actions uses to it", () => {
      const h = harness({ bound: [], keys: { jump: ["Space"], move: ["ArrowDown"] } });
      const ui = createDialogueBox(h.ctx, { speed: Infinity });
      h.setDialogue(view({ choices: CHOICES }));
      h.ctx.canvas.focus();
      expect(press(h.ctx.canvas, " ", { code: "Space" }).defaultPrevented).toBe(false);
      press(h.ctx.canvas, "ArrowDown", { code: "ArrowDown" });
      expect(document.activeElement).toBe(h.ctx.canvas);
      expect(h.send).not.toHaveBeenCalled();
      press(h.ctx.canvas, "Enter", { code: "Enter" });
      expect(h.sent).toEqual([{ name: DIALOGUE_CHOOSE_COMMAND, args: { choice: 0 } }]);
      ui.destroy();
    });

    it("stands in only for the actions the game leaves unbound", () => {
      const h = harness({ bound: ["confirm"], reducedMotion: true });
      const ui = createDialogueBox(h.ctx);
      h.setDialogue(view());
      press(h.ctx.canvas, "Enter");
      expect(h.send).not.toHaveBeenCalled();
      h.act("confirm");
      expect(h.sent).toEqual([{ name: DIALOGUE_ADVANCE_COMMAND, player: 0 }]);
      ui.destroy();
    });
  });

  it("hides when the conversation ends or stops", () => {
    const h = harness({ reducedMotion: true });
    const ui = createDialogueBox(h.ctx);
    h.setDialogue(view());
    expect(box().hidden).toBe(false);
    h.setDialogue(view({ ended: "bye" }));
    expect(box().hidden).toBe(true);
    h.act("confirm");
    h.setDialogue(null);
    expect(box().hidden).toBe(true);
    expect(h.send).not.toHaveBeenCalled();
    ui.destroy();
  });

  it("only ever sends the two dialogue commands", () => {
    const h = harness();
    const ui = createDialogueBox(h.ctx);
    const log: DialogueLogEntry[] = [];
    for (let line = 0; line < 6; line++) {
      log.push({ node: "start", line, say: `line ${line}` });
      h.setDialogue(
        view({
          line,
          current: { say: `line ${line}` },
          log: [...log],
          choices: line === 5 ? CHOICES : null,
        }),
      );
      for (const action of ["confirm", "up", "down", "confirm", "confirm"]) h.act(action);
      box().click();
      buttons()[0]?.click();
    }
    expect(h.send.mock.calls.length).toBeGreaterThan(0);
    for (const [command] of h.send.mock.calls)
      expect([DIALOGUE_ADVANCE_COMMAND, DIALOGUE_CHOOSE_COMMAND]).toContain(command.name);
    ui.destroy();
  });

  it("takes pointer events in the pointer-events:none UI layer", () => {
    const h = harness({ reducedMotion: true });
    const ui = createDialogueBox(h.ctx);
    h.setDialogue(view({ choices: CHOICES }));
    expect(pointerEventsAt(h.layer.root)).toBe("none");
    expect(pointerEventsAt(box())).toBe("auto");
    for (const b of buttons()) expect(pointerEventsAt(b)).toBe("auto");
    ui.destroy();
  });
});

describe("captions with the dialogue box", () => {
  it("sit above the shown box and fill a voiced line's values", () => {
    const h = harness({ reducedMotion: true });
    Object.assign(h.ctx.game, { captions: { enabled: () => true, set() {} } });
    const ui = createDialogueBox(h.ctx);
    const captions = createCaptions(h.ctx);
    const region = document.querySelector<HTMLElement>("[data-jams-captions]")!;
    const css = [...document.querySelectorAll("style")].map((st) => st.textContent).join("\n");
    const rule = css.slice(css.indexOf(":where([data-jams-captions]) {"));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(
      new RegExp(`bottom: [^;]*var\\(${DIALOGUE_INSET}, 0px\\)`),
    );
    expect(h.layer.root.style.getPropertyValue(DIALOGUE_INSET)).toBe("");

    h.setDialogue(view());
    expect(h.layer.root.style.getPropertyValue(DIALOGUE_INSET)).toMatch(/^\d+px$/);
    h.emit("audio:caption", { key: "guide.hello", at: 0 });
    expect(region.textContent).toBe("Hello, Ada!");

    h.setDialogue(null);
    expect(h.layer.root.style.getPropertyValue(DIALOGUE_INSET)).toBe("");
    captions.destroy();
    ui.destroy();
  });
});

describe("createTextLog", () => {
  const entries: DialogueLogEntry[] = [
    { node: "start", line: 0, speaker: "guide.name", text: "guide.hello", vars: { who: "Ada" } },
    { node: "start", line: 1, say: "[b]Second[/b]" },
    { node: "next", line: 0, say: "Third" },
  ];
  const items = () => [...document.querySelectorAll<HTMLElement>("[data-jams-text-log] li")];
  const logRoot = () => document.querySelector<HTMLElement>("[data-jams-text-log]")!;

  it("lists the lines shown so far, with speakers, and keeps up as lines arrive", () => {
    const h = harness();
    const ui = createTextLog(h.ctx);
    expect(logRoot().hidden).toBe(true);
    h.setDialogue(view({ log: entries.slice(0, 2) }));
    expect(items().map((li) => li.textContent)).toEqual(["GuideHello, Ada!", "Second"]);
    expect(items()[1]!.querySelector<HTMLElement>("span span")!.style.fontWeight).toBe("bold");
    h.setDialogue(view({ log: entries }));
    expect(items()).toHaveLength(3);
    expect(pointerEventsAt(logRoot())).toBe("auto");
    h.setDialogue(null);
    expect(items()).toHaveLength(0);
    ui.destroy();
    expect(logRoot()).toBeNull();
  });

  it("keeps the last `max` lines, follows the locale and shows on its toggle action", () => {
    const h = harness({ locale: "ar" });
    const ui = createTextLog(h.ctx, { max: 2, toggle: "log" });
    h.setDialogue(view({ log: entries }));
    expect(logRoot().hidden).toBe(true);
    h.act("log");
    expect(logRoot().hidden).toBe(false);
    expect(logRoot().dir).toBe("rtl");
    expect(items().map((li) => li.textContent)).toEqual(["Second", "Third"]);
    h.act("log", { repeat: true });
    expect(logRoot().hidden).toBe(false);
    h.act("log");
    expect(logRoot().hidden).toBe(true);
    expect(h.send).not.toHaveBeenCalled();
    ui.destroy();
  });
});

describe("renderRichText", () => {
  it("renders bold, italic, colour, size and icons as spans", () => {
    const el = document.createElement("p");
    const { lines } = parseRichText(
      "[b]bold[/b] [i]it[/i] [color=#ff8800]hot[/color] [size=24]big[/size] [icon=ui:coin] [wave]w[/wave]\nnext",
    );
    renderRichText(el, lines, {
      assetUrl: (id, frame) =>
        id === "ui" && frame === "coin"
          ? { url: "blob:ui", rect: { x: 16, y: 0, w: 12, h: 12 } }
          : null,
    });
    const spans = [...el.children].filter((c) => c.tagName === "SPAN") as HTMLElement[];
    const by = (text: string) => spans.find((s) => s.textContent === text)!;
    expect(by("bold").style.fontWeight).toBe("bold");
    expect(by("it").style.fontStyle).toBe("italic");
    expect(by("hot").style.color).toBe("rgb(255, 136, 0)");
    expect(by("big").style.fontSize).toBe("24px");
    expect(by("w").dataset.jamsEffect).toBe("wave");
    const icon = el.querySelector<HTMLElement>("[data-jams-icon]")!;
    expect(icon.dataset.jamsIcon).toBe("ui:coin");
    expect(icon.style.backgroundImage).toContain("blob:ui");
    expect(icon.style.backgroundPosition).toBe("-16px 0px");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelectorAll("br")).toHaveLength(1);
    expect(el.textContent).toBe("bold it hot big  wnext");
  });

  it("replaces what was there", () => {
    const el = document.createElement("p");
    el.textContent = "old";
    renderRichText(el, parseRichText("new").lines, { assetUrl: () => null });
    expect(el.textContent).toBe("new");
  });
});

describe("the locale's font", () => {
  /** A project whose default locale draws in a web font and whose ar in a BMFont. */
  const project = {
    engine: { locales: { default: "en", available: ["en", "ar"], fonts: { en: "ui", ar: "pix" } } },
    asset: (id: string) =>
      id === "ui"
        ? { kind: "font", sha256: "f00d", font: { format: "woff2" } }
        : id === "pix"
          ? { kind: "font", sha256: "beef", font: { format: "bmfont" }, pages: [] }
          : undefined,
  } as unknown as ProjectRuntimeView;

  const added: { family: string; source: string }[] = [];
  class FakeFace {
    constructor(
      readonly family: string,
      readonly source: string,
    ) {}
    load = () => Promise.resolve(this);
  }
  const fonts = {
    add: (face: FakeFace) => void added.push(face),
    [Symbol.iterator]: () => added[Symbol.iterator](),
  };

  afterEach(() => {
    added.length = 0;
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "fonts");
  });

  it("draws the box, log and captions in the locale's web font, added once, else the system face", () => {
    vi.stubGlobal("FontFace", FakeFace);
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    const h = harness({
      reducedMotion: true,
      project,
      assets: { ui: { url: "blob:ui-font" } },
    });
    Object.assign(h.ctx.game, { captions: { enabled: () => true, set() {} } });
    const ui = [createDialogueBox(h.ctx), createTextLog(h.ctx), createCaptions(h.ctx)];
    h.setDialogue(view());
    const family = '"jams-font-f00d", system-ui, sans-serif';
    const log = document.querySelector<HTMLElement>("[data-jams-text-log]")!;
    const region = document.querySelector<HTMLElement>("[data-jams-captions]")!;
    for (const el of [box(), log, region]) expect(el.style.getPropertyValue(UI_FONT)).toBe(family);
    expect(added.map((f) => [f.family, f.source])).toEqual([
      ["jams-font-f00d", 'url("blob:ui-font")'],
    ]);
    const sheets = [...document.querySelectorAll("style")].map((st) => st.textContent);
    for (const selector of ["data-jams-dialogue", "data-jams-captions"])
      expect(sheets.find((css) => css.includes(`:where([${selector}]) {`))).toContain(
        "font-family: var(--jams-ui-font, system-ui, sans-serif)",
      );

    h.setLocale("ar");
    for (const el of [box(), log, region]) expect(el.style.getPropertyValue(UI_FONT)).toBe("");
    for (const part of ui) part.destroy();
  });

  it("keeps the system face where the host serves no font", () => {
    const h = harness({ reducedMotion: true, project });
    const ui = createDialogueBox(h.ctx);
    h.setDialogue(view());
    expect(box().style.getPropertyValue(UI_FONT)).toBe("");
    ui.destroy();
  });
});

describe("an unthemed game", () => {
  /** The declarations of the first rule for `selector` across the document's style elements. */
  const ruleOf = (selector: string): string => {
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    const at = css.indexOf(`:where([${selector}]) {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };

  it("draws the box, the log and each caption in one palette and corner, overridable by a game's CSS", () => {
    const h = harness({ reducedMotion: true });
    Object.assign(h.ctx.game, { captions: { enabled: () => true, set() {} } });
    const ui = [createDialogueBox(h.ctx), createTextLog(h.ctx), createCaptions(h.ctx)];
    h.setDialogue(view());
    h.emit("audio:caption", { key: "guide.hello", at: 0 });

    for (const selector of ["data-jams-dialogue", "data-jams-text-log", "data-jams-caption"]) {
      const rule = ruleOf(selector);
      expect(rule, selector).toContain(`background: ${UI_THEME.bg};`);
      expect(rule, selector).toContain(`color: ${UI_THEME.fg};`);
      expect(rule, selector).toContain(`border-radius: ${UI_THEME.radius};`);
    }
    const caption = document.querySelector<HTMLElement>("[data-jams-caption]")!;
    expect([caption.style.color, caption.style.background, caption.style.borderRadius]).toEqual([
      "",
      "",
      "",
    ]);
    for (const part of ui) part.destroy();
    expect(document.querySelectorAll("style")).toHaveLength(0);
  });
});

describe("a long choice list", () => {
  it("caps the box to the layer and scrolls it, never the page, to the focused choice", () => {
    const h = harness({ reducedMotion: true });
    const ui = createDialogueBox(h.ctx);
    h.setDialogue(view({ choices: CHOICES }));
    const css = box().querySelector("style")!.textContent!;
    expect(css).toMatch(/max-height: calc\(100% - [^;]+ - 32px\);\s*overflow-y: auto;/);

    const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
    let scrolled = 0;
    Object.defineProperty(box(), "scrollTop", {
      get: () => scrolled,
      set: (v: number) => void (scrolled = v),
      configurable: true,
    });
    box().getBoundingClientRect = () => rect(0, 100);
    buttons()[1]!.getBoundingClientRect = () => rect(120, 150);
    h.act("down");
    expect(scrolled).toBe(50);
    ui.destroy();
  });
});
