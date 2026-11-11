// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type LogEntry, type SceneOrigin } from "../../collab/index";
import {
  createEditorSession,
  type EditorSession,
  type SceneDefinition,
  type SceneIssue,
} from "../../editor/index";
import { createRegistry } from "../../game/index";
import type { RapierModule } from "../../headless/index";
import type { AssetKey } from "../../project/index";
import { RECORDING_VERSION, type RunRecording } from "../../scene/index";
import { EditorFrame } from "../frame/EditorFrame";
import { PanelGroup } from "../frame/PanelGroup";
import type { EditorNotify, EditorStorage } from "../host";
import { KitProvider } from "../kit/index";
import type { Viewport } from "../layout/model";
import { useLayout } from "../layout/use-layout";
import { EditorHistory, foldHistory, HISTORY_FOLD_MS } from "../panels/EditorHistory";
import { createPanelContext, PANEL_IDS, type PanelContext } from "../panels/registry";
import { createPending, type Pending } from "../pending/pending";
import { PendingProvider } from "../pending/use-pending";
import type { LoadedRun } from "../session/loaded-run";
import { usePhysicalIssues } from "../session/use-physical-issues";

// jsdom has no WebGL, so the Pixi application is a stand-in; the containers are real.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return {
    ...pixi,
    Application,
    Assets: { load: async () => pixi.Texture.WHITE, unload: async () => {} },
  };
});

const fakeNotify = (): EditorNotify =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const VIEWPORT: Viewport = { width: 1440, height: 900, topLeft: 48, topRight: 0, bottom: 40 };

const yard: SceneDefinition = {
  v: 1,
  name: "density-yard",
  bounds: [0, 0, 2000, 1200],
  entities: [
    { id: "pad", type: "marker", at: [1000, 1010] },
    { id: "floor", type: "solid", shape: ["box", 500, 900, 200, 20] },
  ],
};

const sessionOf = (def: SceneDefinition = yard) =>
  createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: def.name,
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });

function memoryStorage(): EditorStorage {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

function contextFor(session: EditorSession, runStore = new Store<LoadedRun | null>(null)) {
  return createPanelContext({
    openPanel: vi.fn(),
    controls: {
      session,
      notify: fakeNotify(),
      runStore,
      playFrom: vi.fn(),
      onReplay: vi.fn(),
      frame: () => true,
    },
    physical: new Store<readonly SceneIssue[]>([]),
    pickedAsset: new Store<AssetKey | null>(null),
  });
}

const padX = (session: EditorSession) =>
  (session.getDoc().entities!.find((e) => e.id === "pad") as unknown as { at: [number, number] })
    .at[0];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("History's density", () => {
  function nudgeSixTimes(session: EditorSession) {
    for (let i = 0; i < 6; i++)
      act(() => {
        session.dispatch({ label: "Nudge pad", ops: [{ op: "move", refs: ["pad"], by: [1, 0] }] });
      });
  }

  it("folds six identical consecutive entries into one row with a count, which expands", () => {
    const session = sessionOf();
    render(<EditorHistory session={session} notify={fakeNotify()} />);
    nudgeSixTimes(session);

    const list = screen.getByRole("region", { name: "History" }).querySelector("ul")!;
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.getAttribute("aria-label")).toBe("Nudge pad ×6");
    expect(within(row).getByText("×6")).toBeTruthy();
    expect(within(row).getByText("You")).toBeTruthy();
    expect(within(row).getAllByRole("button", { name: "Revert" })).toHaveLength(1);

    fireEvent.click(within(row).getByRole("button", { name: "Expand Nudge pad ×6" }));
    const each = within(row).getByRole("list", { name: "Each Nudge pad" });
    expect(within(each).getAllByRole("listitem", { name: "Nudge pad" })).toHaveLength(6);
    expect(within(each).getAllByRole("button", { name: "Revert" })).toHaveLength(6);

    fireEvent.click(within(row).getByRole("button", { name: "Fold Nudge pad ×6" }));
    expect(within(row).queryByRole("list")).toBeNull();
  });

  it("reverts the newest entry from a folded row", () => {
    const session = sessionOf();
    const error = vi.fn();
    const notify: EditorNotify = Object.assign(vi.fn(), {
      error,
      warning: vi.fn(),
      success: vi.fn(),
    });
    render(<EditorHistory session={session} notify={notify} />);
    nudgeSixTimes(session);
    expect(padX(session)).toBe(1006);
    const newest = session.store.state.history.at(-1)!;
    const revert = vi.spyOn(session, "revert");

    const folded = screen.getByRole("listitem", { name: "Nudge pad ×6" });
    act(() => {
      fireEvent.click(within(folded).getByRole("button", { name: "Revert" }));
    });
    expect(revert).toHaveBeenCalledExactlyOnceWith(newest.id);
    expect(padX(session)).toBe(1005);
    const top = screen.getByRole("region", { name: "History" }).querySelector("ul > li")!;
    expect(top.getAttribute("aria-label")).toBe("Revert Nudge pad");
    expect(screen.getByRole("listitem", { name: "Nudge pad ×6" })).toBeTruthy();
    expect(error).not.toHaveBeenCalled();
  });

  it("folds only the same label and actor within the window", () => {
    const entry = (id: string, label: string, at: number, actor: SceneOrigin = ada): LogEntry => ({
      id,
      label,
      at,
      actor,
      keys: [],
    });
    const bob: SceneOrigin = { kind: "user", userId: "bob" };
    const runs = foldHistory([
      entry("f", "Move", 10 * HISTORY_FOLD_MS),
      entry("e", "Move", 9 * HISTORY_FOLD_MS),
      entry("d", "Move", 9 * HISTORY_FOLD_MS - 1, bob),
      entry("c", "Move", 7 * HISTORY_FOLD_MS),
      entry("b", "Move", 7 * HISTORY_FOLD_MS - 10),
      entry("a", "Rotate", 7 * HISTORY_FOLD_MS - 20),
    ]);
    expect(runs.map((r) => r.map((e) => e.id))).toEqual([["f", "e"], ["d"], ["c", "b"], ["a"]]);
  });
});

