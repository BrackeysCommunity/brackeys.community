// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import {
  sceneToDoc,
  sequentialKeys,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { settingsRows } from "../../editor/settings-model";
import { createRegistry } from "../../game/index";
import { projectView, type AssetEntry, type ProjectState } from "../../project/index";
import { EditorInspector } from "../panels/EditorInspector";
import { ColorWidget } from "../panels/inspector/color-widget";
import {
  NumberField,
  OptionsField,
  PointField,
  SwitchField,
  TextField,
  type FieldCommit,
} from "../panels/inspector/field-widgets";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const created = { at: 0, by: "test" };
const HASH = "a".repeat(64);

const rect = { x: 0, y: 0, w: 8, h: 8 };
const atlas = (id: string, path: string, frames: string[]): AssetEntry => ({
  key: id,
  id,
  kind: "atlas",
  path,
  sha256: HASH,
  bytes: 10,
  meta: {
    tool: "aseprite",
    frames: Object.fromEntries(frames.map((f) => [f, rect])),
    tags: [],
    slices: [],
    order: frames,
  },
  created,
});
const ENTRIES: AssetEntry[] = [
  {
    key: "bricks",
    id: "bricks",
    kind: "texture",
    path: "art/bricks.png",
    sha256: HASH,
    bytes: 10,
    meta: { width: 16, height: 16 },
    created,
  },
  atlas("hero", "art/hero.atlas.json", ["idle", "run", "jump"]),
  atlas("coins", "art/coins.atlas.json", ["spin-1", "spin-2"]),
  { key: "click", id: "click", kind: "audio", path: "sfx/click.ogg", sha256: HASH, created },
  { key: "yard", id: "yard", kind: "scene", path: "yard.json", created },
];

function fakeProject(): ProjectSession {
  const state: ProjectState = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(ENTRIES.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  };
  const view = projectView(state);
  return { view: () => view, projectDoc: new Y.Doc() } as unknown as ProjectSession;
}

function scene(): SceneDefinition {
  return {
    v: 2,
    name: "widget-yard",
    bounds: [0, 0, 400, 300],
    entities: [
      {
        id: "pic",
        type: "marker",
        at: [10, 10],
        behaviors: { sprite: { asset: "hero", frame: "run", tint: 0xff0000 } },
      },
      { id: "wall", type: "marker", at: [40, 10], behaviors: { sprite: { asset: "bricks" } } },
    ],
  };
}

function setup(selection: string[], project: ProjectSession | null = fakeProject()) {
  const session = createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("w") }),
    origin: ada,
    name: "widget-yard",
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });
  session.select(selection);
  const dispatch = vi.spyOn(session, "dispatch");
  render(<EditorInspector session={session} project={project} />);
  const sprite = (id: string) =>
    (session.getDoc().entities!.find((e) => e.id === id)!.behaviors as Record<string, unknown>)
      .sprite as Record<string, unknown>;
  return { session, dispatch, sprite };
}

/** A pointer moving onto an option highlights it before the click picks it, as Base UI requires. */
function choose(option: HTMLElement): void {
  fireEvent.mouseMove(option);
  fireEvent.click(option);
}

const ASSET = "behaviors.sprite.asset";
const FRAME = "behaviors.sprite.frame";
const TINT = "behaviors.sprite.tint";

async function openAssets() {
  const row = screen
    .getByRole("combobox", { name: ASSET })
    .closest(".je-insp-field") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "Show options" }));
  return waitFor(() => {
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    return options;
  });
}

afterEach(cleanup);

describe("the inspector's colour widget", () => {
  it("shows the sprite's tint as a swatch and hex, and writes a typed colour as 0xRRGGBB", () => {
    const { dispatch, sprite } = setup(["pic"]);
    const hex = screen.getByLabelText(TINT) as HTMLInputElement;
    expect(hex.value).toBe("#ff0000");
    expect(screen.getByRole("button", { name: "Pick Tint" }).style.background).toBe(
      "rgb(255, 0, 0)",
    );
    fireEvent.change(hex, { target: { value: "#00ff88" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0].ops).toEqual([
      { op: "update", ref: "pic", set: { [TINT]: 0x00ff88 } },
    ]);
    expect(sprite("pic").tint).toBe(0x00ff88);
  });

  it("writes the picker's colour as one batch when a control is let go", async () => {
    const { dispatch, sprite } = setup(["pic"]);
    fireEvent.click(screen.getByRole("button", { name: "Pick Tint" }));
    const value = await waitFor(() => screen.getByRole("textbox", { name: "Colour value" }));
    fireEvent.change(value, { target: { value: "#3366cc" } });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.blur(value);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(sprite("pic").tint).toBe(0x3366cc);
  });

  it("refuses a value that isn't a colour, and unsets an emptied optional tint", () => {
    const { dispatch, sprite } = setup(["pic"]);
    const hex = screen.getByLabelText(TINT) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: "orange" } });
    fireEvent.blur(hex);
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a colour like #ff8800.")).toBeTruthy();
    fireEvent.change(hex, { target: { value: "" } });
    fireEvent.blur(hex);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(sprite("pic")).not.toHaveProperty("tint");
  });
});

