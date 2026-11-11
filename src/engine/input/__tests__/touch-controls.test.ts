// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  createTouchControls,
  type TouchControlDef,
  type TouchControlValue,
} from "../touch-controls";

// A 1000×500 canvas frame at page (100, 50): the shorter side is 500 px.
const RECT = { left: 100, top: 50, width: 1000, height: 500 };

const CONTROLS: TouchControlDef[] = [
  { id: "stick", kind: "stick", action: "move", at: [0.2, 0.8], radius: 0.1 },
  { id: "fire", kind: "button", action: "fire", at: [1.8, 0.8], radius: 0.08, label: "Fire" },
  { id: "pad", kind: "dpad", action: "aim", at: [1, 0.3], radius: 0.1 },
];
// Page centres: stick (200, 450) r 50; fire (1000, 450) r 40; pad (600, 200) r 50.

function setup(controls: readonly TouchControlDef[] = CONTROLS) {
  const host = document.createElement("div");
  host.getBoundingClientRect = () =>
    ({
      ...RECT,
      right: RECT.left + RECT.width,
      bottom: RECT.top + RECT.height,
      x: RECT.left,
      y: RECT.top,
    }) as DOMRect;
  document.body.append(host);
  const seen: [string, TouchControlValue][] = [];
  const overlay = createTouchControls(host, controls, (id, value) => seen.push([id, value]));
  const node = (id: string): HTMLElement => {
    const el = host.querySelector<HTMLElement>(`[data-touch-control="${id}"]`);
    if (!el) throw new Error(`no control ${id}`);
    return el;
  };
  return { host, overlay, seen, node };
}

