// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Container } from "pixi.js";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectSession,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  type ProjectSession,
} from "../../collab/index";
import { createGame } from "../../engine";
import { createRegistry, defineGame, type SceneSwap } from "../../game/index";
import type { GameInstance } from "../../index";
import { createKindRegistry, prefabKind, sceneKind, type AssetEntry } from "../../project/index";
import type { SceneRuntimeHandle } from "../../runtime/types";
import { SCENE_FORMAT_VERSION, type OpBatch, type SceneDefinition } from "../../scene/index";
import { EditorFrame, editorChrome, type EditorFrameHandle } from "../frame/EditorFrame";
import {
  editorIdentity,
  openLiveEditor,
  prefabsReady,
  type LiveEditor,
} from "../session/live-scene-editor";
import { fakeWorldGame } from "./fake-world-game";

vi.mock("../../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const toast = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });

/** A physics-free game that logs each swap's strategy, so a reload shows. */
function treeGame(log: string[]) {
  return defineGame({
    id: "treey",
    types: [],
    actions: [],
    world: { physics: "none" },
    live: { timings: ["boundary", "now"] },
    createRuntime() {
      return {
        onSwap(swap: SceneSwap) {
          log.push(`onSwap ${swap.strategy} ${swap.timing}`);
        },
        snapshot: () => null,
      };
    },
  });
}

/** A quarter-turned pivot, a lamp under it, and an eye and a flag at the root. */
const yard = (): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "yard",
  bounds: [0, 0, 20, 20],
  entities: [
    { id: "pivot", type: "node", at: [5, 5], rot: 90 },
    { id: "lamp", type: "marker", at: [2, 0], parent: "pivot" },
    { id: "eye", type: "marker", at: [8, 3] },
    { id: "flag", type: "marker", at: [12, 12] },
  ],
});

const entry = (key: string, kind: string, path: string): AssetEntry => ({
  key,
  id: key,
  kind,
  path,
  created: { at: 0, by: "seed" },
});

function seed() {
  const host = memoryDocHost();
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: { yard: entry("yard", "scene", "yard.json") },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(yard(), { doc: host.doc("scene:p.yard"), key: sequentialKeys("t") });
  return host;
}

const games: GameInstance[] = [];
const sessions: ProjectSession[] = [];
const editors: LiveEditor[] = [];

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // No storage: the toggle starts off either way.
  }
  for (const fn of [toast, toast.error, toast.warning, toast.success]) fn.mockReset();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
  for (const s of sessions.splice(0)) s.destroy();
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Ada playing the yard with Live in Play on, and Bob in the same project making the edits. */
async function setup() {
  const log: string[] = [];
  const def = treeGame(log);
  const registry = createRegistry(def);
  const kinds = createKindRegistry(def, [sceneKind, prefabKind]);
  const host = seed();
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const game = await createGame(canvas, { game: def, registry, dev: true });
  games.push(game);
  game.start();

  const join = async (who: string) => {
    const identity = editorIdentity(who);
    const session = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: identity.origin,
      registry,
      kinds,
    });
    sessions.push(session);
    await prefabsReady(session);
    const scene = await session.open("scene:p.yard");
    return { identity, session, scene };
  };

  const ada = await join("Ada");
  const live = openLiveEditor({
    game,
    doc: ada.scene.doc,
    name: "yard",
    identity: ada.identity,
    notify: toast,
    issuesDebounceMs: 0,
    project: { session: ada.session, doc: "scene:p.yard" },
  });
  editors.push(live);

  const bob = await join("Bob");
  const remote = openLiveEditor({
    game: fakeWorldGame(registry).game,
    doc: bob.scene.doc,
    name: "yard",
    identity: bob.identity,
    notify: toast,
    issuesDebounceMs: 0,
    project: { session: bob.session, doc: "scene:p.yard" },
  });
  editors.push(remote);

  const frame = createRef<EditorFrameHandle>();
  render(
    <EditorFrame
      frameRef={frame}
      topLeft={null}
      {...editorChrome({
        session: live.session,
        host: live.host,
        game,
        onPlay: live.play,
        onReplay: live.replay,
        onStop: live.stop,
        onRestart: live.restart,
        onLivePlay: live.setLivePlay,
        notify: toast,
      })}
    >
      <canvas />
    </EditorFrame>,
  );

  const world = () => game.runtime() as SceneRuntimeHandle | null;
  const edit = (ops: OpBatch["ops"]) =>
    act(() => {
      const result = remote.session.dispatch({ ops });
      expect(result.ok).toBe(true);
    });
  const status = () => live.host.state.livePlay?.status ?? null;
  /** Waits out the debounce and the build until the game holds the update, then runs the tick that takes it. */
  const takes = async () => {
    await vi.waitFor(() => expect(game.live.pending().map((p) => p.scene)).toEqual(["yard"]), {
      timeout: 5_000,
    });
    act(() => game.step());
  };

  act(() => void live.play());
  fireEvent.click(screen.getByRole("switch", { name: "Live in Play" }));
  act(() => game.step(3));
  return { game, log, world, edit, status, takes };
}

