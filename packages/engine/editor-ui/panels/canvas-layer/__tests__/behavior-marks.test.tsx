// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../../../editor/index";
import { createRegistry } from "../../../../game/define";
import type { EntityDef } from "../../../../scene/types";
import { BehaviorMarks, ColliderOutlines } from "../BehaviorMarks";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const view = { width: 800, height: 600, scale: 100, tx: 0, ty: 0 };

function sessionOf(...entities: EntityDef[]) {
  const def: SceneDefinition = {
    v: 1,
    name: "marks",
    bounds: [0, 0, 20, 20],
    settings: { physics: "rapier" },
    entities,
  };
  return createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: "marks",
    registry,
    issuesDebounceMs: 0,
  });
}

const post: EntityDef = {
  id: "post",
  type: "marker",
  at: [4, 5],
  behaviors: { collider: { shape: ["box", 0, 0, 0.1, 0.1] } },
};
const link: EntityDef = {
  id: "link",
  type: "marker",
  at: [5, 5],
  behaviors: {
    body: {},
    collider: { shape: ["box", 0, 0, 0.5, 0.05] },
    joint: { kind: "revolute", to: "post", anchorA: [-0.5, 0], anchorB: [0.5, 0] },
  },
};
const ferry: EntityDef = {
  id: "ferry",
  type: "marker",
  at: [10, 5],
  behaviors: {
    "path-follow": {
      path: {
        pts: [
          [10, 5],
          [12, 5],
        ],
        mode: "ping_pong",
        speed: 1,
      },
    },
  },
};
const zone: EntityDef = {
  id: "zone",
  type: "marker",
  at: [2, 2],
  behaviors: { collider: { shape: ["circle", 0, 0, 1], sensor: true } },
};

afterEach(cleanup);

describe("ColliderOutlines", () => {
  it("outlines every collider faintly but the selected entity's", () => {
    const session = sessionOf(post, link, ferry, zone);
    const draw = () =>
      render(
        <svg>
          <ColliderOutlines session={session} transform="" />
        </svg>,
      );
    const refs = (c: HTMLElement) =>
      [...c.querySelectorAll("[data-collider-outlines] path")].map((p) =>
        p.getAttribute("data-ref"),
      );
    const all = draw();
    expect(refs(all.container)).toEqual(["post", "link", "zone"]);
    expect(all.container.querySelector('[data-ref="zone"]')!.hasAttribute("data-sensor")).toBe(
      true,
    );
    all.unmount();

    act(() => session.select(["link"]));
    const some = draw();
    expect(refs(some.container)).toEqual(["post", "zone"]);
  });
});

describe("BehaviorMarks", () => {
  const draw = (session: ReturnType<typeof sessionOf>) =>
    render(
      <svg>
        <BehaviorMarks session={session} view={view} transform="" overlay={{}} />
      </svg>,
    );

  it("links a joint whose anchors coincide to the entity it names", () => {
    const session = sessionOf(post, link);
    act(() => session.select(["link"]));
    const { container } = draw(session);
    const joints = [...container.querySelectorAll('[data-behavior-mark="joint"]')];
    expect(joints.map((j) => [j.getAttribute("data-joint-line"), j.getAttribute("d")])).toEqual([
      ["link", "M5 5 L4 5"],
    ]);
  });

  it("draws a path-follow entity's path and waypoints", () => {
    const session = sessionOf(ferry);
    act(() => session.select(["ferry"]));
    const { container } = draw(session);
    const path = container.querySelector('[data-behavior-mark="path"]');
    expect(path).not.toBeNull();
    expect(path!.querySelector("path")!.getAttribute("d")).toBe("M10 5 L12 5");
    expect(path!.querySelectorAll("[data-waypoint]")).toHaveLength(2);
    for (const dot of path!.querySelectorAll("[data-waypoint]")) {
      const unscaled =
        dot.getAttribute("stroke") === "none" ||
        dot.getAttribute("vector-effect") === "non-scaling-stroke";
      expect(unscaled).toBe(true);
    }
  });

  it("moves the path with the entity while a move previews", () => {
    const session = sessionOf(ferry);
    act(() => session.select(["ferry"]));
    const { container } = render(
      <svg>
        <BehaviorMarks
          session={session}
          view={view}
          transform=""
          overlay={{ handles: [{ id: "move", kind: "move", at: [11, 6] }] }}
        />
      </svg>,
    );
    const path = container.querySelector('[data-behavior-mark="path"]')!;
    expect(path.querySelector("path")!.getAttribute("d")).toBe("M11 6 L13 6");
    expect(
      [...path.querySelectorAll("[data-waypoint]")].map((c) => [
        c.getAttribute("cx"),
        c.getAttribute("cy"),
      ]),
    ).toEqual([
      ["11", "6"],
      ["13", "6"],
    ]);
  });
});
