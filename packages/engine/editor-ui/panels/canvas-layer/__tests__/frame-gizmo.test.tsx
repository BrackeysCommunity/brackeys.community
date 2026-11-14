// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import {
  createEditorSession,
  createToolHost,
  DEFAULT_SNAP,
  STALK_PX,
  type EditorSession,
  type GizmoHandle,
  type ToolHost,
  type ToolOverlay,
} from "../../../../editor/index";
import { createRegistry } from "../../../../game/index";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../../../scene/index";
import { createToolRouter } from "../../../../tool-router";
import { useHostOverlay } from "../tool-host";
import { ToolOverlayMarks } from "../ToolOverlayLayer";
import type { View } from "../view";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const PPM = 50;

const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "frame-yard",
  bounds: [0, 0, 20, 12],
  entities: [
    { id: "pivot", type: "node", at: [4, 4], rot: 90 },
    { id: "arm", type: "solid", parent: "pivot", shape: ["box", 1, 0, 0.5, 0.1] },
  ],
};

function Overlay({ host, view }: { host: ToolHost; view: View }) {
  return (
    <svg data-canvas-layer="">
      <ToolOverlayMarks overlay={useHostOverlay(host)} view={view} transform="" />
    </svg>
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

const view: View = { width: 1000, height: 600, scale: PPM, tx: 0, ty: 0 };

describe("a node's gizmo on the canvas", () => {
  it("draws the rotate handle on a stalk from the node's origin, along its turned up", () => {
    const registry = createRegistry();
    const session = createEditorSession({
      doc: sceneToDoc(scene, { key: sequentialKeys("f") }),
      origin: ada,
      name: "frame-yard",
      registry,
      issuesDebounceMs: 0,
    });
    const host = createToolHost({
      session,
      router: createToolRouter(),
      toWorld: ({ x, y }) => [x / PPM, y / PPM],
      scale: () => PPM,
      snap: DEFAULT_SNAP,
    });
    rigs.push({ session, host });
    render(<Overlay host={host} view={view} />);
    act(() => session.select(["pivot"]));

    const handles = document.querySelectorAll("[data-handle]");
    expect([...handles].map((h) => h.getAttribute("data-handle-id"))).toEqual(["move", "rotate"]);
    const stalk = document.querySelector('[data-stalk="rotate"]');
    expect(stalk).not.toBeNull();
    // Turned a quarter, its up is world +x; the arm hangs below it, 0.1 m to that side.
    const end = 4 + 0.1 + STALK_PX / PPM;
    expect(stalk!.getAttribute("d")).toBe(`M200 200L${end * PPM} 200`);
  });

  it("draws a stalk only for a handle that has one", () => {
    const overlay: ToolOverlay = {
      handles: [
        { id: "rotate", kind: "rotate", at: [1, 0] },
        { id: "move", kind: "move", at: [0, 0] },
      ] satisfies GizmoHandle[],
    };
    render(
      <svg>
        <ToolOverlayMarks overlay={overlay} view={view} transform="" />
      </svg>,
    );
    expect(document.querySelector("[data-stalk]")).toBeNull();
  });
});
