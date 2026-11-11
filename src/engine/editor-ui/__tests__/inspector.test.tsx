// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  sceneToDoc,
  sequentialKeys,
  staticPrefabSource,
  type SceneOrigin,
} from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import {
  createRegistry,
  defineBehavior,
  defineEntityType,
  defineGame,
  pointField,
  polygonField,
  shapeField,
  tagsField,
} from "../../game/index";
import { prefabLibrary, SCENE_FORMAT_VERSION } from "../../scene/index";
import { EditorInspector, InspectorReadOnly } from "../panels/EditorInspector";

const HUM = defineBehavior({
  name: "panels/hum",
  description: "A low hum it gives off.",
  fields: {
    volume: z.number().int().min(0).default(3).describe("How loud; default 3."),
    pitch: z.enum(["low", "high"]).default("low").describe("Its pitch; default low."),
  },
  inspector: { label: "Hum", order: ["volume", "pitch"] },
});
const SIGN = defineBehavior({
  name: "panels/sign",
  description: "Words written on it.",
  fields: { words: z.string().default("").describe("What it says.") },
  inspector: { label: "Sign" },
});

const registry = createRegistry(
  defineGame({
    id: "panels",
    behaviors: [HUM, SIGN],
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
        id: "bell",
        type: "sensor",
        shape: ["circle", 500, 600, 10],
        behaviors: { "panels/hum": { volume: 5 } },
      },
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

function setup(selection: string[], readOnly?: "prop" | "context", def = scene()) {
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: "panel-yard",
    registry,
    issuesDebounceMs: 0,
  });
  session.select(selection);
  const dispatch = vi.spyOn(session, "dispatch");
  render(
    readOnly === "context" ? (
      <InspectorReadOnly value>
        <EditorInspector session={session} />
      </InspectorReadOnly>
    ) : (
      <EditorInspector session={session} {...(readOnly ? { readOnly: true } : {})} />
    ),
  );
  return { session, dispatch };
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const entity = (session: ReturnType<typeof setup>["session"], id: string) =>
  session.getDoc().entities!.find((e) => e.id === id)!;

afterEach(cleanup);

describe("EditorInspector", () => {
  it.each(["prop", "context"] as const)("takes no edits when read-only (through its %s)", (how) => {
    const { session, dispatch } = setup(["bell"], how);
    expect(input("shape.r").matches(":disabled")).toBe(true);
    const hum = screen.getByRole("region", { name: "Hum" });
    const remove = within(hum).getByRole("button", { name: "Remove" }) as HTMLButtonElement;
    expect(remove.matches(":disabled")).toBe(true);

    fireEvent.change(input("shape.r"), { target: { value: "20" } });
    fireEvent.keyDown(input("shape.r"), { key: "Enter" });
    fireEvent.click(remove);
    expect(dispatch).not.toHaveBeenCalled();
    expect(entity(session, "bell").shape).toEqual(["circle", 500, 600, 10]);
    expect(entity(session, "bell").behaviors).toEqual({ "panels/hum": { volume: 5 } });
  });

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

    const label = within(screen.getByRole("region", { name: "Gameplay" })).getByText("Power");
    fireEvent.pointerDown(label, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(label, { clientX: 120, pointerId: 1 });
    expect(input("power").value).toBe("21");
    expect(dispatch).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(label, { clientX: 120, pointerId: 1 });

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(entity(session, "gizmo").power).toBe(21);
  });

  it("clears a one-way solid's side through an 'any' segment of its own", () => {
    const def = scene();
    def.entities!.push({
      id: "ledge",
      type: "solid",
      shape: ["box", 300, 300, 100, 10],
      oneWay: true,
    });
    const { session } = setup(["ledge"], undefined, def);
    const side = within(screen.getByRole("group", { name: "oneWay" }));
    const pressed = () =>
      side
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.textContent);
    expect(side.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "any",
      "up",
      "right",
      "down",
      "left",
    ]);
    expect(pressed()).toEqual(["up"]);

    fireEvent.click(side.getByRole("button", { name: "any" }));
    expect(entity(session, "ledge").oneWay).toBeUndefined();
    expect(pressed()).toEqual(["any"]);

    fireEvent.click(side.getByRole("button", { name: "left" }));
    expect(entity(session, "ledge").oneWay).toBe("left");
    fireEvent.click(side.getByRole("button", { name: "left" }));
    expect(entity(session, "ledge").oneWay).toBe("left");
  });

  it("shows a prop's body defaults as placeholders and keeps its body fields in Physics", () => {
    const def = scene();
    def.entities!.push({
      id: "crate",
      type: "prop",
      shape: ["box", 400, 400, 20, 20],
      density: 1,
      restitution: 0,
    });
    setup(["crate"], undefined, def);
    const physics = within(screen.getByRole("region", { name: "Physics" }));
    const placeholder = (path: string) =>
      (physics.getByLabelText(path) as HTMLInputElement).placeholder;
    expect(placeholder("gravityScale")).toBe("1 (default)");
    expect(placeholder("linearDamping")).toBe("0 (default)");
    expect(placeholder("angularDamping")).toBe("0 (default)");
    expect(placeholder("friction")).toBe("from material");
    for (const path of ["density", "restitution"])
      expect(physics.getByLabelText(path)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Gameplay" })).toBeNull();
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
    expect(within(physics).getByText("Glow")).toBeTruthy();
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

  it("draws a section per behavior, edits its fields, and removes it in one batch", () => {
    const { session, dispatch } = setup(["bell"]);
    const hum = screen.getByRole("region", { name: "Hum" });
    expect(within(hum).getByText("Hum")).toBeTruthy();
    expect(input("behaviors.panels/hum.volume").value).toBe("5");
    expect(within(hum).getByRole("button", { name: "low" })).toBeTruthy();

    fireEvent.change(input("behaviors.panels/hum.volume"), { target: { value: "+=2" } });
    fireEvent.keyDown(input("behaviors.panels/hum.volume"), { key: "Enter" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(entity(session, "bell").behaviors).toEqual({ "panels/hum": { volume: 7 } });

    fireEvent.click(within(hum).getByRole("button", { name: "Remove" }));
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1]![0].ops).toEqual([
      { op: "update", ref: "bell", unset: ["behaviors"] },
    ]);
    expect(entity(session, "bell").behaviors).toBeUndefined();
    expect(screen.queryByRole("region", { name: "Hum" })).toBeNull();
  });

  it("heads an unlabelled behavior's section with its key in sentence case", async () => {
    const { session } = setup(["zone"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add behavior" }));
    });
    await act(async () => {
      fireEvent.click((await screen.findAllByRole("menuitem"))[0]!);
    });
    expect(Object.keys(entity(session, "zone").behaviors ?? {})).toEqual(["sprite"]);
    const sprite = screen.getByRole("region", { name: "Sprite" });
    expect(sprite.querySelector("summary")?.textContent).toContain("Sprite");
    expect(screen.queryByRole("region", { name: "sprite" })).toBeNull();
  });

  it("adds a behavior from the Add behavior menu in one batch, with defaults as placeholders", async () => {
    const { session, dispatch } = setup(["zone"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add behavior" }));
    });
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "SpriteDraws a texture or an atlas frame at the entity's pose.",
      "OccupantStands on the grid cell under its pose, where paths and game code see it.",
      "LifetimeDestroys or disables the entity a time after it spawns or is enabled.",
      "HumA low hum it gives off.",
      "SignWords written on it.",
    ]);
    await act(async () => {
      fireEvent.click(items[3]!);
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(entity(session, "zone").behaviors).toEqual({ "panels/hum": {} });
    expect(screen.getByRole("region", { name: "Hum" })).toBeTruthy();
    const volume = input("behaviors.panels/hum.volume");
    expect([volume.value, volume.placeholder]).toEqual(["", "3 (default)"]);
    fireEvent.keyDown(volume, { key: "ArrowUp" });
    expect(entity(session, "zone").behaviors).toEqual({ "panels/hum": { volume: 4 } });

    cleanup();
    setup(["bell"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add behavior" }));
    });
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual([
      "SpriteDraws a texture or an atlas frame at the entity's pose.",
      "OccupantStands on the grid cell under its pose, where paths and game code see it.",
      "LifetimeDestroys or disables the entity a time after it spawns or is enabled.",
      "SignWords written on it.",
    ]);
  });

  it("adds Lifetime from the Add behavior menu as a valid block", async () => {
    const { session, dispatch } = setup(["zone"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add behavior" }));
    });
    const lifetime = (await screen.findAllByRole("menuitem")).find((i) =>
      i.textContent?.startsWith("Lifetime"),
    )!;
    await act(async () => {
      fireEvent.click(lifetime);
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(entity(session, "zone").behaviors).toEqual({ lifetime: { ticks: 60 } });
    expect(screen.getByRole("region", { name: "Lifetime" })).toBeTruthy();
    expect(input("behaviors.lifetime.ticks").value).toBe("60");
  });

  it("hints with tooltips, never a native title", () => {
    setup(["bell"]);
    expect(document.querySelectorAll("[title]")).toHaveLength(0);
  });
});

describe("EditorInspector: an instance's parameters", () => {
  const prefabs = prefabLibrary([
    {
      kind: "prefab",
      v: SCENE_FORMAT_VERSION,
      game: "panels",
      id: "lamp",
      entities: [
        {
          id: "g",
          type: "gadget",
          shape: ["box", 0, 0, 10, 10],
          power: 3,
          mode: "idle",
          glow: 1,
        },
      ],
      params: {
        power: { description: "How hard the lamp pushes.", targets: ["g.power"] },
        mode: { description: "What the lamp does.", targets: ["g.mode"], default: "on" },
      },
    },
  ]);

  function placed(selection: string[]) {
    const def: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      game: "panels",
      name: "lamps",
      bounds: [0, 0, 2000, 1200],
      instances: [{ id: "lamp-1", prefab: "lamp", at: [500, 500], params: { power: 7 } }],
      entities: [
        {
          id: "poker",
          type: "gadget",
          shape: ["box", 100, 100, 20, 20],
          power: 1,
          mode: "idle",
          target: "lamp-1/g",
          glow: 0,
        },
      ],
    };
    const session = createEditorSession({
      doc: sceneToDoc(def, { key: sequentialKeys("t") }),
      origin: ada,
      name: "lamps",
      registry,
      prefabs: staticPrefabSource(prefabs),
      issuesDebounceMs: 0,
    });
    session.select(selection);
    const dispatch = vi.spyOn(session, "dispatch");
    render(<EditorInspector session={session} />);
    return { session, dispatch };
  }

  it("lists the prefab's params, typed by their targets, and sets one with setParam", () => {
    const { dispatch } = placed(["lamp-1"]);
    const section = screen.getByRole("region", { name: "Parameters" });
    expect(within(section).getByText("Parameters")).toBeTruthy();
    expect(input("params.power").value).toBe("7");
    expect(within(section).getByRole("button", { name: "on" })).toBeTruthy();

    fireEvent.change(input("params.power"), { target: { value: "+=2" } });
    fireEvent.keyDown(input("params.power"), { key: "Enter" });
    expect(dispatch.mock.calls[0]![0]).toEqual({
      label: "Set lamp-1's power",
      ops: [{ op: "setParam", ref: "lamp-1", name: "power", value: 9 }],
    });
    expect(dispatch.mock.calls[0]![1]).toEqual({});

    fireEvent.click(within(section).getByRole("button", { name: "off" }));
    expect(dispatch.mock.calls[1]![0].ops).toEqual([
      { op: "setParam", ref: "lamp-1", name: "mode", value: "off" },
    ]);
  });

  it("marks a set param and resets it to the prefab's value", () => {
    const { dispatch } = placed(["lamp-1"]);
    const section = screen.getByRole("region", { name: "Parameters" });
    expect(section.querySelectorAll("[data-overridden]")).toHaveLength(1);
    fireEvent.click(within(section).getByRole("button", { name: "Reset" }));
    expect(dispatch.mock.calls[0]![0].ops).toEqual([
      { op: "setParam", ref: "lamp-1", name: "power", value: null },
    ]);
  });

  it("offers an instance's children to a ref field", () => {
    placed(["poker"]);
    expect(screen.queryByText(/isn't a sensor in this scene/)).toBeNull();
  });
});

describe("EditorInspector: an instance's placement", () => {
  const prefabs = prefabLibrary([
    {
      kind: "prefab",
      v: SCENE_FORMAT_VERSION,
      game: "panels",
      id: "post",
      entities: [{ id: "p", type: "sensor", shape: ["box", 0, 0, 10, 20] }],
    },
    {
      kind: "prefab",
      v: SCENE_FORMAT_VERSION,
      game: "panels",
      id: "yard",
      entities: [],
      instances: [{ id: "post-1", prefab: "post", at: [40, 0], z: 4 }],
    },
  ]);

  function placed(selection: string[]) {
    const def: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      game: "panels",
      name: "posts",
      bounds: [0, 0, 2000, 1200],
      instances: [
        { id: "post-2", prefab: "post", at: [300, 300], z: 2 },
        { id: "yard-1", prefab: "yard", at: [800, 300] },
      ],
    };
    const session = createEditorSession({
      doc: sceneToDoc(def, { key: sequentialKeys("t") }),
      origin: ada,
      name: "posts",
      registry,
      prefabs: staticPrefabSource(prefabs),
      issuesDebounceMs: 0,
    });
    session.select(selection);
    const dispatch = vi.spyOn(session, "dispatch");
    render(<EditorInspector session={session} />);
    return { session, dispatch };
  }

  const section = () => screen.getByRole("region", { name: "Placement" });
  const post = (session: ReturnType<typeof placed>["session"]) =>
    session.getDoc().instances!.find((i) => i.id === "post-2")!;

  it("turns and flips with one batch, one undo step and one history row per click", () => {
    const { session, dispatch } = placed(["post-2"]);
    expect(within(section()).getByText("Not turned")).toBeTruthy();
    const rows = session.store.state.history.length;

    fireEvent.click(within(section()).getByRole("button", { name: "Turn clockwise" }));
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0]).toEqual({
      label: "Turn post-2 clockwise",
      ops: [{ op: "transform", refs: ["post-2"], turn: 1 }],
    });
    expect(post(session).rot).toBe(1);
    expect(session.store.state.history).toHaveLength(rows + 1);
    expect(session.store.state.history.at(-1)!.label).toBe("Turn post-2 clockwise");
    expect(within(section()).getByText("Turned 90°")).toBeTruthy();

    fireEvent.click(within(section()).getByRole("button", { name: "Flip horizontally" }));
    expect(dispatch.mock.calls[1]![0].ops).toEqual([
      { op: "transform", refs: ["post-2"], flip: "x" },
    ]);
    expect(session.store.state.history).toHaveLength(rows + 2);
    expect(within(section()).getByText(/flipped/)).toBeTruthy();

    act(() => void session.undo());
    expect(post(session).flip).toBeUndefined();
    expect(post(session).rot).toBe(1);
    act(() => void session.undo());
    expect(post(session).rot).toBeUndefined();

    fireEvent.click(within(section()).getByRole("button", { name: "Turn counter-clockwise" }));
    fireEvent.click(within(section()).getByRole("button", { name: "Flip vertically" }));
    expect(dispatch.mock.calls.slice(2).map((c) => c[0].ops[0])).toEqual([
      { op: "transform", refs: ["post-2"], turn: -1 },
      { op: "transform", refs: ["post-2"], flip: "y" },
    ]);
  });

  it("shows the instance's z and sets it with one setZ", () => {
    const { session, dispatch } = placed(["post-2"]);
    expect(input("z").value).toBe("2");
    fireEvent.change(input("z"), { target: { value: "+=3" } });
    fireEvent.keyDown(input("z"), { key: "Enter" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]![0]).toEqual({
      label: "Set post-2's z",
      ops: [{ op: "setZ", refs: ["post-2"], z: 5 }],
    });
    expect(post(session).z).toBe(5);

    fireEvent.keyDown(input("z"), { key: "ArrowDown" });
    expect(post(session).z).toBe(4);

    fireEvent.change(input("z"), { target: { value: "99999" } });
    fireEvent.keyDown(input("z"), { key: "Enter" });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(input("z").getAttribute("aria-invalid")).toBe("true");
  });

  it("shows a nested instance's placement without the controls", () => {
    placed(["yard-1/post-1"]);
    expect(within(section()).getByText("4")).toBeTruthy();
    expect(within(section()).queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText("z")).toBeNull();
  });

  it("hints with tooltips, never a native title", () => {
    placed(["post-2"]);
    expect(document.querySelectorAll("[title]")).toHaveLength(0);
  });
});

describe("EditorInspector in metres", () => {
  const metricRegistry = (ppm: number) =>
    createRegistry(
      defineGame({
        id: "metric",
        world: { lengthUnit: ppm },
        types: [
          defineEntityType({
            type: "launcher",
            description: "Throws things.",
            base: "sensor",
            fields: {
              shape: shapeField("Launcher shape."),
              aim: pointField("Where it aims."),
              outline: polygonField("Its outline.").optional(),
              speed: z
                .number()
                .describe("Launch speed, m/s.")
                .meta({ title: "Speed", unit: "m/s" }),
            },
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );

  function metricSetup(ppm: number) {
    const def: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      game: "metric",
      name: "metric-yard",
      bounds: [0, 0, 20, 12],
      entities: [
        {
          id: "cannon",
          type: "launcher",
          shape: ["box", 3, 2, 0.5, 0.25],
          aim: [4, 1],
          outline: ["poly", 1, 1, 2, 1, 1.5, 0.5],
          speed: 4,
        },
      ],
    };
    const session = createEditorSession({
      doc: sceneToDoc(def, { key: sequentialKeys("t") }),
      origin: ada,
      name: "metric-yard",
      registry: metricRegistry(ppm),
      issuesDebounceMs: 0,
    });
    session.select(["cannon"]);
    render(<EditorInspector session={session} />);
    const cannon = () => session.getDoc().entities!.find((e) => e.id === "cannon")!;
    return { session, cannon };
  }

  /** The unit drawn after one number input. */
  const suffixOf = (label: string) =>
    input(label).closest(".je-insp-row")?.querySelector(".je-insp-suffix")?.textContent;

  it.each([100, 32])(
    "steps a shape's sizes and a point by one world px at %i px per metre",
    (ppm) => {
      const { cannon } = metricSetup(ppm);
      expect(suffixOf("shape.hw")).toBe("m");
      fireEvent.keyDown(input("shape.hw"), { key: "ArrowUp" });
      expect((cannon().shape as number[])[3]).toBeCloseTo(0.5 + 1 / ppm, 6);
      fireEvent.keyDown(input("shape.cx"), { key: "ArrowDown", shiftKey: true });
      expect((cannon().shape as number[])[1]).toBeCloseTo(3 - 10 / ppm, 6);

      fireEvent.keyDown(input("aim.x"), { key: "ArrowUp" });
      expect((cannon().aim as number[])[0]).toBeCloseTo(4 + 1 / ppm, 6);
      // Each written length is whole world px, by the rounding rule.
      for (const n of [...(cannon().shape as number[]).slice(1, 5), ...(cannon().aim as number[])])
        expect(Math.abs(n * ppm - Math.round(n * ppm))).toBeLessThan(1e-6);
    },
  );

  it.each([
    [100, 1.82],
    [32, 2.5],
  ])("adds a polygon point 32 world px on at %i px per metre", (ppm, x) => {
    const { cannon } = metricSetup(ppm);
    fireEvent.click(screen.getAllByRole("button", { name: "Add point" }).at(-1)!);
    const outline = cannon().outline as (string | number)[];
    expect(outline.slice(-2)).toEqual([x, 0.5]);
  });

  it("takes a typed length to micrometres, never to whole metres", () => {
    const { cannon } = metricSetup(32);
    fireEvent.change(input("shape.hh"), { target: { value: "0.1234567" } });
    fireEvent.keyDown(input("shape.hh"), { key: "Enter" });
    expect((cannon().shape as number[])[4]).toBe(0.123457);
  });

  it("shows each metric unit beside its value", () => {
    metricSetup(100);
    expect(suffixOf("speed")).toBe("m/s");
    expect(suffixOf("aim.x")).toBe("x");
    const aimRow = input("aim.x").closest('.je-insp-row[data-align="start"]')!;
    expect([...aimRow.querySelectorAll(".je-insp-suffix")].map((s) => s.textContent)).toEqual([
      "x",
      "y",
      "m",
    ]);
  });
});
