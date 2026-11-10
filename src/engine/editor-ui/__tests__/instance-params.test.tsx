// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  sceneToDoc,
  sequentialKeys,
  staticPrefabSource,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { projectView, type AssetEntry, type ProjectState } from "../../project/index";
import { prefabLibrary, SCENE_FORMAT_VERSION } from "../../scene/index";
import { EditorInspector } from "../panels/EditorInspector";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const created = { at: 0, by: "test" };
const HASH = "a".repeat(64);
const rect = { x: 0, y: 0, w: 8, h: 8 };

const atlas = (id: string, frames: string[]): AssetEntry => ({
  key: id,
  id,
  kind: "atlas",
  path: `art/${id}.atlas.json`,
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
  atlas("hero", ["idle", "run", "jump"]),
  atlas("coins", ["spin-1", "spin-2"]),
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

const prefabs = prefabLibrary([
  {
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id: "sign",
    entities: [
      {
        id: "pic",
        type: "marker",
        at: [0, 0],
        behaviors: { sprite: { asset: "hero", frame: "run" } },
      },
    ],
    params: {
      look: { description: "What the sign shows.", targets: ["pic.behaviors.sprite.asset"] },
      skin: { description: "Its whole sprite.", targets: ["pic.behaviors.sprite"] },
    },
  },
]);

function setup(project: ProjectSession | null = fakeProject()) {
  const def: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "signs",
    bounds: [0, 0, 400, 300],
    instances: [
      {
        id: "sign-1",
        prefab: "sign",
        at: [100, 100],
        params: { skin: { asset: "hero", frame: "run" } },
      },
    ],
  };
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("s") }),
    origin: ada,
    name: "signs",
    registry: createRegistry(),
    prefabs: staticPrefabSource(prefabs),
    issuesDebounceMs: 0,
  });
  session.select(["sign-1"]);
  const dispatch = vi.spyOn(session, "dispatch");
  render(<EditorInspector session={session} project={project} />);
  const params = () => session.getDoc().instances!.find((i) => i.id === "sign-1")!.params ?? {};
  return { session, dispatch, params };
}

const parameters = () => within(screen.getByRole("region", { name: "Parameters" }));

/** A pointer moving onto an option highlights it before the click picks it, as Base UI requires. */
function choose(option: HTMLElement): void {
  fireEvent.mouseMove(option);
  fireEvent.click(option);
}

async function openAssets(path: string) {
  const row = parameters().getByRole("combobox", { name: path }).closest(".je-insp-field");
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Show options" }));
  return waitFor(() => {
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    return options;
  });
}

afterEach(cleanup);

describe("an instance's asset parameters", () => {
  it("pick a sprite parameter from the project's textures and atlases only", async () => {
    const { dispatch, params } = setup();
    expect(parameters().queryByRole("textbox", { name: "params.look" })).toBeNull();
    const options = await openAssets("params.look");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("bricks"),
      expect.stringContaining("coins"),
      expect.stringContaining("hero"),
    ]);
    expect(screen.queryByRole("option", { name: /click|yard/ })).toBeNull();

    choose(options.find((o) => o.textContent?.includes("bricks"))!);
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(dispatch.mock.calls[0]![0].ops).toEqual([
      { op: "setParam", ref: "sign-1", name: "look", value: "bricks" },
    ]);
    expect(params()).toMatchObject({ look: "bricks" });
  });

  it("offer an atlas's frames as a select, and write an atlas with its first frame at once", async () => {
    const { dispatch, params, session } = setup();
    expect(parameters().queryByRole("textbox", { name: "params.skin.frame" })).toBeNull();
    const frames = parameters().getByRole("combobox", { name: "params.skin.frame" });
    expect(frames.textContent).toContain("run");
    fireEvent.click(frames);
    const listed = await waitFor(() => screen.getAllByRole("option"));
    expect(listed.map((o) => o.textContent)).toEqual(["idle", "run", "jump"]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    const options = await openAssets("params.skin.asset");
    choose(options.find((o) => o.textContent?.includes("coins"))!);
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(dispatch.mock.calls[0]![0].ops).toEqual([
      {
        op: "setParam",
        ref: "sign-1",
        name: "skin",
        value: { asset: "coins", frame: "spin-1" },
      },
    ]);
    expect(params()).toEqual({ skin: { asset: "coins", frame: "spin-1" } });
    // One undo takes both back.
    session.undo();
    expect(params()).toEqual({ skin: { asset: "hero", frame: "run" } });
  });

  it("fall back to text fields without a project", () => {
    setup(null);
    expect(
      (parameters().getByRole("textbox", { name: "params.look" }) as HTMLInputElement).value,
    ).toBe("");
    expect(parameters().getByRole("textbox", { name: "params.skin.frame" })).toBeTruthy();
  });
});
