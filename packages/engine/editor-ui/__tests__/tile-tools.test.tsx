// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type PeerPresence } from "../../collab/index";
import {
  createEditorSession,
  createKeymap,
  TILE_TOOL_IDS,
  type EditorSession,
  type SceneDefinition,
} from "../../editor/index";
import type { ToolHost } from "../../editor/index";
import { createToolHost } from "../../editor/tool-host";
import { DEFAULT_SNAP } from "../../editor/tools";
import { createRegistry } from "../../game/index";
import type { GameStoreState } from "../../index";
import type { ProjectRuntimeView } from "../../project/index";
import { SCENE_FORMAT_VERSION } from "../../scene/index";
import { createToolRouter } from "../../tool-router";
import { EditorFrame, Island } from "../frame/EditorFrame";
import { EditorCanvasOverlay } from "../panels/EditorCanvasOverlay";
import { EditorStatusBar } from "../panels/EditorStatusBar";
import {
  BRUSH_COMMANDS,
  dockParts,
  dockWidth,
  EditorToolbar,
  fitDock,
} from "../panels/EditorToolbar";
import { TilePalette } from "../panels/TilePalette";
import type { EditorHostState } from "../session/live-scene-editor";

const sceneWith = (tilemap: boolean): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "tile-yard",
  bounds: [0, 0, 10.24, 7.68],
  settings: { grid: { kind: "square", cell: [0.32, 0.32] } },
  entities: [
    { id: "post", type: "solid", shape: { type: "box", center: [1, 1], size: [0.5, 0.5] } },
    ...(tilemap
      ? [{ id: "floor", type: "tilemap", at: [0.64, 0.64], tileset: "ts", cells: {} }]
      : []),
  ],
});

const sessions: EditorSession[] = [];
afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

function setup(tilemap = true, wrap: (toolbar: ReactNode) => ReactNode = (t) => t) {
  const registry = createRegistry();
  const def = sceneWith(tilemap);
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: def.name,
    registry,
    issuesDebounceMs: 0,
  });
  sessions.push(session);
  const host = createToolHost({
    session,
    router: createToolRouter(),
    toWorld: ({ x, y }) => [x, y],
    scale: () => 1,
    snap: DEFAULT_SNAP,
  });
  render(
    wrap(
      <EditorToolbar
        session={session}
        keymap={createKeymap([])}
        host={host}
        onPlay={() => {}}
        onPlayHere={() => {}}
      />,
    ),
  );
  return { session, host };
}

const bar = () => within(screen.getByRole("toolbar", { name: "Editor" }));
const tileButton = (label: string) => bar().queryByRole("button", { name: label });
const select = (session: EditorSession, refs: string[]) =>
  act(() => session.store.setState((s) => ({ ...s, selection: refs })));

