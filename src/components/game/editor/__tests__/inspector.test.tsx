// @vitest-environment jsdom
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "@jams/engine/collab";
import { createEditorSession, type SceneDefinition } from "@jams/engine/editor";
import {
  createRegistry,
  defineEntityType,
  defineGame,
  shapeField,
  tagsField,
} from "@jams/engine/game";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { EditorInspector } from "@/components/game/editor/EditorInspector";

const registry = createRegistry(
  defineGame({
    id: "panels",
    types: [
      defineEntityType({
        type: "gadget",
        description: "Every kind of field.",
        base: "sensor",
        fields: {
          shape: shapeField("Gadget shape."),
          power: z
            .number()
            .int()
            .min(0)
            .describe("How hard it pushes.")
            .meta({ title: "Power", unit: "px" }),
          mode: z.enum(["idle", "on", "off"]).describe("Mode."),
          armed: z.boolean().optional().describe("Armed."),
          tint: z.enum(["red", "green", "blue", "cyan", "magenta"]).optional().describe("Tint."),
          target: z.string().optional().describe("What it pokes."),
          turn: z.number().int().optional().describe("Turn.").meta({ unit: "deg" }),
          glow: z.number().describe("Glow.").meta({ widget: "glow", group: "physics" }),
          tags: tagsField("Labels."),
        },
        refs: [{ field: "target", targets: ["sensor"] }],
        inspector: { order: ["mode"] },
      }),
    ],
    actions: [],
    editor: { widgets: { glow: { kind: "slider", min: 0, max: 10 } } },
    createRuntime: () => ({ snapshot: () => null }),
  }),
);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

function scene(): SceneDefinition {
  return {
    v: 1,
    game: "panels",
    name: "panel-yard",
    bounds: [0, 0, 2000, 1200],
    entities: [
      { id: "zone", type: "sensor", shape: ["circle", 900, 600, 12], tags: ["goal"] },
      { id: "ring", type: "sensor", shape: ["circle", 700, 600, 30] },
      {
        id: "gizmo",
        type: "gadget",
        shape: ["box", 100, 100, 20, 20],
        power: 5,
        mode: "idle",
        target: "nowhere",
        glow: 3,
      },
    ],
  };
}

function setup(selection: string[]) {
  const session = createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("t") }),
    origin: ada,
    name: "panel-yard",
    registry,
    issuesDebounceMs: 0,
  });
  session.select(selection);
  const dispatch = vi.spyOn(session, "dispatch");
  render(<EditorInspector session={session} />);
  return { session, dispatch };
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const entity = (session: ReturnType<typeof setup>["session"], id: string) =>
  session.getDoc().entities!.find((e) => e.id === id)!;

afterEach(cleanup);

describe("EditorInspector", () => {
  it("draws the selection's fields by section and commits a draft as one batch on Enter", () => {
    const { session, dispatch } = setup(["zone"]);
    expect(screen.getByRole("region", { name: "Identity" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Shape" })).toBeTruthy();
    expect(input("shape.r").value).toBe("12");

    fireEvent.change(input("shape.r"), { target: { value: "20" } });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.keyDown(input("shape.r"), { key: "Enter" });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0].ops).toEqual([
      { op: "update", ref: "zone", set: { shape: ["circle", 900, 600, 20] } },
    ]);
    expect(entity(session, "zone").shape).toEqual(["circle", 900, 600, 20]);
    expect(input("shape.r").value).toBe("20");
  });

  it("shows an invalid draft inline and doesn't commit it", () => {
    const { dispatch } = setup(["gizmo"]);
    fireEvent.change(input("power"), { target: { value: "-1" } });
    fireEvent.blur(input("power"));
    expect(screen.getByText("Must be 0 or more.")).toBeTruthy();
    fireEvent.change(input("power"), { target: { value: "two" } });
    fireEvent.keyDown(input("power"), { key: "Enter" });
    expect(screen.getByText("Enter a number, or +=16.")).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("shows mixed values as — and applies +=16 to each target in one batch", () => {
    const { session, dispatch } = setup(["zone", "ring"]);
    expect(screen.getByText("2 selected")).toBeTruthy();
    const r = input("shape.r");
    expect(r.value).toBe("");
    expect(r.placeholder).toBe("—");
    expect(input("shape.cy").value).toBe("600");

    fireEvent.change(r, { target: { value: "+=16" } });
    fireEvent.keyDown(r, { key: "Enter" });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0].ops).toHaveLength(2);
    expect(entity(session, "zone").shape).toEqual(["circle", 900, 600, 28]);
    expect(entity(session, "ring").shape).toEqual(["circle", 700, 600, 46]);
  });

  it("steps with the arrows (Shift ×10) and scrubs a labelled number in one batch at release", () => {
    const { session, dispatch } = setup(["gizmo"]);
    fireEvent.keyDown(input("power"), { key: "ArrowUp" });
    fireEvent.keyDown(input("power"), { key: "ArrowUp", shiftKey: true });
    expect(entity(session, "gizmo").power).toBe(16);
    expect(dispatch).toHaveBeenCalledTimes(2);

    const label = within(screen.getByRole("region", { name: "Behavior" })).getByText("Power");
    fireEvent.pointerDown(label, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(label, { clientX: 120, pointerId: 1 });
    expect(input("power").value).toBe("21");
    expect(dispatch).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(label, { clientX: 120, pointerId: 1 });

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(entity(session, "gizmo").power).toBe(21);
  });

  it("edits enums, switches and tags through their widgets, and shows a game widget", () => {
    const { session } = setup(["gizmo"]);
    fireEvent.click(screen.getByRole("button", { name: "on" }));
    expect(entity(session, "gizmo").mode).toBe("on");

    fireEvent.click(screen.getByRole("switch", { name: "armed" }));
    expect(entity(session, "gizmo").armed).toBe(true);

    fireEvent.change(input("tags"), { target: { value: "loud" } });
    fireEvent.keyDown(input("tags"), { key: "Enter" });
    expect(entity(session, "gizmo").tags).toEqual(["loud"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag loud" }));
    expect(entity(session, "gizmo").tags).toBeUndefined();

    expect(screen.getByRole("combobox", { name: "tint" })).toBeTruthy();
    expect(screen.getByText("nowhere isn't a sensor in this scene.")).toBeTruthy();

    fireEvent.change(input("turn"), { target: { value: "90" } });
    fireEvent.keyDown(input("turn"), { key: "Enter" });
    expect(entity(session, "gizmo").turn).toBe(90);

    const physics = screen.getByRole("region", { name: "Physics" });
    expect(within(physics).getByText("glow")).toBeTruthy();
    expect(within(physics).getByText("3")).toBeTruthy();
  });

  it("switches a shape's tag losslessly at once, and asks first when the switch loses detail", async () => {
    const { session, dispatch } = setup(["gizmo"]);
    fireEvent.click(screen.getByRole("button", { name: "poly" }));
    expect(dispatch).toHaveBeenCalledOnce();
    expect(entity(session, "gizmo").shape).toEqual(["poly", 80, 80, 120, 80, 120, 120, 80, 120]);
    expect(input("shape.0.x").value).toBe("80");

    fireEvent.click(screen.getByRole("button", { name: "circle" }));
    expect(dispatch).toHaveBeenCalledOnce();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("loses detail");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Convert" }));
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect((entity(session, "gizmo").shape as unknown[])[0]).toBe("circle");
  });
});
