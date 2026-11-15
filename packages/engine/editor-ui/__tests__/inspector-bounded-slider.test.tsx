// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry, defineBehavior, defineGame } from "../../game/index";
import { EditorInspector } from "../panels/EditorInspector";

const CHIME = defineBehavior({
  name: "panels/chime",
  description: "A chime it rings.",
  fields: {
    volume: z.number().min(0).max(1).default(0.5).describe("How loud, 0–1; default 0.5."),
    rings: z.number().int().min(0).default(1).describe("How many times; default 1."),
  },
  inspector: { label: "Chime", order: ["volume", "rings"] },
});

const registry = createRegistry(
  defineGame({
    id: "panels",
    behaviors: [CHIME],
    types: [],
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

function setup() {
  const def: SceneDefinition = {
    v: 1,
    game: "panels",
    name: "chimes",
    bounds: [0, 0, 2000, 1200],
    entities: [
      {
        id: "bell",
        type: "sensor",
        shape: ["circle", 500, 600, 10],
        behaviors: { "panels/chime": { volume: 0.25 } },
      },
    ],
  };
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: "chimes",
    registry,
    issuesDebounceMs: 0,
  });
  session.select(["bell"]);
  render(<EditorInspector session={session} />);
  return session;
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("EditorInspector: a bounded number", () => {
  afterEach(cleanup);

  it("draws as the shared slider and typed box, as the asset panels draw one", () => {
    const session = setup();
    const path = "behaviors.panels/chime.volume";
    const slider = document.querySelector(
      `input[type="range"][aria-label="${path} slider"]`,
    ) as HTMLInputElement;
    expect(slider.closest(".je-insp-slider")).not.toBeNull();
    expect(slider.getAttribute("aria-valuenow")).toBe("0.25");
    expect(slider.getAttribute("max")).toBe("1");
    expect(field(path).value).toBe("0.25");
    fireEvent.change(field(path), { target: { value: "0.75" } });
    fireEvent.keyDown(field(path), { key: "Enter" });
    const bell = session.getDoc().entities!.find((e) => e.id === "bell");
    expect(bell?.behaviors).toEqual({ "panels/chime": { volume: 0.75 } });
  });

  it("keeps a number bounded on one side a plain number box", () => {
    setup();
    const path = "behaviors.panels/chime.rings";
    expect(field(path).closest(".je-insp-slider")).toBeNull();
    expect(document.querySelector(`input[type="range"][aria-label="${path} slider"]`)).toBeNull();
  });
});