describe("an unset colour", () => {
  it("opens the picker at white, tint's no-op, and says so in the hex field", async () => {
    const { dispatch } = setup(["wall"]);
    const hex = screen.getByLabelText(TINT) as HTMLInputElement;
    expect(hex.value).toBe("");
    expect(hex.placeholder).toBe("unset (#ffffff)");
    fireEvent.click(screen.getByRole("button", { name: "Pick Tint" }));
    const value = await waitFor(
      () => screen.getByRole("textbox", { name: "Colour value" }) as HTMLInputElement,
    );
    expect(value.value.toLowerCase()).toBe("#ffffff");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("opens the picker at the field's default when it has one", async () => {
    render(
      <ColorWidget
        title="glow"
        path="glow"
        value={undefined}
        mixed={false}
        optional
        numeric
        defaultValue={0x336699}
        onCommit={() => null}
        onProblem={() => {}}
      />,
    );
    expect((screen.getByLabelText("glow") as HTMLInputElement).placeholder).toBe(
      "#336699 (default)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick glow" }));
    const value = await waitFor(
      () => screen.getByRole("textbox", { name: "Colour value" }) as HTMLInputElement,
    );
    expect(value.value.toLowerCase()).toBe("#336699");
  });
});

describe("the inspector's asset picker", () => {
  it("lists only the project's textures and atlases", async () => {
    setup(["pic"]);
    const options = await openAssets();
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("bricks"),
      expect.stringContaining("coins"),
      expect.stringContaining("hero"),
    ]);
    expect(screen.queryByRole("option", { name: /click|yard/ })).toBeNull();
  });

  it("offers the chosen atlas's frames in place of the frame text field", async () => {
    setup(["pic"]);
    expect(screen.queryByRole("textbox", { name: FRAME })).toBeNull();
    const frames = screen.getByRole("combobox", { name: FRAME });
    expect(frames.textContent).toContain("run");
    fireEvent.click(frames);
    const options = await waitFor(() => screen.getAllByRole("option"));
    expect(options.map((o) => o.textContent)).toEqual(["idle", "run", "jump"]);
  });

  it("writes a frame picked from the atlas", async () => {
    const { dispatch, sprite } = setup(["pic"]);
    fireEvent.click(screen.getByRole("combobox", { name: FRAME }));
    choose(await waitFor(() => screen.getByRole("option", { name: "jump" })));
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(sprite("pic")).toMatchObject({ asset: "hero", frame: "jump" });
  });

  it("writes an atlas and its first frame as one batch", async () => {
    const { dispatch, sprite, session } = setup(["pic"]);
    const options = await openAssets();
    choose(options.find((o) => o.textContent?.includes("coins"))!);
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      label: "Set Asset",
      ops: [
        { op: "update", ref: "pic", set: { [ASSET]: "coins" } },
        { op: "update", ref: "pic", set: { [FRAME]: "spin-1" } },
      ],
    });
    expect(sprite("pic")).toMatchObject({ asset: "coins", frame: "spin-1" });
    // One undo takes both back.
    session.undo();
    expect(sprite("pic")).toMatchObject({ asset: "hero", frame: "run" });
  });

  it("drops the frame when a texture is picked, and shows no frame row for it", async () => {
    const { dispatch, sprite } = setup(["pic"]);
    const options = await openAssets();
    choose(options.find((o) => o.textContent?.includes("bricks"))!);
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(sprite("pic").asset).toBe("bricks");
    expect(sprite("pic")).not.toHaveProperty("frame");
    await waitFor(() => expect(screen.queryByRole("combobox", { name: FRAME })).toBeNull());
    expect(screen.queryByRole("textbox", { name: FRAME })).toBeNull();
  });

  it("says when the asset isn't in the project", () => {
    const session = createEditorSession({
      doc: sceneToDoc(
        {
          ...scene(),
          entities: [
            { id: "lost", type: "marker", at: [0, 0], behaviors: { sprite: { asset: "gone" } } },
          ],
        },
        { key: sequentialKeys("l") },
      ),
      origin: ada,
      name: "widget-yard",
      registry: createRegistry(),
      issuesDebounceMs: 0,
    });
    session.select(["lost"]);
    render(<EditorInspector session={session} project={fakeProject()} />);
    expect(screen.getByText("gone isn't a texture or atlas in this project.")).toBeTruthy();
  });

  it("falls back to text fields without a project", () => {
    setup(["pic"], null);
    expect((screen.getByRole("textbox", { name: ASSET }) as HTMLInputElement).value).toBe("hero");
    expect((screen.getByRole("textbox", { name: FRAME }) as HTMLInputElement).value).toBe("run");
  });
});

