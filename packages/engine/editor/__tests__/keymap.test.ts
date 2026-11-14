import { describe, expect, it } from "vite-plus/test";

import type { GameKeyBinding } from "../../game/types";
import {
  createKeymap,
  ENGINE_KEYS,
  keyChord,
  normalizeChord,
  type EditorKeyEvent,
  type KeyContext,
} from "../keymap";

const key = (k: string, mods: Partial<Omit<EditorKeyEvent, "key">> = {}): EditorKeyEvent => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

const edit: KeyContext = { mode: "edit", editableTarget: false };
const play: KeyContext = { mode: "play", editableTarget: false };
const typing: KeyContext = { mode: "edit", editableTarget: true };
const points: KeyContext = { mode: "edit", editableTarget: false, subObject: true };

const keymap = createKeymap();
const command = (e: EditorKeyEvent, ctx: KeyContext) => keymap.resolve(e, ctx)?.command ?? null;

describe("chords", () => {
  it("writes a key press as Shift+Alt+Mod+key, with Ctrl or Cmd as Mod", () => {
    expect(keyChord(key("Z", { metaKey: true, shiftKey: true }))).toBe("Shift+Mod+z");
    expect(keyChord(key("z", { ctrlKey: true }))).toBe("Mod+z");
    expect(keyChord(key("ArrowUp", { altKey: true }))).toBe("Alt+ArrowUp");
    expect(keyChord(key(" "))).toBe("Space");
  });

  it("normalizes modifier order and Space, and rejects what isn't a chord", () => {
    expect(normalizeChord("mod+shift+G")).toBe("Shift+Mod+g");
    expect(normalizeChord(" ")).toBe("Space");
    expect(normalizeChord("Mod++")).toBe("Mod++");
    expect(() => normalizeChord("Hyper+x")).toThrow(/unknown modifier "Hyper"/);
    expect(() => normalizeChord("Shift+")).toThrow(/names no key/);
  });

  it("writes every engine binding in canonical form", () => {
    for (const b of ENGINE_KEYS) expect(normalizeChord(b.key)).toBe(b.key);
  });
});

