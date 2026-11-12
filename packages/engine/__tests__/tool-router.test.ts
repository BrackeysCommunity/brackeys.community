// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createToolRouter,
  isEditableTarget,
  resolveInputTarget,
  TOOL_PRIORITY,
  type ToolConsumer,
  type ToolEvent,
} from "../tool-router";

function consumer(
  id: string,
  priority: number,
  accepts: (e: ToolEvent) => boolean = () => true,
): ToolConsumer & { seen: ToolEvent[] } {
  const seen: ToolEvent[] = [];
  return { id, priority, accepts, handle: (e) => void seen.push(e), seen };
}

function keyEvent(key: string, type: "down" | "up" = "down"): ToolEvent {
  const native = new KeyboardEvent(`key${type}`, { key });
  return { kind: "key", type, key, code: native.code, native };
}

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function mountCanvas(rect = new DOMRect(0, 0, 800, 600)): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  hosts.push(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect);
  return canvas;
}

describe("dispatch", () => {
  it("delivers each event to exactly one consumer, highest priority first", () => {
    const router = createToolRouter();
    const play = consumer("play", TOOL_PRIORITY.play);
    const game = consumer("game", TOOL_PRIORITY.game);
    const editor = consumer("editor", TOOL_PRIORITY.editor);
    router.register(play);
    router.register(editor);
    router.register(game);

    expect(router.dispatch(keyEvent("a"))).toBe("editor");
    expect([play.seen.length, game.seen.length, editor.seen.length]).toEqual([0, 0, 1]);
  });

  it("falls through when a higher consumer doesn't accept", () => {
    const router = createToolRouter();
    const play = consumer("play", TOOL_PRIORITY.play);
    const tool = consumer("tool", TOOL_PRIORITY.game, (e) => e.kind === "key" && e.key === "Tab");
    router.register(play);
    router.register(tool);

    expect(router.dispatch(keyEvent("Tab"))).toBe("tool");
    expect(router.dispatch(keyEvent("d"))).toBe("play");
    expect(tool.seen.map((e) => e.kind === "key" && e.key)).toEqual(["Tab"]);
    expect(play.seen.map((e) => e.kind === "key" && e.key)).toEqual(["d"]);
  });

  it("returns null when nobody accepts", () => {
    const router = createToolRouter();
    router.register(consumer("picky", 0, () => false));
    expect(router.dispatch(keyEvent("a"))).toBeNull();
  });

  it("keeps registration order between equal priorities", () => {
    const router = createToolRouter();
    router.register(consumer("first", 100));
    router.register(consumer("second", 100));
    expect(router.dispatch(keyEvent("a"))).toBe("first");
  });

  it("unregister removes the consumer, and is idempotent", () => {
    const router = createToolRouter();
    const play = consumer("play", TOOL_PRIORITY.play);
    const tool = consumer("tool", TOOL_PRIORITY.game);
    router.register(play);
    const unregister = router.register(tool);

    expect(router.dispatch(keyEvent("a"))).toBe("tool");
    unregister();
    unregister();
    expect(router.dispatch(keyEvent("a"))).toBe("play");
    expect(tool.seen).toHaveLength(1);
  });

  it("rejects a duplicate id", () => {
    const router = createToolRouter();
    router.register(consumer("play", 0));
    expect(() => router.register(consumer("play", 100))).toThrow(/already registered/);
  });

  it("a consumer may unregister itself while handling", () => {
    const router = createToolRouter();
    const unregister = router.register({
      id: "once",
      priority: 100,
      accepts: () => true,
      handle: () => unregister(),
    });
    router.register(consumer("play", 0));
    expect(router.dispatch(keyEvent("a"))).toBe("once");
    expect(router.dispatch(keyEvent("a"))).toBe("play");
  });
});