describe("the inspector's behavior edits", () => {
  const yard = (behaviors: Record<string, unknown>): SceneDefinition => ({
    v: 2,
    name: "joint-yard",
    bounds: [0, 0, 20, 20],
    settings: { physics: "rapier" },
    entities: [
      { id: "crate", type: "prop", shape: ["box", 8, 5, 0.5, 0.5] },
      {
        id: "hero",
        type: "marker",
        at: [5, 3],
        behaviors: { collider: { shape: ["box", 0, 0, 0.25, 0.25] }, body: {}, ...behaviors },
      },
    ],
  });
  const open = (def: SceneDefinition) => {
    const session = createEditorSession({
      doc: sceneToDoc(def, { key: sequentialKeys("j") }),
      origin: ada,
      name: "joint-yard",
      registry: createRegistry(),
      issuesDebounceMs: 0,
    });
    session.select(["hero"]);
    render(<EditorInspector session={session} />);
    const block = (name: string) =>
      (
        session.getDoc().entities!.find((e) => e.id === "hero")!.behaviors as Record<
          string,
          unknown
        >
      )[name] as Record<string, unknown>;
    return { session, block };
  };
  const type = (label: string, value: string) => {
    const input = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
  };

  it("turns a hinge into a rope from the Kind select, and shows its length", async () => {
    const { block } = open(yard({ joint: { kind: "revolute", to: "crate", limits: [-1, 1] } }));
    fireEvent.click(screen.getByRole("combobox", { name: "behaviors.joint.kind" }));
    choose(await screen.findByRole("option", { name: "Rope" }));
    expect(block("joint")).toEqual({ kind: "rope", to: "crate", length: 1 });
    expect(await screen.findByLabelText("behaviors.joint.length")).toBeTruthy();
    expect(screen.queryByLabelText("behaviors.joint.limits.low")).toBeNull();
  });

  it("adds a motor from its Velocity field", () => {
    const { block } = open(yard({ joint: { kind: "revolute", to: "crate" } }));
    type("behaviors.joint.motor.velocity", "90");
    expect(block("joint").motor).toEqual({ velocity: Math.PI / 2, maxForce: 1 });
  });

  it("starts a range from one typed end without inverting it, and labels each end", () => {
    const { block } = open(yard({ joint: { kind: "revolute", to: "crate" } }));
    const row = screen
      .getByLabelText("behaviors.joint.limits.low")
      .closest(".je-insp-field") as HTMLElement;
    expect([...row.querySelectorAll(".je-insp-suffix")].map((s) => s.textContent)).toEqual([
      "min",
      "max",
      "deg",
    ]);
    type("behaviors.joint.limits.low", "30");
    expect(block("joint").limits).toEqual([Math.PI / 6, Math.PI / 6]);
  });

  it("names the field a refusal is about by its title, not the op path", () => {
    open(yard({ joint: { kind: "revolute", to: "crate", limits: [0, 1] } }));
    type("behaviors.joint.limits.low", "90");
    const error = document.querySelector(".je-insp-error")!;
    expect(error.textContent).toBe("Joint: limits: low must not exceed high");
  });

  it("adds a force area's groups from the game's collision groups", async () => {
    const { block } = open(
      yard({
        collider: { shape: ["box", 0, 0, 1, 1], sensor: true },
        body: undefined,
        "force-area": { force: [0, -20] },
      }),
    );
    const groups = createRegistry().collisionGroupNames;
    fireEvent.click(screen.getByRole("combobox", { name: "behaviors.force-area.affects.groups" }));
    choose(await screen.findByRole("option", { name: groups[0] }));
    expect(block("force-area").affects).toEqual({ groups: [groups[0]] });
    expect(
      screen.getByLabelText("behaviors.force-area.affects.tags").getAttribute("placeholder"),
    ).toBe("Add a tag");
  });
});