describe("edit scope", () => {
  it("maps the editing shortcuts", () => {
    expect(command(key("z", { ctrlKey: true }), edit)).toBe("undo");
    expect(command(key("z", { metaKey: true }), edit)).toBe("undo");
    expect(command(key("Z", { metaKey: true, shiftKey: true }), edit)).toBe("redo");
    expect(command(key("y", { ctrlKey: true }), edit)).toBe("redo");
    expect(command(key("Delete"), edit)).toBe("delete");
    expect(command(key("Backspace"), edit)).toBe("delete");
    expect(command(key("d", { metaKey: true }), edit)).toBe("duplicate");
    expect(command(key("g", { ctrlKey: true, shiftKey: true }), edit)).toBe("ungroup");
    expect(command(key("b"), edit)).toBe("tool:box");
    expect(command(key("e"), edit)).toBe("rotate-cw");
  });

  it("brings forward on Mod+] and sends backward on Mod+[, leaving bare brackets to the hierarchy", () => {
    expect(command(key("]", { ctrlKey: true }), edit)).toBe("bring-forward");
    expect(command(key("[", { metaKey: true }), edit)).toBe("send-backward");
    expect(command(key("]"), edit)).toBe("hierarchy-down");
    expect(command(key("["), edit)).toBe("hierarchy-up");
    expect(command(key("]", { ctrlKey: true }), play)).toBeNull();
    expect(keymap.chordOf("bring-forward")).toBe("Mod+]");
    expect(keymap.chordOf("send-backward")).toBe("Mod+[");
  });

  it("rotates everything by the snap angle on q and e, and flips on Shift+H and Shift+V", () => {
    expect(command(key("e"), edit)).toBe("rotate-cw");
    expect(command(key("q"), edit)).toBe("rotate-ccw");
    expect(keymap.bindings.find((b) => b.key === "e")?.description).toBe(
      "Rotate clockwise by the snap angle (15° without one)",
    );
    expect(keymap.bindings.find((b) => b.key === "q")?.description).toBe(
      "Rotate counterclockwise by the snap angle (15° without one)",
    );
    expect(command(key("H", { shiftKey: true }), edit)).toBe("flip-x");
    expect(command(key("V", { shiftKey: true }), edit)).toBe("flip-y");
    expect(command(key("h"), edit)).toBe("tool:pan");
    expect(command(key("v"), edit)).toBe("tool:select");
    expect(command(key("H", { shiftKey: true }), play)).toBeNull();
    // The quarter turns stay commands for the inspector's buttons, with no key of their own.
    expect(ENGINE_KEYS.some((b) => b.command === "turn-cw" || b.command === "turn-ccw")).toBe(
      false,
    );
    expect(keymap.chordOf("turn-cw")).toBeUndefined();
    expect(keymap.chordOf("rotate-cw")).toBe("e");
    expect(keymap.chordOf("rotate-ccw")).toBe("q");
    expect(keymap.chordOf("flip-x")).toBe("Shift+h");
  });

  it("nudges by a grid step, four with Shift, a pixel with Alt", () => {
    expect(command(key("ArrowLeft"), edit)).toBe("nudge-left");
    expect(command(key("ArrowLeft", { shiftKey: true }), edit)).toBe("nudge-left-coarse");
    expect(command(key("ArrowLeft", { altKey: true }), edit)).toBe("nudge-left-fine");
  });

  it("plays with Mod+Enter and from the cursor with Shift+Mod+Enter, leaving Mod+P to the browser", () => {
    expect(command(key("Enter", { ctrlKey: true }), edit)).toBe("play");
    expect(command(key("Enter", { metaKey: true, shiftKey: true }), edit)).toBe("play-here");
    expect(command(key("p", { ctrlKey: true }), edit)).toBeNull();
    expect(command(key("Enter"), edit)).toBeNull();
  });

  it("cascades Escape: gesture, then sub-object, then tool, then selection", () => {
    const esc = key("Escape");
    expect(command(esc, { ...points, gesture: true, tool: "box" })).toBe("cancel-gesture");
    expect(command(esc, { ...edit, gesture: true, tool: "box" })).toBe("cancel-gesture");
    expect(command(esc, { ...points, tool: "box" })).toBe("leave-sub-object");
    expect(command(esc, { ...edit, tool: "box" })).toBe("clear-tool");
    expect(command(esc, { ...edit, tool: "select" })).toBe("clear-selection");
    expect(command(esc, edit)).toBe("clear-selection");
  });

  it("leaves a prefab on Escape once the gesture, tool and selection are cleared", () => {
    const esc = key("Escape");
    const prefab: KeyContext = { ...edit, inPrefab: true, tool: "select" };
    expect(command(esc, { ...prefab, gesture: true, hasSelection: true })).toBe("cancel-gesture");
    expect(command(esc, { ...prefab, subObject: true, hasSelection: true })).toBe(
      "leave-sub-object",
    );
    expect(command(esc, { ...prefab, tool: "box" })).toBe("clear-tool");
    expect(command(esc, { ...prefab, hasSelection: true })).toBe("clear-selection");
    expect(command(esc, { ...prefab, hasSelection: false })).toBe("leave-prefab");
    expect(command(esc, { ...edit, inPrefab: true })).toBe("leave-prefab");
    // Outside a prefab the cascade ends at clearing the selection.
    expect(command(esc, { ...edit, tool: "select", hasSelection: false })).toBe("clear-selection");
    expect(command(esc, { ...edit, inPrefab: false })).toBe("clear-selection");
    expect(command(esc, { ...play, inPrefab: true })).toBe("stop");
  });

  it("binds leave-prefab before clear-selection", () => {
    const at = (c: string) => ENGINE_KEYS.findIndex((b) => b.scope === "edit" && b.command === c);
    expect(at("leave-prefab")).toBeGreaterThan(-1);
    expect(at("leave-prefab")).toBeLessThan(at("clear-selection"));
  });

  it("ignores unbound chords and Alt or Shift on a plain shortcut", () => {
    expect(command(key("z"), edit)).toBeNull();
    expect(command(key("z", { ctrlKey: true, altKey: true }), edit)).toBeNull();
    expect(command(key("Delete", { shiftKey: true }), edit)).toBeNull();
  });
});

describe("sub-object scope", () => {
  it("takes Delete for points and falls back to edit for the rest", () => {
    expect(command(key("Delete"), points)).toBe("delete-points");
    expect(command(key("z", { ctrlKey: true }), points)).toBe("undo");
  });
});

describe("play scope", () => {
  it("pauses, steps, changes time scale and stops", () => {
    expect(command(key("p"), play)).toBe("pause");
    expect(command(key("."), play)).toBe("step");
    expect(command(key("["), play)).toBe("slower");
    expect(command(key("]"), play)).toBe("faster");
    expect(command(key("Escape"), play)).toBe("stop");
  });

  it("gives P and [ ] other meanings than in edit", () => {
    expect(command(key("p"), edit)).toBe("tool:pen");
    expect(command(key("["), edit)).toBe("hierarchy-up");
    expect(command(key("]"), edit)).toBe("hierarchy-down");
  });

  it("leaves editing shortcuts and play keys alone", () => {
    expect(command(key("z", { ctrlKey: true }), play)).toBeNull();
    expect(command(key("Delete"), play)).toBeNull();
    expect(command(key("Enter", { ctrlKey: true }), play)).toBeNull();
    expect(command(key("d"), play)).toBeNull();
  });
});