const pose = (rt: SceneRuntimeHandle, id: string) => {
  const p = rt.ctx.poses.get(id);
  if (!p) throw new Error(`${id} has no pose`);
  return { x: p.x, y: p.y };
};

const near = (got: { x: number; y: number }, want: { x: number; y: number }) => {
  expect(got.x).toBeCloseTo(want.x, 6);
  expect(got.y).toBeCloseTo(want.y, 6);
};

describe("Live in Play with a reparent", () => {
  it("moves an entity under a node in the running game, where it stands, without a reload", async () => {
    const t = await setup();
    const before = t.world()!;
    const tick = before.ctx.tick;
    const eye = pose(before, "eye");
    expect(before.ctx.tree.parent("eye")).toBeNull();

    t.edit([{ op: "reparent", refs: ["eye"], parent: "pivot" }]);
    await t.takes();

    const rt = t.world()!;
    expect(rt).toBe(before);
    expect(rt.ctx.tick).toBe(tick + 1);
    expect(rt.ctx.tree.parent("eye")).toBe("pivot");
    expect(rt.ctx.tree.children("pivot")).toEqual(["lamp", "eye"]);
    near(pose(rt, "eye"), eye);
    expect(t.log).toEqual(["onSwap reconcile now"]);
    expect(t.status()?.tone).toBe("applied");
    expect(t.status()?.text).not.toMatch(/reloaded/);
    expect(screen.queryByText("Scene changed")).toBeNull();
  });

  it("carries the new child with its parent's next move, and lets it go when moved back to the root", async () => {
    const t = await setup();
    t.edit([{ op: "reparent", refs: ["eye"], parent: "pivot" }]);
    await t.takes();
    const eye = pose(t.world()!, "eye");

    t.edit([{ op: "move", refs: ["pivot"], by: [1, -2] }]);
    await t.takes();
    near(pose(t.world()!, "eye"), { x: eye.x + 1, y: eye.y - 2 });
    expect(t.world()!.ctx.tree.parent("eye")).toBe("pivot");

    t.edit([{ op: "reparent", refs: ["eye"], parent: null }]);
    await t.takes();
    const rt = t.world()!;
    expect(rt.ctx.tree.parent("eye")).toBeNull();
    expect(rt.ctx.tree.children("pivot")).toEqual(["lamp"]);
    near(pose(rt, "eye"), { x: eye.x + 1, y: eye.y - 2 });
    expect(t.log).toEqual(Array(3).fill("onSwap reconcile now"));
  });

  it("takes a reparent of a whole subtree under another root, its child coming along", async () => {
    const t = await setup();
    const lamp = pose(t.world()!, "lamp");
    t.edit([{ op: "reparent", refs: ["pivot"], parent: "flag" }]);
    await t.takes();
    const rt = t.world()!;
    expect(rt.ctx.tree.parent("pivot")).toBe("flag");
    expect(rt.ctx.tree.parent("lamp")).toBe("pivot");
    expect(rt.ctx.tree.subtree("flag")).toEqual(["flag", "pivot", "lamp"]);
    near(pose(rt, "lamp"), lamp);
    expect(t.log).toEqual(["onSwap reconcile now"]);
  });
});
