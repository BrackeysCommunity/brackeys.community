// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import type { EntityInspection, EntityRow } from "../../debug/inspect";
import { createEditorSession, type SceneDefinition, type SceneIssue } from "../../editor/index";
import { createRegistry } from "../../game/index";
import type { GameStoreState } from "../../index";
import type { AssetKey } from "../../project/index";
import type { ToolConsumer, ToolEvent } from "../../tool-router";
import type { Vec2 } from "../../types";
import { KitProvider } from "../kit/index";
import { PLAY_REFRESH_MS, PlayInspector, type PlayInspectorGame } from "../panels/PlayInspector";
import { createPanelContext, panelDef, type PanelControls } from "../panels/registry";
import { SpawnedGroup } from "../panels/SpawnedGroup";
import { fakeGameDebug } from "./fake-world-game";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const scene = (): SceneDefinition => ({
  v: 1,
  name: "play-yard",
  bounds: [0, 0, 2000, 1200],
  entities: [{ id: "pad", type: "marker", at: [10, 10] }],
});

function inspection(id: string, over: Partial<EntityInspection> = {}): EntityInspection {
  return {
    id,
    type: "bullet",
    enabled: true,
    pose: { x: 1.5, y: 2, rot: 0 },
    prevPose: { x: 1.4, y: 2, rot: 0 },
    entity: { id, type: "bullet" } as EntityInspection["entity"],
    system: undefined,
    behaviors: {},
    body: null,
    timers: [],
    contacts: [],
    ...over,
  };
}

function setup(world: { inspect: (id: string) => Promise<EntityInspection | null> }) {
  const session = createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("t") }),
    origin: ada,
    name: "play-yard",
    registry,
    issuesDebounceMs: 0,
  });
  const store = new Store({ mode: "play", tick: 0 } as unknown as GameStoreState);
  const consumers: ToolConsumer[] = [];
  const rows: EntityRow[] = [];
  const game = {
    registry,
    getStore: () => store,
    screenToWorld: (p: Vec2): Vec2 => ({ x: p.x / 100, y: p.y / 100 }),
    router: {
      register(c: ToolConsumer) {
        consumers.push(c);
        return () => consumers.splice(consumers.indexOf(c), 1);
      },
    },
    debug: {
      ...fakeGameDebug(),
      inspect: vi.fn(world.inspect),
      entities: vi.fn(async () => [...rows]),
      pick: vi.fn(async (p: Vec2) => (p.x > 1 ? "bullet#2" : null)),
    },
  };
  const frame = async (ms = PLAY_REFRESH_MS) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
      store.setState((s) => ({ ...s, tick: s.tick + 1 }));
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(ms);
      await Promise.resolve();
    });
  };
  const click = (screenPt: Vec2, altKey = true) => {
    const e = {
      kind: "pointer",
      type: "down",
      screen: screenPt,
      button: 0,
      deltaY: 0,
      native: { altKey } as PointerEvent,
    } as ToolEvent;
    const taker = consumers.find((c) => c.accepts(e));
    act(() => taker?.handle(e));
    return taker !== undefined;
  };
  return { session, store, game, rows, frame, click, consumers };
}

const mount = (game: unknown, session: ReturnType<typeof setup>["session"]) =>
  render(
    <KitProvider host={{ storage: null }}>
      <PlayInspector
        game={game as PlayInspectorGame}
        session={session}
        notify={{ toast: () => {} } as never}
      />
      <SpawnedGroup game={game as PlayInspectorGame} session={session} />
    </KitProvider>,
  );