describe("global scope", () => {
  it("cycles the debug overlay and catches save in both modes", () => {
    for (const ctx of [edit, play, points]) {
      expect(command(key("F3"), ctx)).toBe("debug");
      expect(command(key("s", { metaKey: true }), ctx)).toBe("save");
    }
  });
});

describe("text-field scope", () => {
  it("lets every key through as typing but Mod+S", () => {
    expect(command(key("s", { ctrlKey: true }), typing)).toBe("save");
    expect(command(key("z", { ctrlKey: true }), typing)).toBeNull();
    expect(command(key("Backspace"), typing)).toBeNull();
    expect(command(key("Escape"), typing)).toBeNull();
    expect(command(key("F3"), typing)).toBeNull();
    expect(command(key("p"), { ...typing, mode: "play" })).toBeNull();
  });

  it("keeps game bindings out too", () => {
    const map = createKeymap([{ key: "1", scope: "edit", command: "g:one", description: "" }]);
    expect(map.resolve(key("1"), edit)?.command).toBe("g:one");
    expect(map.resolve(key("1"), typing)).toBeNull();
  });
});

describe("game bindings", () => {
  const bindings: GameKeyBinding[] = [
    { key: "1", scope: "edit", command: "palette:1", description: "First construct" },
    { key: "Tab", scope: "play", command: "shaper", description: "Toggle the Shaper" },
    { key: "p", scope: "play", command: "game:p", description: "Collides with pause" },
    { key: "mod+Z", scope: "edit", command: "game:undo", description: "Collides with undo" },
    { key: "F3", scope: "play", command: "game:f3", description: "Collides with a global" },
    { key: "p", scope: "edit", command: "game:pen", description: "Collides with the pen tool" },
  ];
  const map = createKeymap(bindings);

  it("resolve in their own scope only", () => {
    expect(map.resolve(key("1"), edit)).toMatchObject({ source: "game", command: "palette:1" });
    expect(map.resolve(key("1"), play)).toBeNull();
    expect(map.resolve(key("Tab"), play)).toMatchObject({ source: "game", command: "shaper" });
    expect(map.resolve(key("Tab"), edit)).toBeNull();
  });

  it("can't shadow an engine binding in the same scope or a global one", () => {
    expect(map.shadowed.map((b) => b.command)).toEqual([
      "game:p",
      "game:undo",
      "game:f3",
      "game:pen",
    ]);
    expect(map.resolve(key("p"), play)).toMatchObject({ source: "engine", command: "pause" });
    expect(map.resolve(key("z", { ctrlKey: true }), edit)).toMatchObject({ command: "undo" });
    expect(map.resolve(key("F3"), play)).toMatchObject({ command: "debug" });
    expect(map.bindings.filter((b) => "command" in b && b.command.startsWith("game:"))).toEqual([]);
  });

  it("shadows a game binding on the z-order chords in edit, not in play", () => {
    const z = createKeymap([
      { key: "Mod+]", scope: "edit", command: "game:raise", description: "Collides with forward" },
      { key: "mod+[", scope: "edit", command: "game:lower", description: "Collides with backward" },
      { key: "Mod+]", scope: "play", command: "game:zoom", description: "Play is free" },
    ]);
    expect(z.shadowed.map((b) => b.command)).toEqual(["game:raise", "game:lower"]);
    expect(z.resolve(key("]", { ctrlKey: true }), edit)).toMatchObject({
      source: "engine",
      command: "bring-forward",
    });
    expect(z.resolve(key("]", { ctrlKey: true }), play)).toMatchObject({
      source: "game",
      command: "game:zoom",
    });
  });

  it("shadows a game binding on the rotate and flip chords in edit", () => {
    const t = createKeymap([
      { key: "e", scope: "edit", command: "game:e", description: "Collides with rotate" },
      { key: "q", scope: "edit", command: "game:q", description: "Collides with rotate" },
      { key: "shift+H", scope: "edit", command: "game:flip", description: "Collides with flip" },
      { key: "Shift+v", scope: "edit", command: "game:v", description: "Collides with flip" },
      { key: "Shift+h", scope: "play", command: "game:hop", description: "Play is free" },
    ]);
    expect(t.shadowed.map((b) => b.command)).toEqual(["game:e", "game:q", "game:flip", "game:v"]);
    for (const k of ["e", "q"]) expect(t.resolve(key(k), edit)?.source).toBe("engine");
    expect(t.resolve(key("H", { shiftKey: true }), play)).toMatchObject({
      source: "game",
      command: "game:hop",
    });
  });

  it("names a chord for an engine command's hint", () => {
    expect(map.chordOf("play")).toBe("Mod+Enter");
    expect(map.chordOf("save")).toBe("Mod+s");
  });
});