describe("Problems' busy tab", () => {
  let rapier: RapierModule;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
  });

  function Watch({ session, store }: { session: EditorSession; store: PanelContext["physical"] }) {
    const issues = usePhysicalIssues(session, rapier);
    useEffect(() => store.setState(() => issues), [issues, store]);
    return null;
  }

  function Groups({ ctx }: { ctx: PanelContext }) {
    const layout = useLayout(memoryStorage(), PANEL_IDS);
    return (
      <>
        {layout.layout.right.groups.map((_, i) => (
          <PanelGroup
            key={i}
            side="right"
            index={i as 0 | 1}
            layout={layout}
            viewport={VIEWPORT}
            ctx={ctx}
          />
        ))}
      </>
    );
  }

  it("is busy from a doc change until its check lands", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const session = sessionOf();
    const ctx = contextFor(session);
    const pending: Pending = createPending({ notify: fakeNotify() });
    render(
      <KitProvider host={{}}>
        <PendingProvider pending={pending}>
          <Groups ctx={ctx} />
          <Watch session={session} store={ctx.physical} />
        </PendingProvider>
      </KitProvider>,
    );
    const problems = () => screen.getByRole("tab", { name: /Problems/ });

    expect(problems().getAttribute("aria-busy")).toBe("true");
    act(() => vi.advanceTimersByTime(400));
    expect(problems().getAttribute("aria-busy")).toBeNull();
    expect(ctx.physical.state).toEqual([]);

    act(() => {
      session.dispatch({
        ops: [
          {
            op: "add",
            entity: { id: "slab", type: "solid", shape: ["box", 520, 900, 200, 20] },
          },
        ],
      });
    });
    expect(problems().getAttribute("aria-busy")).toBe("true");
    expect(pending.busy("panel:problems")?.label).toBe("Checking the scene");
    act(() => vi.advanceTimersByTime(250));
    // A second change in the window restarts the check and keeps the one task.
    const task = pending.busy("panel:problems");
    act(() => {
      session.dispatch({ ops: [{ op: "move", refs: ["pad"], by: [1, 0] }] });
    });
    expect(pending.busy("panel:problems")).toBe(task);
    act(() => vi.advanceTimersByTime(399));
    expect(problems().getAttribute("aria-busy")).toBe("true");
    expect(ctx.physical.state).toEqual([]);

    act(() => vi.advanceTimersByTime(1));
    expect(problems().getAttribute("aria-busy")).toBeNull();
    expect(ctx.physical.state.map((i) => i.code)).toEqual(["solid-overlap"]);
    expect(pending.store.state.tasks).toEqual([]);
  });

  it("drops its task when the editor unmounts mid-check", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const session = sessionOf();
    const pending = createPending({ notify: fakeNotify() });
    const view = render(
      <PendingProvider pending={pending}>
        <Watch session={session} store={new Store<readonly SceneIssue[]>([])} />
      </PendingProvider>,
    );
    expect(pending.busy("panel:problems")).toBeDefined();
    view.unmount();
    expect(pending.store.state.tasks).toEqual([]);
  });
});

describe("the Run panel's height", () => {
  const run = (markers: number): LoadedRun => {
    const recording: RunRecording = {
      v: RECORDING_VERSION,
      engine: { version: "0.0.0", physics: "rapier test" },
      platform: { arch: "unknown", runtime: "unknown", flavour: null },
      scene: "density-yard",
      sceneHash: "h",
      runHash: "",
      project: null,
      game: null,
      configHash: "c",
      time: { kind: "fixed", rate: 60 },
      seed: 0,
      start: {},
      players: [{ index: 0, devices: ["keyboard"] }],
      actions: [],
      commands: [],
      inputs: [[]],
      system: [],
      ticks: 600,
      outcome: { result: "timeout", tick: 599, at: null },
      markers: Array.from({ length: markers }, (_, i) => ({
        tick: i * 10,
        type: "touch",
        at: [i, 0] as [number, number],
        entityId: `crate-${i}`,
      })),
      end: "e",
    };
    return { recording, name: "Last run" };
  };

  it("keeps a 50-marker run's group at its height, the markers scrolling inside the panel", () => {
    Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
    const session = sessionOf();
    const runStore = new Store<LoadedRun | null>(null);
    const ctx = contextFor(session, runStore);
    render(
      <EditorFrame
        host={{ storage: memoryStorage() }}
        panels={{ context: ctx }}
        mode={new Store({ mode: "edit" })}
      >
        <canvas />
      </EditorFrame>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Run/ }));
    const region = screen.getByRole("region", { name: "Run" });
    const group = region.closest<HTMLElement>(".je-panel-group")!;
    const placed = group.closest<HTMLElement>("[style*='height']") ?? group;
    const before = placed.style.height;
    expect(before).toMatch(/px$/);

    act(() => runStore.setState(() => run(60)));
    expect(placed.style.height).toBe(before);
    const markers = within(region).getByRole("list", { name: "Run markers" });
    expect(markers.classList.contains("je-scene-panel-scroll")).toBe(true);
    expect(within(markers).getAllByRole("listitem")).toHaveLength(51);
    expect(within(markers).getByText("and 10 more")).toBeTruthy();
    // The summary and its actions sit outside the scroller.
    expect(markers.contains(within(region).getByRole("button", { name: "Replay" }))).toBe(false);
  });
});
