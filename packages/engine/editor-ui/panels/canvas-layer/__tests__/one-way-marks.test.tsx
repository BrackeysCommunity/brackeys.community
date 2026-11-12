// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { toolRegistry as registry } from "../../../../__tests__/fixtures/test-tool";
import {
  sceneToDoc,
  sequentialKeys,
  staticPrefabSource,
  type SceneOrigin,
} from "../../../../collab/index";
import {
  createEditorSession,
  type EditorSession,
  type ToolOverlay,
} from "../../../../editor/index";
import { createRegistry, defineEntityType, defineGame } from "../../../../game/define";
import { shapeField } from "../../../../game/fields";
import type { GameStoreState } from "../../../../index";
import { expandScene } from "../../../../scene/expand";
import {
  prefabLibrary,
  SCENE_FORMAT_VERSION,
  type Prefab,
  type SceneDefinition,
} from "../../../../scene/index";
import type { EditorNotify } from "../../../host";
import { KitProvider } from "../../../kit/index";
import type { LoadedRun } from "../../../session/loaded-run";
import { CanvasLayer } from "../CanvasLayer";
import { OneWayMarks } from "../OneWayMarks";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const notify: EditorNotify = Object.assign(vi.fn(), {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
});

const LEDGE: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "ledge",
  entities: [{ id: "bar", type: "solid", shape: ["box", 0, 0, 30, 5], oneWay: "up" }],
};

function yard(): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: registry.game!.id,
    name: "one-way-yard",
    bounds: [0, 0, 2000, 1200],
    instances: [{ id: "turned", prefab: "ledge", at: [600, 300], rot: 1 }],
    entities: [
      { id: "cloud", type: "solid", shape: ["box", 100, 100, 50, 10], oneWay: true },
      { id: "wall", type: "solid", shape: ["box", 300, 100, 10, 50], oneWay: "left" },
      { id: "floor", type: "solid", shape: ["box", 500, 500, 200, 10] },
    ],
  } as SceneDefinition;
}

const sessions: EditorSession[] = [];
afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

function setup() {
  const session = createEditorSession({
    doc: sceneToDoc(yard(), { key: sequentialKeys("o") }),
    origin: ada,
    name: "one-way-yard",
    registry,
    issuesDebounceMs: 0,
    prefabs: staticPrefabSource(prefabLibrary([LEDGE])),
  });
  sessions.push(session);
  // Centred on the window at scale 1, so screen px are world px.
  const store = new Store({
    camera: { position: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, scale: 1 },
  } as unknown as GameStoreState);
  render(
    <KitProvider host={{}}>
      <CanvasLayer
        session={session}
        host={null}
        store={store}
        runStore={new Store<LoadedRun | null>(null)}
        notify={notify}
      />
    </KitProvider>,
  );
  return session;
}

const marks = () =>
  Object.fromEntries(
    [...document.querySelectorAll("[data-one-way-side]")].map((g) => [
      g.getAttribute("data-ref"),
      {
        side: g.getAttribute("data-one-way-side"),
        face: g.querySelector("[data-one-way-face]")!.getAttribute("d"),
        arrows:
          (g.querySelector("[data-one-way-arrows]")!.getAttribute("d") ?? "").split("M").length - 1,
      },
    ]),
  );

describe("one-way landing faces on the edit overlay", () => {
  it("highlights each one-way solid's landing face, turned with its instance, with arrows on it", () => {
    setup();
    expect(marks()).toEqual({
      cloud: { side: "up", face: "M50 90 L150 90", arrows: 2 },
      wall: { side: "left", face: "M290 150 L290 50", arrows: 2 },
      "turned/bar": { side: "right", face: "M605 270 L605 330", arrows: 1 },
    });
  });

  it("follows the document as one-way sides change", () => {
    const session = setup();
    act(() => {
      session.dispatch({
        ops: [
          { op: "update", ref: "wall", set: { oneWay: "down" } },
          { op: "update", ref: "floor", set: { oneWay: "up" } },
        ],
      });
    });
    expect(marks()).toMatchObject({
      wall: { side: "down", face: "M310 150 L290 150" },
      floor: { side: "up", face: "M300 490 L700 490", arrows: 8 },
    });
  });

  it("leaves out the faces of what a drag is moving until it lands", () => {
    const session = setup();
    cleanup();
    const view = { width: 2000, height: 1200, scale: 1, tx: 0, ty: 0 };
    const box = { type: "box", cx: 0, cy: 0, hw: 1, hh: 1, rotDeg: 0 } as const;
    const scene = expandScene(session.getDoc(), registry, { prefabs: session.getPrefabs() });
    const marksWith = (overlay?: ToolOverlay) =>
      render(
        <svg>
          <OneWayMarks session={session} scene={scene} view={view} transform="" overlay={overlay} />
        </svg>,
      );
    const { rerender } = marksWith({
      // Where the drag started stays a plain outline; the previewed ones name what moves.
      outlines: [
        { shape: box, tone: "ghost", ref: "cloud" },
        { shape: box, tone: "selected", ref: "cloud", preview: true },
        { shape: box, tone: "selected", ref: "turned", preview: true },
        { shape: box, tone: "selected", ref: "wall" },
      ],
    });
    expect(Object.keys(marks())).toEqual(["wall"]);

    rerender(
      <svg>
        <OneWayMarks session={session} scene={scene} view={view} transform="" overlay={{}} />
      </svg>,
    );
    expect(Object.keys(marks()).sort()).toEqual(["cloud", "turned/bar", "wall"]);
  });

  it("marks a type one-way through its metadata alone", () => {
    const ledges = createRegistry(
      defineGame({
        id: "ledges",
        types: [
          defineEntityType({
            type: "ledge",
            description: "A ledge its system makes one-way, with no oneWay field.",
            fields: { shape: shapeField("Ledge shape.") },
            system: () => ({ spawn() {}, despawn() {}, clear() {}, size: () => 0 }),
            oneWay: true,
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const def = {
      v: SCENE_FORMAT_VERSION,
      game: "ledges",
      name: "ledges",
      bounds: [0, 0, 2000, 1200],
      entities: [{ id: "l", type: "ledge", shape: ["box", 100, 100, 50, 10] }],
    } as unknown as SceneDefinition;
    const session = createEditorSession({
      doc: sceneToDoc(def, { key: sequentialKeys("l") }),
      origin: ada,
      name: "ledges",
      registry: ledges,
      issuesDebounceMs: 0,
    });
    sessions.push(session);
    const view = { width: 2000, height: 1200, scale: 1, tx: 0, ty: 0 };
    render(
      <svg>
        <OneWayMarks
          session={session}
          scene={expandScene(session.getDoc(), ledges)}
          view={view}
          transform=""
        />
      </svg>,
    );
    expect(marks()).toEqual({ l: { side: "up", face: "M50 90 L150 90", arrows: 2 } });
  });
});
