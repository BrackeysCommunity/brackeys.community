// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../../collab/index";
import {
  createEditorSession,
  createToolHost,
  DEFAULT_SNAP,
  type SceneDefinition,
} from "../../../editor/index";
import { createRegistry } from "../../../game/index";
import { SCENE_FORMAT_VERSION } from "../../../scene/index";
import { createToolRouter } from "../../../tool-router";
import { KitProvider } from "../../kit/index";
import { EditorOutliner } from "../EditorOutliner";

const registry = createRegistry();

const scene = (): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "tree",
  bounds: [0, 0, 2000, 1200],
  entities: [
    { id: "tower", type: "node", at: [100, 100] },
    { id: "base", type: "solid", parent: "tower", shape: ["box", 0, -10, 20, 10] },
    { id: "lamp", type: "marker", at: [50, 50] },
  ],
});

const teardown: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const t of teardown.splice(0)) t();
});

function setup() {
  const session = createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("t") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: "tree",
    registry,
    issuesDebounceMs: 0,
  });
  const host = createToolHost({
    session,
    router: createToolRouter(),
    toWorld: ({ x, y }) => [x, y],
    scale: () => 1,
    snap: { ...DEFAULT_SNAP, enabled: false },
  });
  teardown.push(
    () => host.destroy(),
    () => session.destroy(),
  );
  render(
    <KitProvider host={{}}>
      <EditorOutliner session={session} />
    </KitProvider>,
  );
  return { session, host };
}

const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));
const row = (name: string) => outliner().getByRole("button", { name: new RegExp(`^${name}`) });

describe("the outliner's focus", () => {
  it("follows a command that moves the selection off the focused row", () => {
    const { host } = setup();
    fireEvent.click(row("base"));
    row("base").focus();
    act(() => void host.command("hierarchy-up"));
    expect(row("tower").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(row("tower"));

    act(() => void host.command("hierarchy-down"));
    expect(document.activeElement).toBe(row("base"));
  });

  it("stays on a row that a click takes out of the selection", () => {
    setup();
    fireEvent.click(row("lamp"));
    fireEvent.click(row("base"), { shiftKey: true });
    row("base").focus();
    fireEvent.click(row("base"), { metaKey: true });
    expect(row("base").getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(row("base"));
  });

  it("leaves a focused row the selection never held alone", () => {
    const { session } = setup();
    row("lamp").focus();
    act(() => session.select(["base"]));
    expect(document.activeElement).toBe(row("lamp"));
  });
});
