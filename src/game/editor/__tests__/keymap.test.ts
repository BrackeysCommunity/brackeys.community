import { describe, expect, it } from "vite-plus/test";

import { resolveEditorKey, type EditorKeyEvent } from "../keymap";

const key = (k: string, mods: Partial<Omit<EditorKeyEvent, "key">> = {}): EditorKeyEvent => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

const edit = { mode: "edit" as const, editableTarget: false };
const play = { mode: "play" as const, editableTarget: false };

describe("resolveEditorKey", () => {
  it("maps edit-mode shortcuts with Ctrl or Cmd as Mod", () => {
    expect(resolveEditorKey(key("z", { ctrlKey: true }), edit)).toBe("undo");
    expect(resolveEditorKey(key("z", { metaKey: true }), edit)).toBe("undo");
    expect(resolveEditorKey(key("Z", { metaKey: true, shiftKey: true }), edit)).toBe("redo");
    expect(resolveEditorKey(key("y", { ctrlKey: true }), edit)).toBe("redo");
    expect(resolveEditorKey(key("Delete"), edit)).toBe("delete");
    expect(resolveEditorKey(key("Backspace"), edit)).toBe("delete");
    expect(resolveEditorKey(key("Escape"), edit)).toBe("escape");
    expect(resolveEditorKey(key("Enter", { ctrlKey: true }), edit)).toBe("play");
    expect(resolveEditorKey(key("s", { metaKey: true }), edit)).toBe("save");
  });

  it("leaves Mod+P to the browser and reserves Shift+Mod+Enter", () => {
    expect(resolveEditorKey(key("p", { ctrlKey: true }), edit)).toBeNull();
    expect(resolveEditorKey(key("Enter", { ctrlKey: true, shiftKey: true }), edit)).toBeNull();
  });

  it("ignores plain letters, Alt combos and Enter alone", () => {
    expect(resolveEditorKey(key("z"), edit)).toBeNull();
    expect(resolveEditorKey(key("z", { ctrlKey: true, altKey: true }), edit)).toBeNull();
    expect(resolveEditorKey(key("Enter"), edit)).toBeNull();
  });

  it("only stops in play mode", () => {
    expect(resolveEditorKey(key("Escape"), play)).toBe("stop");
    expect(resolveEditorKey(key("z", { ctrlKey: true }), play)).toBeNull();
    expect(resolveEditorKey(key("Delete"), play)).toBeNull();
    expect(resolveEditorKey(key("Enter", { ctrlKey: true }), play)).toBeNull();
  });

  it("lets a focused text field keep every key but save", () => {
    const typing = { mode: "edit" as const, editableTarget: true };
    expect(resolveEditorKey(key("z", { ctrlKey: true }), typing)).toBeNull();
    expect(resolveEditorKey(key("Backspace"), typing)).toBeNull();
    expect(resolveEditorKey(key("Escape"), typing)).toBeNull();
    expect(resolveEditorKey(key("s", { ctrlKey: true }), typing)).toBe("save");
  });
});
