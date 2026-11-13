// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  sceneToDoc,
  sequentialKeys,
  staticPrefabSource,
  type SceneOrigin,
} from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { prefabLibrary, SCENE_FORMAT_VERSION, type Prefab } from "../../scene/index";
import { EditorInspector } from "../panels/EditorInspector";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const HERO_SIDE: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "hero-side",
  params: {
    jumpHeight: {
      description: "How high a full jump rises, m.",
      targets: ["hero.behaviors.character-side-view.jumpHeight"],
    },
  },
  entities: [
    {
      id: "hero",
      type: "marker",
      at: [0, 0],
      behaviors: {
        "character-side-view": {},
        collider: { shape: ["box", 0, 0, 0.2, 0.4] },
      },
    },
  ],
};

function setup(selection: string[]) {
  const def: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "runner",
    bounds: [0, 0, 20, 20],
    instances: [{ id: "runner", prefab: "hero-side", at: [4, 4], params: { jumpHeight: 2 } }],
  };
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: "runner",
    registry,
    prefabs: staticPrefabSource(prefabLibrary([HERO_SIDE])),
    issuesDebounceMs: 0,
  });
  session.select(selection);
  return session;
}

const JUMP = "behaviors.character-side-view.jumpHeight";
const commit = (label: string, value: string) => {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
};

afterEach(cleanup);

describe("EditorInspector: behavior fields on an instance child", () => {
  it("overrides only the edited field, marks it, and reverts that key", () => {
    const session = setup(["runner/hero"]);
    render(<EditorInspector session={session} />);
    expect(document.querySelectorAll("[data-overridden]")).toHaveLength(0);
    commit(JUMP, "1");
    expect(session.getDoc().instances![0]!.overrides).toEqual({
      "hero.behaviors.character-side-view.jumpHeight": 1,
    });
    const marked = [...document.querySelectorAll("[data-overridden]")];
    expect(marked).toHaveLength(1);
    expect(within(marked[0] as HTMLElement).getByLabelText(JUMP)).toBeTruthy();
    fireEvent.click(within(marked[0] as HTMLElement).getByRole("button", { name: "Revert" }));
    expect(session.getDoc().instances![0]!.overrides).toBeUndefined();
  });

  it("marks a field the instance's param sets, and says when an override beats it", () => {
    const session = setup(["runner/hero"]);
    render(<EditorInspector session={session} />);
    const noted = () => [...document.querySelectorAll<HTMLElement>(".je-insp-param-note")];
    expect(noted().map((n) => n.textContent)).toEqual(["from param jumpHeight"]);
    expect(
      within(noted()[0]!.closest("[data-param-set]") as HTMLElement).getByLabelText(JUMP),
    ).toBeTruthy();
    commit(JUMP, "1");
    expect(noted().map((n) => n.textContent)).toEqual(["overrides param jumpHeight"]);
    expect(noted()[0]!.closest("[data-overridden]")).toBeTruthy();
  });

  it("marks nothing when the instance leaves the param unset", () => {
    const session = setup(["runner/hero"]);
    session.dispatch({
      label: "Clear",
      ops: [{ op: "setParam", ref: "runner", name: "jumpHeight", value: null }],
    });
    render(<EditorInspector session={session} />);
    expect(document.querySelectorAll(".je-insp-param-note")).toHaveLength(0);
  });

  it("notes on the instance's param the override that beats it", () => {
    const session = setup(["runner/hero"]);
    const { unmount } = render(<EditorInspector session={session} />);
    commit(JUMP, "1");
    unmount();
    session.select(["runner"]);
    render(<EditorInspector session={session} />);
    const section = screen.getByRole("region", { name: "Parameters" });
    expect(within(section).getByText(`Overridden by hero.${JUMP}`)).toBeTruthy();
  });
});
