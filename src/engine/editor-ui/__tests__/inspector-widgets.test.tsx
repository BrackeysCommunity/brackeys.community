// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  sceneToDoc,
  sequentialKeys,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { projectView, type AssetEntry, type ProjectState } from "../../project/index";
import { EditorInspector } from "../panels/EditorInspector";

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
    expect(screen.getByRole("button", { name: "Pick tint" }).style.background).toBe(
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
    fireEvent.click(screen.getByRole("button", { name: "Pick tint" }));
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
