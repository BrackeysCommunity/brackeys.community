// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import {
  createEditorSession,
  createKeymap,
  drawTypeOptions,
  type SceneDefinition,
} from "../../editor/index";
import { createToolHost } from "../../editor/tool-host";
import { DEFAULT_SNAP } from "../../editor/tools";
import { createRegistry } from "../../game/index";
import { createToolRouter } from "../../tool-router";
import { EditorToolbar, optionSlot } from "../panels/EditorToolbar";

const scene: SceneDefinition = { v: 1, name: "option-yard", bounds: [0, 0, 2000, 1200] };

function setup() {
  const registry = createRegistry();
  const session = createEditorSession({
    doc: sceneToDoc(scene, { key: sequentialKeys("t") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: scene.name,
    registry,
    issuesDebounceMs: 0,
  });
  const tools = createToolHost({
    session,
    router: createToolRouter(),
    toWorld: ({ x, y }) => [x, y],
    scale: () => 1,
    snap: DEFAULT_SNAP,
  });
  render(
    <EditorToolbar
      session={session}
      keymap={createKeymap([])}
      host={tools}
      onPlay={() => {}}
      onPlayHere={() => {}}
    />,
  );
  return { registry, tools };
}

const bar = () => within(screen.getByRole("toolbar", { name: "Editor" }));
const optionButton = () => bar().getByRole("button", { name: /^Draw type/ });
const order = () =>
  bar()
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

afterEach(cleanup);

describe("the dock's draw type slot", () => {
  it("is there before a draw tool is picked, disabled, at the width it keeps", () => {
    const { registry, tools } = setup();
    expect(drawTypeOptions(registry, "box").length).toBeGreaterThan(1);
    const idle = optionButton() as HTMLButtonElement;
    expect(idle.disabled).toBe(true);
    const width = idle.style.minWidth;
    expect(width).toMatch(/px$/);
    const before = order().length;

    act(() => {
      tools.setTool("box");
    });
    const picking = optionButton() as HTMLButtonElement;
    expect(picking.disabled).toBe(false);
    expect(picking.style.minWidth).toBe(width);
    expect(order().length).toBe(before);
  });

  it("reserves the widest of the draw tools' choices and the active option's", () => {
    const { registry, tools } = setup();
    const slot = optionSlot(tools.tools(), registry, null)!;
    const longest = (choices: readonly { label: string }[]) =>
      Math.max(...choices.map((c) => c.label.length));
    for (const kind of ["box", "circle", "pen"] as const) {
      const choices = drawTypeOptions(registry, kind);
      if (choices.length > 1)
        expect(longest(slot.choices)).toBeGreaterThanOrEqual(longest(choices));
    }
    expect(optionSlot([], registry, null)).toBeNull();
  });

  it("lists each type with its description under its label", async () => {
    const { registry, tools } = setup();
    act(() => {
      tools.setTool("box");
    });
    fireEvent.click(optionButton());
    const described = drawTypeOptions(registry, "box").find((o) => o.description);
    expect(described).toBeTruthy();
    const item = (await screen.findAllByRole("menuitemradio")).find((i) =>
      i.textContent?.startsWith(described!.label),
    )!;
    expect(item.querySelector(".je-option-choice-description")?.textContent).toBe(
      described!.description,
    );
  });
});