function touch(
  target: EventTarget,
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
) {
  const e = new PointerEvent(type, {
    pointerId,
    pointerType: "touch",
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(e);
  return e;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("createTouchControls", () => {
  it("draws one node per control inside an overlay in the host", () => {
    const { host, node } = setup();
    const root = host.querySelector("[data-touch-controls]");
    expect(root?.parentElement).toBe(host);
    expect(root?.querySelectorAll("[data-touch-control]")).toHaveLength(3);
    expect(node("fire").textContent).toBe("Fire");
    expect(node("stick").dataset.kind).toBe("stick");
  });

  it("a touch on the stick reports quantised vector values in the unit disc", () => {
    const { seen, node } = setup();
    touch(node("stick"), "pointerdown", 1, 225, 450);
    touch(window, "pointermove", 1, 200, 400);
    touch(window, "pointermove", 1, 200, 400);
    touch(window, "pointermove", 1, 400, 450);
    touch(window, "pointermove", 1, 230, 410);
    touch(window, "pointerup", 1, 230, 410);
    expect(seen).toEqual([
      ["stick", { x: 0.5, y: 0 }],
      ["stick", { x: 0, y: -1 }],
      ["stick", { x: 1, y: 0 }],
      ["stick", { x: 0.6, y: -0.8 }],
      ["stick", { x: 0, y: 0 }],
    ]);
  });

  it("a touch on the button is a press, its release a release", () => {
    const { seen, node } = setup();
    touch(node("fire"), "pointerdown", 2, 1000, 450);
    touch(window, "pointermove", 2, 1010, 455);
    touch(window, "pointerup", 2, 1010, 455);
    expect(seen).toEqual([
      ["fire", { down: true }],
      ["fire", { down: false }],
    ]);
  });

  it("a d-pad reports one of eight directions, none near its centre", () => {
    const { seen, node } = setup();
    touch(node("pad"), "pointerdown", 3, 605, 200);
    touch(window, "pointermove", 3, 640, 160);
    touch(window, "pointermove", 3, 560, 202);
    touch(window, "pointercancel", 3, 560, 202);
    expect(seen).toEqual([
      ["pad", { x: 0.707, y: -0.707 }],
      ["pad", { x: -1, y: 0 }],
      ["pad", { x: 0, y: 0 }],
    ]);
  });

  it("a pressed button looks pressed until released", () => {
    const { node } = setup();
    const fire = node("fire");
    const idle = { background: fire.style.background, transform: fire.style.transform };
    touch(fire, "pointerdown", 2, 1000, 450);
    expect(fire.dataset.active).toBe("true");
    expect(fire.style.background).not.toBe(idle.background);
    expect(fire.style.transform).not.toBe(idle.transform);
    touch(window, "pointerup", 2, 1000, 450);
    expect(fire.style.background).toBe(idle.background);
    expect(fire.style.transform).toBe(idle.transform);
  });

  it("a held d-pad lights the arms of its direction", () => {
    const { node } = setup();
    const pad = node("pad");
    const arms = [...pad.children] as HTMLElement[];
    const idle = arms.map((arm) => arm.style.background);
    // Arms run up, right, down, left.
    const lit = () => arms.map((arm, i) => arm.style.background !== idle[i]);
    touch(pad, "pointerdown", 3, 640, 160);
    expect(lit()).toEqual([true, true, false, false]);
    expect(pad.style.background).not.toBe(node("stick").style.background);
    touch(window, "pointermove", 3, 560, 202);
    expect(lit()).toEqual([false, false, false, true]);
    touch(window, "pointerup", 3, 560, 202);
    expect(arms.map((arm) => arm.style.background)).toEqual(idle);
    expect(pad.style.background).toBe(node("stick").style.background);
  });

  it("two touches drive two controls at once; a second touch on a held control is ignored", () => {
    const { seen, node } = setup();
    touch(node("stick"), "pointerdown", 1, 250, 450);
    touch(node("fire"), "pointerdown", 2, 1000, 450);
    touch(node("fire"), "pointerdown", 3, 1000, 450);
    touch(window, "pointerup", 3, 1000, 450);
    touch(window, "pointerup", 2, 1000, 450);
    touch(window, "pointerup", 1, 250, 450);
    expect(seen).toEqual([
      ["stick", { x: 1, y: 0 }],
      ["fire", { down: true }],
      ["fire", { down: false }],
      ["stick", { x: 0, y: 0 }],
    ]);
  });

  it("a held touch's events stop at the control, other touches reach the host", () => {
    const { host, node } = setup();
    const reached: string[] = [];
    for (const type of ["pointerdown", "pointermove", "pointerup"]) {
      host.addEventListener(type, () => reached.push(type));
    }
    const down = touch(node("fire"), "pointerdown", 4, 1000, 450);
    touch(host, "pointermove", 4, 1000, 450);
    touch(host, "pointerup", 4, 1000, 450);
    expect(down.defaultPrevented).toBe(true);
    expect(reached).toEqual([]);
    touch(host, "pointerdown", 5, 700, 300);
    touch(host, "pointerup", 5, 700, 300);
    expect(reached).toEqual(["pointerdown", "pointerup"]);
  });

  it("hitTest names the shown control under a page point", () => {
    const { overlay } = setup();
    expect(overlay.hitTest(200, 450)).toBe("stick");
    expect(overlay.hitTest(249, 450)).toBe("stick");
    expect(overlay.hitTest(251, 450)).toBeNull();
    expect(overlay.hitTest(1000, 489)).toBe("fire");
    expect(overlay.hitTest(600, 200)).toBe("pad");
    expect(overlay.hitTest(700, 300)).toBeNull();
    overlay.show(false);
    expect(overlay.hitTest(200, 450)).toBeNull();
  });

  it("show(false) hides the overlay and releases what it held; show(true) brings it back", () => {
    const { host, overlay, seen, node } = setup();
    const root = host.querySelector<HTMLElement>("[data-touch-controls]");
    touch(node("fire"), "pointerdown", 1, 1000, 450);
    overlay.show(false);
    expect(root?.style.display).toBe("none");
    expect(seen).toEqual([
      ["fire", { down: true }],
      ["fire", { down: false }],
    ]);
    touch(node("fire"), "pointerdown", 2, 1000, 450);
    expect(seen).toHaveLength(2);
    overlay.show(true);
    expect(root?.style.display).toBe("");
    expect(overlay.hitTest(1000, 450)).toBe("fire");
  });

  it("destroy removes every node and listener and releases held controls", () => {
    const { host, overlay, seen, node } = setup();
    const before = host.style.position;
    touch(node("stick"), "pointerdown", 1, 250, 450);
    overlay.destroy();
    expect(host.childElementCount).toBe(0);
    expect(host.querySelector("[data-touch-controls]")).toBeNull();
    expect(seen.at(-1)).toEqual(["stick", { x: 0, y: 0 }]);
    const count = seen.length;
    touch(window, "pointermove", 1, 200, 400);
    expect(seen).toHaveLength(count);
    expect(overlay.hitTest(200, 450)).toBeNull();
    expect(before).toBe("relative");
    expect(host.style.position).toBe("");
  });
});