describe("the tile tools in the toolbar", () => {
  it("are not offered in a scene without a tilemap", () => {
    setup(false);
    expect(document.querySelector("[data-tile-tools]")).toBeNull();
    expect(tileButton("Tile brush")).toBeNull();
  });

  it("keep their room while no tilemap is in reach, and appear when one is selected or hovered", () => {
    const { session } = setup();
    expect(document.querySelector("[data-tile-tools]")?.getAttribute("data-tile-tools")).toBe(
      "reserved",
    );
    expect(tileButton("Tile brush")).toBeNull();

    select(session, ["post"]);
    expect(tileButton("Tile brush")).toBeNull();

    select(session, ["floor"]);
    expect(tileButton("Tile brush")).not.toBeNull();
    select(session, []);
    expect(tileButton("Tile brush")).toBeNull();

    act(() => session.store.setState((s) => ({ ...s, hover: "floor" })));
    expect(tileButton("Tile eraser")).not.toBeNull();
  });

  it("count in the dock's width whether or not they are drawn, so showing them never refits it", () => {
    const { host } = setup();
    const tools = [...host.tools(), ...host.tileTools()];
    const parts = dockParts(tools, null);
    for (const id of TILE_TOOL_IDS) expect(parts.some((p) => p.key === `tool:${id}`)).toBe(true);
    const without = dockParts(host.tools(), null);
    expect(dockWidth(parts, new Set())).toBe(
      dockWidth(without, new Set()) + 5 + 4 + (TILE_TOOL_IDS.length + BRUSH_COMMANDS.length) * 28,
    );
  });

  it("give way in a narrow window: the brush's turns, then the tile tools, before the shape tools", () => {
    const { host } = setup();
    const parts = dockParts([...host.tools(), ...host.tileTools()], null);
    const full = dockWidth(parts, new Set());
    const tile = TILE_TOOL_IDS.map((id) => `tool:${id}`);
    let tileGone = false;
    for (let room = full; room > 100; room -= 7) {
      const hidden = fitDock(parts, room);
      if (tile.some((k) => hidden.has(k)))
        expect(BRUSH_COMMANDS.every((c) => hidden.has(c.key))).toBe(true);
      if (hidden.has("tool:box")) expect(tile.every((k) => hidden.has(k))).toBe(true);
      tileGone ||= tile.every((k) => hidden.has(k)) && !hidden.has("tool:box");
    }
    expect(tileGone).toBe(true);
  });

  it("choosing one makes it the active tool, and keeps the group shown off the tilemap", () => {
    const { session, host } = setup();
    select(session, ["floor"]);
    fireEvent.click(tileButton("Tile fill")!);
    expect(host.tool()).toBe("tile-fill");
    expect(tileButton("Tile fill")?.getAttribute("aria-pressed")).toBe("true");

    select(session, []);
    expect(tileButton("Tile fill")).not.toBeNull();
  });

  it("turn the brush with R, F and V while a tile tool is active", () => {
    const { session, host } = setup();
    select(session, ["floor"]);
    const rotate = () => tileButton("Rotate the brush") as HTMLButtonElement;
    expect(rotate().disabled).toBe(true);

    fireEvent.click(tileButton("Tile brush")!);
    expect(rotate().disabled).toBe(false);
    expect(BRUSH_COMMANDS.map((c) => c.chord)).toEqual(["r", "f", "v"]);
    const command = vi.spyOn(host, "command");
    for (const c of BRUSH_COMMANDS) fireEvent.click(tileButton(c.label)!);
    expect(command.mock.calls.map(([c]) => c)).toEqual(BRUSH_COMMANDS.map((c) => c.key));
  });

  it("a palette pick in a narrow window leaves the tile tools and the brush's turns in More tools", async () => {
    const width = window.innerWidth;
    act(() => {
      Object.assign(window, { innerWidth: 800 });
      window.dispatchEvent(new Event("resize"));
    });
    try {
      const { session, host } = setup(true, (toolbar) => (
        <EditorFrame dock={<Island>{toolbar}</Island>}>
          <canvas />
        </EditorFrame>
      ));
      const runtime = {
        settings: {},
        engine: {},
        table: () => [],
        inputMap: null,
        asset: () => undefined,
        doc: ((kind: string) =>
          kind === "tileset"
            ? { kind: "tileset", v: 1, image: "ts-png", tile: [16, 16], columns: 2 }
            : undefined) as never,
        docs: () => [],
      } satisfies ProjectRuntimeView;
      render(
        <TilePalette
          session={session}
          runtime={runtime}
          tools={new Store<ToolHost | null>(host)}
        />,
      );
      expect(tileButton("Tile brush")).toBeNull();
      fireEvent.pointerDown(screen.getByRole("gridcell", { name: "Tile 1" }), { button: 0 });
      expect(host.tool()).toBe("tile-brush");
      expect(session.store.state.tileBrush).toEqual({ tiles: [[2]] });

      fireEvent.click(bar().getByRole("button", { name: "More tools" }));
      await screen.findByRole("menu");
      const inMenu = (name: string) =>
        screen.queryByRole("menuitemradio", { name: new RegExp(name) }) !== null;
      const labels = host.tileTools().map((t) => t.label);
      expect(labels).toHaveLength(TILE_TOOL_IDS.length);
      for (const label of labels) expect(tileButton(label) !== null || inMenu(label)).toBe(true);
      expect(labels.some((label) => inMenu(label))).toBe(true);
      for (const c of BRUSH_COMMANDS)
        expect(screen.getByRole("menuitem", { name: new RegExp(c.label) })).toBeTruthy();
    } finally {
      act(() => {
        Object.assign(window, { innerWidth: width });
        window.dispatchEvent(new Event("resize"));
      });
    }
  });
});

describe("a refused fill", () => {
  it("shows its message in the status bar until the notice clears", () => {
    const { session } = setup();
    cleanup();
    const host = new Store<EditorHostState>({ connection: "live", sceneChanged: false });
    render(<EditorStatusBar session={session} host={host} />);
    expect(document.querySelector("[data-tool-notice]")).toBeNull();

    const text = "Fill refused: the region is over 65,536 cells.";
    act(() => session.store.setState((s) => ({ ...s, notice: text })));
    const shown = document.querySelector("[data-tool-notice]");
    expect(shown?.textContent).toBe(text);
    expect(shown?.getAttribute("data-tone")).toBe("warning");

    act(() => session.store.setState((s) => ({ ...s, notice: null })));
    expect(document.querySelector("[data-tool-notice]")).toBeNull();
  });
});

describe("a painter's brush in presence", () => {
  const painter = (brush?: PeerPresence["brush"]): PeerPresence => ({
    clientId: 7,
    user: { id: "bo", name: "Bo", color: "#22aa66" },
    selection: [],
    mode: "edit",
    ...(brush ? { brush } : {}),
  });

  it("draws their brush rectangle in their colour, and takes it away when they stop", () => {
    const { session } = setup();
    cleanup();
    const store = new Store({ camera: { position: { x: 0, y: 0 }, scale: 50 } } as GameStoreState);
    render(<EditorCanvasOverlay session={session} store={store} />);
    const brush = () => document.querySelector<SVGPathElement>("[data-peer-brush]");
    expect(brush()).toBeNull();

    act(() =>
      session.store.setState((s) => ({
        ...s,
        peers: [painter({ map: "floor", rect: { c0: 1, r0: 2, c1: 2, r1: 2 } })],
      })),
    );
    expect(brush()?.getAttribute("data-peer-brush")).toBe("Bo");
    expect(brush()?.getAttribute("d")).toBe("M0.96 1.28L1.6 1.28L1.6 1.6L0.96 1.6Z");
    expect(brush()?.getAttribute("style")).toContain("stroke");

    act(() => session.store.setState((s) => ({ ...s, peers: [painter()] })));
    expect(brush()).toBeNull();
  });

  it("ignores a brush on something that isn't a tilemap", () => {
    const { session } = setup();
    cleanup();
    const store = new Store({ camera: { position: { x: 0, y: 0 }, scale: 50 } } as GameStoreState);
    render(<EditorCanvasOverlay session={session} store={store} />);
    act(() =>
      session.store.setState((s) => ({
        ...s,
        peers: [painter({ map: "post", rect: { c0: 0, r0: 0, c1: 0, r1: 0 } })],
      })),
    );
    expect(document.querySelector("[data-peer-brush]")).toBeNull();
  });
});