describe("attach", () => {
  it("maps a click on a canvas offset from the page origin to canvas-local coordinates", () => {
    const canvas = mountCanvas(new DOMRect(120, 80, 640, 360));
    const router = createToolRouter();
    const tool = consumer("tool", TOOL_PRIORITY.game);
    router.register(tool);
    router.attach(canvas);

    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: 130, clientY: 100, button: 2 }),
    );

    expect(tool.seen).toEqual([
      expect.objectContaining({
        kind: "pointer",
        type: "down",
        screen: { x: 10, y: 20 },
        button: 2,
        deltaY: 0,
      }),
    ]);
    router.destroy();
  });

  it("routes moves, releases and the wheel with its deltaY", () => {
    const canvas = mountCanvas();
    const router = createToolRouter();
    const tool = consumer("tool", 0);
    router.register(tool);
    router.attach(canvas);

    canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 5, clientY: 6 }));
    canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: 5, clientY: 6 }));
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, clientX: 5, clientY: 6 }));

    expect(tool.seen.map((e) => e.kind === "pointer" && [e.type, e.deltaY])).toEqual([
      ["move", 0],
      ["up", 0],
      ["wheel", -120],
    ]);
    router.destroy();
  });

  it("carries the pointer's kind and id; a cancel ends like a release, a leave is a move", () => {
    const canvas = mountCanvas();
    const router = createToolRouter();
    const tool = consumer("tool", 0);
    router.register(tool);
    router.attach(canvas);

    const pointer = (type: string, pointerType?: string) => {
      const e = new MouseEvent(type, { clientX: 5, clientY: 6, button: 0 });
      if (pointerType) {
        Object.defineProperties(e, {
          pointerType: { value: pointerType },
          pointerId: { value: 9 },
        });
      }
      canvas.dispatchEvent(e);
    };
    pointer("pointerdown", "touch");
    pointer("pointercancel", "touch");
    pointer("pointerdown", "pen");
    pointer("pointerleave", "pen");
    pointer("pointerdown");

    expect(
      tool.seen.map((e) => e.kind === "pointer" && [e.type, e.pointerType, e.pointerId, !!e.left]),
    ).toEqual([
      ["down", "touch", 9, false],
      ["up", "touch", 9, false],
      ["down", "pen", 9, false],
      ["move", "pen", 9, true],
      ["down", "mouse", undefined, false],
    ]);
    router.destroy();
  });

  it("routes key events, and drops a keydown typed into a field", () => {
    const host = document.createElement("div");
    const field = document.createElement("input");
    host.appendChild(field);
    document.body.appendChild(host);
    hosts.push(host);
    const router = createToolRouter();
    const tool = consumer("tool", 0);
    router.register(tool);
    router.attach(host);

    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keyup", { key: "d", bubbles: true }));

    expect(tool.seen.map((e) => e.kind === "key" && `${e.type}:${e.key}`)).toEqual([
      "down:Tab",
      "up:d",
    ]);
    router.destroy();
  });

  it("carries both the layout key and the physical code", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    const router = createToolRouter();
    const tool = consumer("tool", 0);
    router.register(tool);
    router.attach(host);

    // An AZERTY layout's z sits where QWERTY has w.
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyW", bubbles: true }));
    host.dispatchEvent(new KeyboardEvent("keyup", { key: "z", code: "KeyW", bubbles: true }));

    expect(tool.seen.map((e) => e.kind === "key" && [e.type, e.key, e.code])).toEqual([
      ["down", "z", "KeyW"],
      ["up", "z", "KeyW"],
    ]);
    router.destroy();
  });

  it("detach stops routing DOM events; dispatch still works", () => {
    const canvas = mountCanvas();
    const router = createToolRouter();
    const tool = consumer("tool", 0);
    router.register(tool);
    router.attach(canvas);
    router.detach();

    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(tool.seen).toHaveLength(0);
    expect(router.dispatch(keyEvent("a"))).toBe("tool");
  });

  it("attaching again moves the listeners to the new target", () => {
    const first = mountCanvas();
    const second = mountCanvas();
    const router = createToolRouter();
    const tool = consumer("tool", 0);
    router.register(tool);
    router.attach(first);
    router.attach(second);

    first.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    second.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    expect(tool.seen.map((e) => e.kind === "key" && e.key)).toEqual(["b"]);
    router.destroy();
  });
});

describe("resolveInputTarget", () => {
  it("defaults to the canvas and makes it focusable", () => {
    const canvas = document.createElement("canvas");
    expect(resolveInputTarget(canvas)).toBe(canvas);
    expect(canvas.tabIndex).toBe(0);
  });

  it("keeps a tabindex the host already set", () => {
    const canvas = document.createElement("canvas");
    canvas.tabIndex = -1;
    resolveInputTarget(canvas);
    expect(canvas.tabIndex).toBe(-1);
  });

  it("uses the configured target and leaves the canvas alone", () => {
    const canvas = document.createElement("canvas");
    const wrapper = document.createElement("div");
    expect(resolveInputTarget(canvas, wrapper)).toBe(wrapper);
    expect(canvas.hasAttribute("tabindex")).toBe(false);
  });
});

describe("isEditableTarget", () => {
  it.each([
    ["an input", () => document.createElement("input"), true],
    ["a textarea", () => document.createElement("textarea"), true],
    ["a select", () => document.createElement("select"), true],
    [
      "a child of a contenteditable",
      () => {
        const editable = document.createElement("div");
        editable.setAttribute("contenteditable", "");
        return editable.appendChild(document.createElement("b"));
      },
      true,
    ],
    [
      "contenteditable=false",
      () => {
        const div = document.createElement("div");
        div.setAttribute("contenteditable", "false");
        return div;
      },
      false,
    ],
    [
      "a node inside a CodeMirror editor",
      () => {
        const editor = document.createElement("div");
        editor.className = "cm-editor";
        const line = editor.appendChild(document.createElement("div"));
        return line.appendChild(document.createElement("span"));
      },
      true,
    ],
    [
      "an option inside a select",
      () => document.createElement("select").appendChild(document.createElement("option")),
      true,
    ],
    ["a canvas", () => document.createElement("canvas"), false],
  ])("%s", (_, make, editable) => {
    expect(isEditableTarget(make())).toBe(editable);
  });

  it("is false for no target", () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});
