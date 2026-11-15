// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../../../editor/index";
import { JOINT_KINDS } from "../../../../game/behaviors/joint";
import { createRegistry } from "../../../../game/define";
import { jointGlyph } from "../../../../scene/render-geometry";
import type { EntityDef } from "../../../../scene/types";
import { BehaviorMarks } from "../BehaviorMarks";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const view = { width: 800, height: 600, scale: 100, tx: 0, ty: 0 };

function sessionOf(...entities: EntityDef[]) {
  const def: SceneDefinition = {
    v: 1,
    name: "glyphs",
    bounds: [0, 0, 20, 20],
    settings: { physics: "rapier" },
    entities,
  };
  return createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: "glyphs",
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
const arm = (joint: Record<string, unknown>): EntityDef => ({
  id: "arm",
  type: "marker",
  at: [6, 5],
  behaviors: { body: {}, collider: { shape: ["box", 0, 0, 0.5, 0.05] }, joint },
});

afterEach(cleanup);

const draw = (session: ReturnType<typeof sessionOf>) =>
  render(
    <svg>
      <BehaviorMarks session={session} view={view} transform="" overlay={{}} />
    </svg>,
  );

describe("a selected joint's kind glyph", () => {
  it("draws each kind's glyph, the one the schematic renders use, at the anchors' midpoint", () => {
    for (const kind of JOINT_KINDS) {
      const session = sessionOf(
        post,
        arm({ kind, to: "post", anchorA: [-0.5, 0], anchorB: [0.5, 1] }),
      );
      act(() => session.select(["arm"]));
      const { container, unmount } = draw(session);
      const glyph = container.querySelector("[data-joint-glyph]");
      expect(glyph?.getAttribute("data-joint-glyph"), kind).toBe(kind);
      expect(glyph!.querySelector("text")!.textContent).toBe(jointGlyph(kind).mark);
      // anchorA at (5.5, 5), anchorB at (4.5, 6): the middle is (5, 5.5).
      const disc = glyph!.querySelector("circle")!;
      expect([disc.getAttribute("cx"), disc.getAttribute("cy")]).toEqual(["5", "5.5"]);
      unmount();
      session.destroy();
    }
  });

  it("sits on the link to the partner when the anchors coincide", () => {
    const session = sessionOf(post, arm({ kind: "weld", to: "post", anchorA: [-0.5, 0] }));
    act(() => session.select(["arm"]));
    const { container } = draw(session);
    const disc = container.querySelector('[data-joint-glyph="weld"] circle')!;
    expect([disc.getAttribute("cx"), disc.getAttribute("cy")]).toEqual(["5", "5"]);
    session.destroy();
  });

  it("draws no glyph for a joint that names nothing in the scene", () => {
    const session = sessionOf(arm({ kind: "rope", to: "gone" }));
    act(() => session.select(["arm"]));
    const { container } = draw(session);
    expect(container.querySelector("[data-joint-glyph]")).toBeNull();
    session.destroy();
  });
});
