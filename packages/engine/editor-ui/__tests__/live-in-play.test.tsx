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
import { createRegistry, defineGame, type LiveDeclaration, type SceneSwap } from "../../game/index";
import { LIVE_CHECK_AGAIN_TICKS } from "../../game/live";
import type { GameInstance } from "../../index";
import { createKindRegistry, prefabKind, sceneKind, type AssetEntry } from "../../project/index";
import type { SceneRuntimeHandle } from "../../runtime/types";
import { makeIssue, SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/index";
import { EditorFrame, editorChrome, type EditorFrameHandle } from "../frame/EditorFrame";
import { LIVE_PLAY_KEY, LIVE_PLAY_TOOLTIP } from "../panels/EditorPlayBar";
import {
  editorIdentity,
  LIVE_PLAY_APPLYING,
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

/** The tick of each time the game's live check ran. */
const checkRuns: number[] = [];

/**
 * A physics-free game whose `onSwap` logs each swap and refuses one that
 * brings a `boom`, and whose live check flags a `hazard`.
 */
function liveGame(log: string[], live: LiveDeclaration) {
  return defineGame({
    id: "livy",
    types: [],
    actions: [],
    world: { physics: "none" },
    live: {
      ...live,
      check: (ctx) => {
        checkRuns.push(ctx.tick);
        return ctx.exists("hazard")
          ? [makeIssue("live-swap-failed", { message: "hazard under the spawn", entityIds: [] })]
          : [];
      },
    },
    createRuntime(ctx) {
      return {
        onSwap(swap: SceneSwap) {
          if (ctx.exists("boom")) throw new Error("boom can't be migrated");
          log.push(`onSwap ${swap.strategy} ${swap.timing}`);
        },
        snapshot: () => null,
      };
    },
  });
}

const hall = (): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "hall",
  bounds: [0, 0, 10, 10],
  entities: [{ id: "start", type: "marker", at: [1, 1] }],
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
      assets: { hall: entry("hall", "scene", "hall.json") },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(hall(), { doc: host.doc("scene:p.hall"), key: sequentialKeys("t") });
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
  checkRuns.length = 0;
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

/** Ada's editor on a real game, and Bob in the same project making the remote edits. */
async function setup(declared: LiveDeclaration = { timings: ["boundary", "now"] }) {
  const log: string[] = [];
  const def = liveGame(log, declared);
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
    const scene = await session.open("scene:p.hall");
    return { identity, session, scene };
  };

  const ada = await join("Ada");
  const live = openLiveEditor({
    game,
    doc: ada.scene.doc,
    name: "hall",
    identity: ada.identity,
    notify: toast,
    issuesDebounceMs: 0,
    project: { session: ada.session, doc: "scene:p.hall" },
  });
  editors.push(live);

  const bob = await join("Bob");
  const remote = openLiveEditor({
    game: fakeWorldGame(registry).game,
    doc: bob.scene.doc,
    name: "hall",
    identity: bob.identity,
    notify: toast,
    issuesDebounceMs: 0,
    project: { session: bob.session, doc: "scene:p.hall" },
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
  const edit = (ops: Parameters<typeof remote.session.dispatch>[0]["ops"]) =>
    act(() => {
      const result = remote.session.dispatch({ ops });
      expect(result.ok).toBe(true);
    });
  const addMarker = (id: string) =>
    edit([{ op: "add", entity: { id, type: "marker", at: [3, 1] } }]);
  const play = () => act(() => void live.play());
  const toggle = () => screen.getByRole("switch", { name: "Live in Play" });
  const status = () => live.host.state.livePlay?.status ?? null;
  /** Waits out the debounce and the build until the game holds the update for its next tick. */
  const staged = () =>
    vi.waitFor(() => expect(game.live.pending().map((p) => p.scene)).toEqual(["hall"]), {
      timeout: 5_000,
    });
  return { game, live, log, world, edit, addMarker, play, toggle, status, staged, frame };
}

describe("Live in Play", () => {
  it("is off by default, and a remote edit during Play leaves the running world untouched", async () => {
    const t = await setup();
    t.play();
    expect(t.toggle().getAttribute("aria-checked")).toBe("false");
    t.addMarker("well");
    await new Promise((done) => setTimeout(done, 450));
    act(() => t.game.step(2));
    expect(t.world()?.get("well")).toBeUndefined();
    expect(t.game.live.pending()).toEqual([]);
    expect(t.log).toEqual([]);
    expect(t.status()).toBeNull();
    expect(screen.getByText("Scene changed")).toBeTruthy();
  });

  it("applies an edit after the debounce through swap and onSwap, saying how", async () => {
    const t = await setup();
    t.play();
    fireEvent.click(t.toggle());
    expect(t.toggle().getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(LIVE_PLAY_KEY)).toBe("true");

    t.addMarker("well");
    // Within the debounce nothing has started.
    expect(t.status()).toBeNull();
    await vi.waitFor(() => expect(t.status()?.text).toBe(LIVE_PLAY_APPLYING), { timeout: 2_000 });
    await t.staged();
    expect(t.world()?.get("well")).toBeUndefined();

    act(() => t.game.step());
    expect(t.world()?.get("well")).toBeDefined();
    expect(t.log).toEqual(["onSwap reconcile now"]);
    expect(t.world()?.ctx.live.version).toBe(t.game.live.current("hall"));
    expect(t.status()).toMatchObject({
      tone: "applied",
      text: "Live update applied (reconcile, 1 changed)",
    });
    expect(screen.getByText("Live update applied (reconcile, 1 changed)")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(
      "Live update applied",
      expect.objectContaining({ description: "(reconcile, 1 changed)" }),
    );
    // The edit reached the game, so Restart isn't offered.
    expect(screen.queryByText("Scene changed")).toBeNull();
  });

  it("reloads on a header edit", async () => {
    const t = await setup();
    t.play();
    fireEvent.click(t.toggle());
    t.edit([{ op: "setScene", set: { bounds: [0, 0, 12, 10] } }]);
    await t.staged();
    act(() => t.game.step());
    expect(t.log).toEqual(["onSwap reload now"]);
    expect(t.world()?.ctx.bounds).toEqual([0, 0, 12, 10]);
    expect(t.status()?.text).toMatch(/^Live update applied \(reload, /);
  });

  it("shows a failing onSwap's issue, and Play carries on", async () => {
    const t = await setup();
    t.play();
    fireEvent.click(t.toggle());
    t.addMarker("boom");
    await t.staged();
    act(() => t.game.step());
    expect(t.world()?.get("boom")).toBeUndefined();
    expect(t.status()).toMatchObject({ tone: "failed" });
    expect(t.status()?.text).toBe("Live update failed: boom can't be migrated");
    const line = screen.getByText("Live update failed: boom can't be migrated");
    // Cut short in its island, the line takes focus for the hint that holds all of it.
    expect(line.getAttribute("tabindex")).toBe("0");
    act(() => line.focus());
    const hint = await screen.findByText(
      /couldn't be applied while playing/,
      {},
      { timeout: 2_000 },
    );
    expect(hint.textContent).toContain("boom can't be migrated");
    expect(toast.error).toHaveBeenCalledWith("Live update failed", expect.anything());

    const tick = t.world()!.ctx.tick;
    act(() => t.game.step(3));
    expect(t.game.getMode()).toBe("play");
    expect(t.world()!.ctx.tick).toBe(tick + 3);
  });

  it("runs the game's live check right after the swap and keeps its issues for the problems panel", async () => {
    const t = await setup();
    t.play();
    fireEvent.click(t.toggle());
    t.addMarker("hazard");
    await t.staged();
    act(() => t.game.step());
    expect(t.status()?.text).toBe("Live update applied (reconcile, 1 changed) · 1 check issue");
    expect(t.live.host.state.livePlay?.checks.map((i) => i.message)).toEqual([
      "hazard under the spawn",
    ]);
    act(() => t.live.stop());
    expect(t.live.host.state.livePlay?.checks).toHaveLength(1);
    act(() => t.frame.current?.openPanel("problems"));
    const problems = await screen.findByRole("region", { name: "Problems" });
    expect(problems.textContent).toContain("hazard under the spawn");
    // Stop puts the scene back on the release's own, and the next Play starts clean.
    expect(t.game.live.current("hall")).toBeNull();
    t.play();
    expect(t.live.host.state.livePlay?.checks).toEqual([]);
  });

  it("runs the live check again 60 ticks after the swap, keeping each issue once", async () => {
    const t = await setup();
    t.play();
    fireEvent.click(t.toggle());
    t.addMarker("hazard");
    await t.staged();
    act(() => t.game.step());
    expect(checkRuns).toHaveLength(1);
    act(() => t.game.step(LIVE_CHECK_AGAIN_TICKS - 1));
    expect(checkRuns).toHaveLength(1);
    act(() => t.game.step());
    expect(checkRuns).toHaveLength(2);
    expect(checkRuns[1]! - checkRuns[0]!).toBe(LIVE_CHECK_AGAIN_TICKS);
    expect(t.live.host.state.livePlay?.checks.map((i) => i.message)).toEqual([
      "hazard under the spawn",
    ]);
    act(() => t.game.step(LIVE_CHECK_AGAIN_TICKS));
    expect(checkRuns).toHaveLength(2);
  });

  it("keeps a failed update's issue for the problems panel after Stop, until one applies", async () => {
    const t = await setup();
    t.play();
    fireEvent.click(t.toggle());
    t.addMarker("boom");
    await t.staged();
    act(() => t.game.step());
    const failed = () =>
      t.live.host.state.livePlay?.checks.filter((i) => i.code === "live-swap-failed") ?? [];
    expect(failed().map((i) => i.hint)).toEqual(["boom can't be migrated"]);
    act(() => t.live.stop());
    expect(failed()).toHaveLength(1);
    t.play();
    expect(t.live.host.state.livePlay?.checks).toEqual([]);
  });

  it("replays a Live in Play run with the versions it built", async () => {
    const t = await setup();
    t.play();
    fireEvent.click(t.toggle());
    t.addMarker("well");
    await t.staged();
    act(() => t.game.step());
    act(() => t.game.step(3));
    act(() => t.live.stop());
    const recording = t.game.recording();
    expect(recording?.swaps).toHaveLength(1);
    const swap = recording!.swaps![0]!;
    let replayed = false;
    act(() => void (replayed = t.live.replay(recording!)));
    expect(replayed).toBe(true);
    expect(t.world()?.ctx.live.version).toBeNull();
    act(() => t.game.step(swap.tick + 1));
    expect(t.world()?.ctx.live.version).toBe(swap.version);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("holds the game's clamp and says when the update will apply", async () => {
    const t = await setup({ timings: [] });
    t.play();
    fireEvent.click(t.toggle());
    t.addMarker("well");
    await vi.waitFor(() => expect(t.status()?.tone).toBe("waiting"), { timeout: 5_000 });
    expect(t.status()?.text).toBe(
      "Live update applies at the next load: this game accepts only next load",
    );
    act(() => t.game.step(2));
    expect(t.world()?.get("well")).toBeUndefined();
    expect(t.log).toEqual([]);
  });

  it("takes the viewer's stored choice at Play, and turning it off leaves Play isolated", async () => {
    localStorage.setItem(LIVE_PLAY_KEY, "true");
    const t = await setup();
    t.play();
    expect(t.toggle().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(t.toggle());
    expect(localStorage.getItem(LIVE_PLAY_KEY)).toBe("false");
    t.addMarker("well");
    await new Promise((done) => setTimeout(done, 450));
    act(() => t.game.step());
    expect(t.world()?.get("well")).toBeUndefined();
  });

  it("is unavailable, with the reason in place of the tooltip, for a game without live updates", () => {
    const live = openLiveEditor({
      game: fakeWorldGame(createRegistry()).game,
      doc: sceneToDoc(hall()),
      name: "hall",
      identity: editorIdentity("Ada"),
      notify: toast,
      issuesDebounceMs: 0,
    });
    editors.push(live);
    expect(live.host.state.livePlay).toMatchObject({
      on: false,
      unavailable: "This editor's game doesn't take live updates.",
    });
    live.setLivePlay(true);
    expect(live.host.state.livePlay?.on).toBe(false);
    expect(LIVE_PLAY_TOOLTIP).toBe(
      "Apply edits to the running game, the way players get a live update",
    );
  });
});
