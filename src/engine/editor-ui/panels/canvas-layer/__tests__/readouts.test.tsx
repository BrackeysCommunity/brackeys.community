// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { testGameWithTools } from "../../../../__tests__/fixtures/test-tool";
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import {
  createEditorSession,
  createToolHost,
  DEFAULT_SNAP,
  geometryOfRef,
  readDelta,
  readShapeSize,
  type EditorSession,
  type SnapSettings,
  type ToolHost,
} from "../../../../editor/index";
import { createRegistry, defineGame } from "../../../../game/index";
import { SCENE_FORMAT_VERSION, type SceneDefinition, type ShapeObj } from "../../../../scene/index";
import { roundLength } from "../../../../scene/units";
import { createToolRouter } from "../../../../tool-router";
import { formatLength, formatQuantity, formatSpeed } from "../../../kit/format";
import { useHostOverlay } from "../tool-host";
import { ToolOverlayLabels, ToolOverlayMarks } from "../ToolOverlayLayer";
import { viewOf, worldTransform, type View } from "../view";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const free: SnapSettings = { ...DEFAULT_SNAP, enabled: false };

const registryAt = (ppm: number) =>
  createRegistry(defineGame({ ...testGameWithTools, world: { lengthUnit: ppm } }));

function yard(id: string): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: id,
    name: "readout-yard",
    bounds: [0, 0, 20, 12],
    entities: [{ id: "slab", type: "solid", shape: ["box", 3, 1, 0.5, 0.25] }],
  };
}

function Overlay({ host, view }: { host: ToolHost; view: View }) {
  const overlay = useHostOverlay(host);
  return (
    <div>
      <svg data-canvas-layer="">
        <ToolOverlayMarks overlay={overlay} view={view} transform={worldTransform(view)} />
      </svg>
      <ToolOverlayLabels overlay={overlay} view={view} />
    </div>
  );
}

const rigs: { session: EditorSession; host: ToolHost }[] = [];

afterEach(() => {
  cleanup();
  for (const r of rigs.splice(0)) {
    r.host.destroy();
    r.session.destroy();
  }
});

/** A rig at one screen px per world px: the pointer moves in screen px, the scene is in metres. */
function setup(ppm: number, snap: SnapSettings = free) {
  const registry = registryAt(ppm);
  const session = createEditorSession({
    doc: sceneToDoc(yard(registry.game!.id), { key: sequentialKeys("t") }),
    origin: ada,
    name: "readout-yard",
    registry,
    issuesDebounceMs: 0,
  });
  const router = createToolRouter();
  let clock = 0;
  const host = createToolHost({
    session,
    router,
    toWorld: ({ x, y }) => [x / ppm, y / ppm],
    scale: () => ppm,
    snap,
    now: () => (clock += 1000),
  });
  rigs.push({ session, host });
  const view: View = { width: 2000, height: 1200, scale: ppm, tx: 0, ty: 0 };
  render(<Overlay host={host} view={view} />);
  const dispatch = vi.spyOn(session, "dispatch");
  const ptr = (type: "down" | "move" | "up", x: number, y: number) =>
    act(() => {
      router.dispatch({
        kind: "pointer",
        type,
        screen: { x, y },
        button: 0,
        deltaY: 0,
        native: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false } as PointerEvent,
      });
    });
  const shape = (ref: string): ShapeObj => {
    const s = geometryOfRef(session.getResolved(), registry, ref)?.shape;
    if (!s) throw new Error(`${ref} has no shape`);
    return s;
  };
  return { session, host, ptr, shape, dispatch };
}

const readout = () => document.querySelector('[data-readout][data-tone="readout"]')?.textContent;

describe("the editor's readouts in metres", () => {
  it.each([
    [100, "Δ 0.37, 0.14 m"],
    [32, "Δ 1.15625, 0.4375 m"],
  ])(
    "reads a move at %i px per metre in metres, and its Δ is the delta the release commits",
    (ppm, text) => {
      const { session, ptr, shape, dispatch } = setup(ppm);
      act(() => session.select(["slab"]));
      const start = shape("slab") as Extract<ShapeObj, { type: "box" }>;
      const grab = [start.cx * ppm, start.cy * ppm] as const;
      ptr("down", grab[0], grab[1]);
      ptr("move", grab[0] + 37, grab[1] + 14);
      const shown = readout();
      expect(shown).toBe(text);
      ptr("up", grab[0] + 37, grab[1] + 14);

      expect(dispatch).toHaveBeenCalledOnce();
      const done = shape("slab") as Extract<ShapeObj, { type: "box" }>;
      const committed = [roundLength(done.cx - start.cx), roundLength(done.cy - start.cy)] as const;
      expect(readDelta([...committed], ppm)).toBe(shown);
      // Thirty-seven and fourteen whole world px.
      expect(committed[0] * ppm).toBeCloseTo(37, 6);
      expect(committed[1] * ppm).toBeCloseTo(14, 6);
    },
  );

  it.each([100, 32])("reads a resize at %i px per metre as the size it commits", (ppm) => {
    const { session, host, ptr, shape } = setup(ppm);
    act(() => session.select(["slab"]));
    const se = host.overlay().handles!.find((h) => h.id === "resize:se")!;
    ptr("down", se.at[0] * ppm, se.at[1] * ppm);
    ptr("move", se.at[0] * ppm + 21, se.at[1] * ppm + 9);
    const shown = readout();
    expect(shown).toMatch(/^W [\d.]+ H [\d.]+ m$/);
    ptr("up", se.at[0] * ppm + 21, se.at[1] * ppm + 9);
    expect(readShapeSize(shape("slab"), ppm)).toBe(shown);
  });
});

describe("formatLength and formatSpeed", () => {
  it("show one world px at 100 and 32 px per metre, with the unit", () => {
    expect(formatLength(3.25, 100)).toBe("3.25 m");
    expect(formatLength(4, 100)).toBe("4 m");
    expect(formatLength(0.1 + 0.2, 100)).toBe("0.3 m");
    expect(formatLength(1 / 32, 32)).toBe("0.03125 m");
    expect(formatLength(5 / 32, 32)).toBe("0.15625 m");
    expect(formatLength(-0.000001, 100)).toBe("0 m");
  });

  it("shows speeds and accelerations to hundredths", () => {
    expect(formatSpeed(4)).toBe("4 m/s");
    expect(formatSpeed(3.456)).toBe("3.46 m/s");
    expect(formatSpeed(12, "m/s²")).toBe("12 m/s²");
    expect(formatQuantity(0.5, "m", 32)).toBe("0.5 m");
    expect(formatQuantity(-0.001, "m/s", 32)).toBe("0 m/s");
  });
});

describe("the canvas view", () => {
  it("is screen px per metre: a metre is the camera's scale on screen", () => {
    const view = viewOf({ position: { x: 5, y: 3 }, scale: 32 }, 640, 480);
    expect(view.scale).toBe(32);
    // The camera's position sits at the canvas's centre; one metre right is 32 px right.
    expect(view.tx + 5 * view.scale).toBe(320);
    expect(view.tx + 6 * view.scale).toBe(352);
    expect(view.ty + 3 * view.scale).toBe(240);
  });
});