describe("the shared field widgets", () => {
  const SCHEMA = z.object({
    lives: z.number().int().min(1).max(9).optional().describe("Lives per run."),
    title: z.string().optional(),
    mode: z.enum(["calm", "wild"]).optional(),
    sound: z.boolean().optional(),
    gravity: z.tuple([z.number(), z.number()]).optional().meta({ unit: "m/s²" }),
  });
  const row = (name: string, value: Record<string, unknown> = {}) =>
    settingsRows(SCHEMA, value, "").find((r) => r.name === name)!;

  it("hand a typed number to the host's commit, step it with the arrows, and refuse an out-of-bounds draft", () => {
    const commit = vi.fn<FieldCommit>(() => null);
    render(<NumberField field={row("lives", { lives: 3 })} commit={commit} />);
    const input = screen.getByRole("textbox", { name: "lives" });
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commit).toHaveBeenLastCalledWith("5");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(commit).toHaveBeenLastCalledWith("+=1");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Must be 9 or less.")).toBeTruthy();
  });

  it("show a problem a commit resolves to later, and keep the draft until it lands", async () => {
    const commit = vi.fn<FieldCommit>(async () => "The settings haven't opened yet.");
    render(<TextField field={row("title")} commit={commit} unset="Untitled (default)" />);
    const input = screen.getByRole("textbox", { name: "title" }) as HTMLInputElement;
    expect(input.placeholder).toBe("Untitled (default)");
    fireEvent.change(input, { target: { value: "Yard" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commit).toHaveBeenCalledWith("Yard");
    expect(await screen.findByText("The settings haven't opened yet.")).toBeTruthy();
    expect(input.value).toBe("Yard");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commit).toHaveBeenLastCalledWith(undefined);
  });

  it("unset an optional choice picked again, and say what an unset one falls back to", () => {
    const commit = vi.fn<FieldCommit>(() => null);
    const options = [
      { value: "calm", label: "calm" },
      { value: "wild", label: "wild" },
    ];
    const { rerender } = render(
      <OptionsField
        field={row("mode")}
        commit={commit}
        unset="calm (default)"
        options={options}
        segmented
      />,
    );
    expect(screen.getByText("calm (default)")).toBeTruthy();
    rerender(
      <OptionsField
        field={row("mode", { mode: "wild" })}
        commit={commit}
        options={options}
        segmented
      />,
    );
    expect(screen.queryByText("calm (default)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "wild" }));
    expect(commit).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole("button", { name: "calm" }));
    expect(commit).toHaveBeenLastCalledWith("calm");
  });

  it("switch an unset field with a fallback from the fallback, writing false rather than unsetting", () => {
    const commit = vi.fn<FieldCommit>(() => null);
    render(<SwitchField field={row("sound")} commit={commit} fallback unset="on (default)" />);
    const toggle = screen.getByRole("switch", { name: "sound" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("on (default)")).toBeTruthy();
    fireEvent.click(toggle);
    expect(commit).toHaveBeenLastCalledWith(false);
    cleanup();
    render(<SwitchField field={row("sound", { sound: true })} commit={commit} />);
    fireEvent.click(screen.getByRole("switch", { name: "sound" }));
    expect(commit).toHaveBeenLastCalledWith(undefined);
  });

  it("edit one axis of a point over the value each target holds, or the fallback", () => {
    const commitEach = vi.fn((next: (current: unknown) => unknown) => {
      const out = next(undefined);
      return out instanceof Object && "message" in out
        ? (out as { message: string }).message
        : null;
    });
    render(<PointField field={row("gravity")} commitEach={commitEach} fallback={[0, 9.8]} />);
    const y = screen.getByRole("textbox", { name: "gravity.y" }) as HTMLInputElement;
    expect(y.placeholder).toBe("9.8");
    expect(screen.getByText("m/s²")).toBeTruthy();
    fireEvent.change(y, { target: { value: "20" } });
    fireEvent.keyDown(y, { key: "Enter" });
    const next = commitEach.mock.calls[0]![0];
    expect(next(undefined)).toEqual([0, 20]);
    expect(next([1, 2])).toEqual([1, 20]);
  });

  it("are the ones the scene inspector draws: its number fields step with the arrows through its own commit", () => {
    const { dispatch } = setup(["pic"]);
    const x = screen.getByRole("textbox", { name: "at.x" });
    fireEvent.keyDown(x, { key: "ArrowUp" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