const facts = (label: string) => {
  const dl = document.querySelector(`dl[aria-label="${label}"]`);
  if (!dl) throw new Error(`no ${label} facts`);
  return dl;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the play inspector", () => {
  it("shows a spawned entity's velocity, refreshed as frames render", async () => {
    vi.useFakeTimers();
    let vx = 3;
    const t = setup({
      inspect: async (id) =>
        id === "bullet#2"
          ? inspection(id, { body: { velocity: { x: vx, y: -1.25 }, angular: 0, sleeping: false } })
          : null,
    });
    t.rows.push({ id: "bullet#2", type: "bullet", enabled: true, at: { x: 1, y: 2 } });
    mount(t.game, t.session);
    await t.frame();
    const spawned = screen.getByRole("region", { name: "Spawned" });
    act(() => within(spawned).getByText("bullet#2").click());
    await t.frame();
    const body = facts("Body");
    expect(body.textContent).toContain("3 m/s");
    expect(body.textContent).toContain("-1.25 m/s");
    expect(facts("Pose").textContent).toContain("1.5 m");

    vx = 4.5;
    await t.frame();
    expect(facts("Body").textContent).toContain("4.5 m/s");
  });

  it("picks the entity under an Alt+click on the canvas, leaving plain clicks to the game", async () => {
    vi.useFakeTimers();
    const t = setup({ inspect: async (id) => inspection(id) });
    mount(t.game, t.session);
    expect(t.click({ x: 300, y: 50 }, false)).toBe(false);
    expect(t.click({ x: 300, y: 50 })).toBe(true);
    await t.frame();
    expect(t.game.debug.pick).toHaveBeenCalledWith({ x: 3, y: 0.5 });
    expect(screen.getByLabelText("Play inspector").textContent).toContain("bullet#2");
  });

  it("lets a newer answer win over a slower, older one", async () => {
    vi.useFakeTimers();
    const slow: ((v: EntityInspection) => void)[] = [];
    const t = setup({
      inspect: (id) =>
        id === "pad"
          ? new Promise((resolve) => slow.push(resolve))
          : Promise.resolve(inspection(id, { type: "fast" })),
    });
    act(() => t.session.select(["pad"]));
    mount(t.game, t.session);
    expect(screen.getByLabelText("Play inspector").textContent).toContain("Reading pad");
    t.click({ x: 300, y: 0 });
    await t.frame();
    await act(async () => slow[0]?.(inspection("pad", { type: "stale" })));
    const panel = screen.getByLabelText("Play inspector");
    expect(panel.textContent).toContain("fast");
    expect(panel.textContent).not.toContain("stale");
  });

  it("says when nothing is picked and when the pick isn't live", async () => {
    vi.useFakeTimers();
    const t = setup({ inspect: async () => null });
    mount(t.game, t.session);
    expect(screen.getByLabelText("Play inspector").textContent).toContain("Select an entity");
    act(() => t.session.select(["pad"]));
    await t.frame();
    expect(screen.getByLabelText("Play inspector").textContent).toContain("pad isn't live");
  });
});

describe("the Spawned group", () => {
  it("lists runtime-spawned ids and leaves the scene's own out", async () => {
    vi.useFakeTimers();
    const t = setup({ inspect: async () => null });
    t.rows.push(
      { id: "pad", type: "marker", enabled: true, at: { x: 0.1, y: 0.1 } },
      { id: "bullet#1", type: "bullet", enabled: true, at: null },
    );
    mount(t.game, t.session);
    await t.frame();
    const spawned = screen.getByRole("region", { name: "Spawned" });
    expect(within(spawned).getByText("bullet#1")).toBeTruthy();
    expect(within(spawned).queryByText("pad")).toBeNull();

    t.rows.push({ id: "bullet#2", type: "bullet", enabled: true, at: null });
    await t.frame();
    expect(within(spawned).getByText("bullet#2")).toBeTruthy();
  });
});

describe("the inspector panel", () => {
  it("shows the play inspector and Spawned group in Play, and the edit inspector once Play stops", async () => {
    const t = setup({ inspect: async () => null });
    act(() => t.session.select(["pad"]));
    const controls = {
      session: t.session,
      game: t.game,
      notify: { toast: () => {} },
    } as unknown as PanelControls;
    const ctx = createPanelContext({
      openPanel: () => {},
      controls,
      physical: new Store<readonly SceneIssue[]>([]),
      pickedAsset: new Store<AssetKey | null>(null),
    });
    render(
      <KitProvider host={{ storage: null }}>
        {panelDef("inspector")!.render(ctx)}
        {panelDef("outliner")!.render(ctx)}
      </KitProvider>,
    );
    expect(screen.getByLabelText("Play inspector")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Spawned" })).toBeTruthy();
    expect(t.consumers).toHaveLength(1);

    act(() => t.store.setState((s) => ({ ...s, mode: "edit" })));
    expect(screen.queryByLabelText("Play inspector")).toBeNull();
    expect(screen.queryByRole("region", { name: "Spawned" })).toBeNull();
    expect(screen.getByLabelText("Inspector")).toBeTruthy();
    expect(t.consumers).toHaveLength(0);
  });
});
