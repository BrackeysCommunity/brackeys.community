import { createEditorSession, type SceneDefinition } from "@jams/engine/editor";
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { EditorShell } from "@/components/game/editor/EditorShell";

function scene(): SceneDefinition {
  return {
    v: 1,
    name: "shell-yard",
    bounds: [0, 0, 2000, 1200],
    spawn: [[100, 1000]],
    solid: [["box", 500, 1040, 500, 20]],
    entities: [
      { id: "cheese", b: "sensor", kind: "goal", shape: ["circle", 900, 600, 12] },
      { id: "pad", b: "construct", type: "bounce_pad", at: [1000, 1010] },
    ],
  };
}

function setup() {
  const session = createEditorSession({ doc: scene(), name: "shell-yard" });
  const handlers = { onPlay: vi.fn(), onStop: vi.fn(), onSave: vi.fn() };
  render(<EditorShell session={session} {...handlers} />);
  return { session, ...handlers };
}

const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has storage; the guard matches the component's.
  }
});
afterEach(cleanup);

describe("EditorShell", () => {
  it("lists the scene in the outliner and selects a row on click", () => {
    const { session } = setup();
    const row = outliner().getByRole("button", { name: /cheese/ });
    expect(row.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(row);
    expect(session.store.state.selection).toEqual(["cheese"]);
    expect(row.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(outliner().getByRole("button", { name: /pad/ }), { ctrlKey: true });
    expect(session.store.state.selection).toEqual(["cheese", "pad"]);
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("keeps buckets closed until opened", () => {
    setup();
    expect(outliner().queryByRole("button", { name: /~solid:0/ })).toBeNull();
    fireEvent.click(outliner().getByRole("button", { name: /^solid/ }));
    expect(outliner().getByRole("button", { name: /~solid:0/ })).toBeTruthy();
  });

  it("commits one update from the inspector, then undo restores it", () => {
    const { session } = setup();
    fireEvent.click(outliner().getByRole("button", { name: /cheese/ }));

    const radius = screen.getByLabelText("shape.r") as HTMLInputElement;
    expect(radius.value).toBe("12");
    fireEvent.change(radius, { target: { value: "20" } });
    fireEvent.keyDown(radius, { key: "Enter" });

    expect(session.getDoc().entities![0]).toMatchObject({ shape: ["circle", 900, 600, 20] });
    expect(session.history.entries()).toHaveLength(1);
    expect(session.history.entries()[0]!.batch.ops).toEqual([
      { op: "update", ref: "cheese", set: { shape: ["circle", 900, 600, 20] } },
    ]);

    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(undo);

    expect(session.getDoc().entities![0]).toMatchObject({ shape: ["circle", 900, 600, 12] });
    expect((screen.getByLabelText("shape.r") as HTMLInputElement).value).toBe("12");
    expect(undo.disabled).toBe(true);
  });

  it("shows an invalid draft inline without committing it", () => {
    const { session } = setup();
    fireEvent.click(outliner().getByRole("button", { name: /cheese/ }));
    const radius = screen.getByLabelText("shape.r");
    fireEvent.change(radius, { target: { value: "-3" } });
    fireEvent.blur(radius);
    expect(screen.getByText("Must be above 0.")).toBeTruthy();
    expect(session.history.entries()).toHaveLength(0);
  });

  it("routes editor keys: Mod+Z undoes, Delete removes the selection, Mod+Enter plays", () => {
    const { session, onPlay } = setup();
    fireEvent.click(outliner().getByRole("button", { name: /pad/ }));
    fireEvent.keyDown(window, { key: "Delete" });
    expect(session.getDoc().entities!.map((e) => e.id)).toEqual(["cheese"]);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(session.getDoc().entities!.map((e) => e.id)).toEqual(["cheese", "pad"]);
    expect(session.store.state.selection).toEqual(["pad"]);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it("hides the panels in play mode and stops on Escape", () => {
    const { session, onStop } = setup();
    act(() => session.setMode("play"));
    expect(screen.queryByRole("navigation", { name: "Outliner" })).toBeNull();
    expect(screen.getByText("Playing · Esc to stop")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("saves through onSave when the scene has no errors", async () => {
    const { session, onSave } = setup();
    expect(session.store.state.issues.filter((i) => i.severity !== "info")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await act(async () => {});
    expect(onSave).toHaveBeenCalledOnce();
  });
});
