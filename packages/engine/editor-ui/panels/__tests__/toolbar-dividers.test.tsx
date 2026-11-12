// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../../collab/index";
import {
  createEditorSession,
  createKeymap,
  defineEditorTool,
  type EditorSession,
  type SceneDefinition,
} from "../../../editor/index";
import { createToolHost } from "../../../editor/tool-host";
import { DEFAULT_SNAP } from "../../../editor/tools";
import { createRegistry } from "../../../game/index";
import { pxPerMetreOf } from "../../../game/units";
import { createToolRouter } from "../../../tool-router";
import { formatLength } from "../../kit/format";
import { dockParts, EditorToolbar, optionSlot } from "../EditorToolbar";

const scene: SceneDefinition = { v: 4, name: "divider-yard", bounds: [0, 0, 20, 12] };

const GAME_TOOLS = [
  defineEditorTool({ id: "springs", label: "Springs", description: "Springs", create: () => ({}) }),
];

const sessions: EditorSession[] = [];
afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

function setup(withHost: boolean) {
  const registry = createRegistry();
  const session = createEditorSession({
    doc: sceneToDoc(scene, { key: sequentialKeys("d") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: scene.name,
    registry,
    issuesDebounceMs: 0,
  });
  sessions.push(session);
  const host = withHost
    ? createToolHost({
        session,
        router: createToolRouter(),
        toWorld: ({ x, y }) => [x, y],
        scale: () => 1,
        gameTools: GAME_TOOLS,
        snap: DEFAULT_SNAP,
      })
    : null;
  render(
    <EditorToolbar
      session={session}
      keymap={createKeymap([])}
      host={host}
      onPlay={() => {}}
      onPlayHere={() => {}}
    />,
  );
  return { registry, host };
}

const toolbar = () => screen.getByRole("toolbar", { name: "Editor" });
const dividers = () => toolbar().querySelectorAll(".je-toolbar-divider").length;

describe("the toolbar's dividers", () => {
  it("draws one divider for each the dock's width model counts", () => {
    const { registry, host } = setup(true);
    const tools = host!.tools();
    const parts = dockParts(
      tools,
      host!.snap().step,
      optionSlot(tools, registry, host!.option() ?? null),
      pxPerMetreOf(registry),
    );
    const counted = parts.filter((p) => p.key.startsWith("divider:")).length;
    expect(counted).toBeGreaterThanOrEqual(3);
    expect(dividers()).toBe(counted);
  });

  it("draws only Play's divider while there is no tool host", () => {
    setup(false);
    const counted = dockParts([], null).filter((p) => p.key.startsWith("divider:")).length;
    expect(counted).toBe(1);
    expect(dividers()).toBe(1);
    expect(toolbar().firstElementChild?.classList.contains("je-toolbar-divider")).toBe(false);
  });
});

describe("the grid menu", () => {
  it("shows the step in metres, and says why a View layer has nothing to draw", async () => {
    const { registry } = setup(true);
    const step = within(toolbar()).getByRole("button", { name: /^Grid step/ });
    expect(step.textContent).toBe(formatLength(DEFAULT_SNAP.step, pxPerMetreOf(registry)));
    fireEvent.click(step);
    const items = await screen.findAllByRole("menuitemcheckbox");
    const byLabel = (label: string) =>
      items.find((i) => i.querySelector(".je-option-choice")?.firstChild?.textContent === label)!;
    expect(byLabel("Grid").getAttribute("aria-disabled")).not.toBe("true");
    for (const [label, why] of [
      ["Occupancy", "Needs settings.grid"],
      ["Nav", "No nav areas"],
    ] as const) {
      const item = byLabel(label);
      expect(item.getAttribute("aria-disabled")).toBe("true");
      expect(item.querySelector(".je-option-choice-description")?.textContent).toBe(why);
    }
  });
});
