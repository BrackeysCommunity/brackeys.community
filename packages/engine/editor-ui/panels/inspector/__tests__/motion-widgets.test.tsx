// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../../../editor/index";
import { createRegistry } from "../../../../game/index";
import { EditorInspector } from "../../EditorInspector";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const show = (entity: Record<string, unknown>) => {
  const def = {
    v: 2,
    name: "motion-widgets",
    bounds: [0, 0, 20, 20],
    entities: [{ id: "it", ...entity }],
  } as SceneDefinition;
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("w") }),
    origin: ada,
    name: "motion-widgets",
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });
  session.select(["it"]);
  render(<EditorInspector session={session} />);
  return { session };
};

const tweensOf = (session: ReturnType<typeof createEditorSession>) =>
  (session.getDoc().entities![0]!.behaviors as { tween: { tweens: unknown[] } }).tween.tweens;

const placeholder = (label: string) => screen.getByLabelText(label).getAttribute("placeholder");

describe("the inspector's motion fields", () => {
  afterEach(cleanup);

  it("shows what an unset tween field falls back to", () => {
    show({
      type: "marker",
      at: [5, 3],
      behaviors: { tween: { tweens: [{ to: { y: 4 }, duration: 30 }] } },
    });
    expect(placeholder("behaviors.tween.tweens.0.delay")).toBe("0 (default)");
    expect(placeholder("behaviors.tween.tweens.0.repeat")).toBe("0 (default)");
    expect(placeholder("behaviors.tween.tweens.0.emit.type")).toBe("tween:end");
    expect(screen.getByText("Linear (default)")).toBeTruthy();
  });

  it("shows an unset anim offset at its default", () => {
    show({
      type: "marker",
      at: [5, 3],
      behaviors: { sprite: { asset: "hero" }, anim: { source: "hero", clip: "idle" } },
    });
    expect(placeholder("behaviors.anim.offset")).toBe("0 (default)");
  });

  it("disables removing a list's last allowed item, saying why in its hint", async () => {
    const { session } = show({
      type: "marker",
      at: [5, 3],
      behaviors: { tween: { tweens: [{ to: { y: 4 }, duration: 30 }] } },
    });
    const remove = screen.getByRole("button", { name: "Remove Tween 1" });
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(remove);
    expect(tweensOf(session)).toHaveLength(1);
    fireEvent.focus(remove);
    expect(await screen.findByText("Keeps at least 1", {}, { timeout: 2000 })).toBeTruthy();
  });

  it("numbers a point list from 1, as a list of objects does", () => {
    show({ type: "nav", shape: ["poly", 0, 0, 4, 0, 4, 4] });
    expect(screen.getByRole("button", { name: "Remove point 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove point 3" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove point 0" })).toBeNull();
  });
});
