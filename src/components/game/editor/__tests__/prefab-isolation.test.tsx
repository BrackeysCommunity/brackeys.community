// @vitest-environment jsdom
import { readLog, sceneToDoc, sequentialKeys } from "@jams/engine/collab";
import type { SceneDefinition } from "@jams/engine/editor";
import { createRegistry } from "@jams/engine/game";
import { prefabLibrary, type Prefab } from "@jams/engine/scene";
import { useStore } from "@tanstack/react-store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CanvasShell } from "@/components/canvas/shell/CanvasShell";
import { editorChrome } from "@/components/game/editor/EditorShell";
import {
  editorIdentity,
  openLiveEditor,
  type LiveEditor,
} from "@/components/game/live-scene-editor";

import { fakeWorldGame } from "./fake-world-game";

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
);
vi.mock("@/lib/toast", () => ({ toast }));

const registry = createRegistry();

const POST: Prefab = {
  kind: "prefab",
  v: 2,
  id: "post",
  entities: [{ id: "top", type: "marker", at: [0, -40] }],
  bulk: { solid: [["box", 0, 0, 6, 40]] },
};

function scene(): SceneDefinition {
  return {
    v: 2,
    name: "posts",
    bounds: [0, 0, 2000, 1200],
    groups: { east: { at: [1000, 0] } },
    instances: [
      { id: "post-1", prefab: "post", at: [100, 900] },
      { id: "post-2", prefab: "post", at: [300, 900] },
      { id: "post-3", prefab: "post", at: [100, 900], group: "east" },
    ],
  };
}

type Fake = ReturnType<typeof fakeWorldGame>;

/** The chrome as `useSceneEditor` builds it: on the scene, or on the prefab open in isolation. */
function Editor({ live, game }: { live: LiveEditor; game: Fake["game"] }) {
  const open = useStore(live.prefab);
  const chrome = useMemo(
    () =>
      editorChrome({
        ...live.editing(open),
        host: live.host,
        game,
        onPlay: live.play,
        onReplay: live.replay,
        onStop: live.stop,
        onRestart: live.restart,
      }),
    [live, game, open],
  );
  return (
    <CanvasShell topLeft={null} {...chrome}>
      <canvas />
    </CanvasShell>
  );
}

function setup() {
  const doc = sceneToDoc(scene(), { key: sequentialKeys("t"), prefabs: prefabLibrary([POST]) });
  const fake = fakeWorldGame(registry);
  const live = openLiveEditor({
    game: fake.game,
    doc,
    name: "posts",
    identity: editorIdentity("Ada"),
    issuesDebounceMs: 0,
  });
  render(<Editor live={live} game={fake.game} />);
  return { doc, live, ...fake };
}

const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));
const inspector = () => within(screen.getByLabelText("Inspector"));
const worldAt = (fake: Fake, id: string) => fake.world()!.entities.find((e) => e.id === id)?.at;
const topOf = (live: LiveEditor, instance: string) =>
  live.session.getResolved().entities!.find((e) => e.id === `${instance}/top`)!.at;

/** Edits the selected entity's `at.x` in the inspector. */
function setX(x: number) {
  const field = inspector().getByLabelText("at.x") as HTMLInputElement;
  fireEvent.change(field, { target: { value: String(x) } });
  fireEvent.keyDown(field, { key: "Enter" });
}

beforeEach(() => {
  toast.mockReset();
  for (const fn of [toast.error, toast.warning, toast.success]) fn.mockReset();
});
afterEach(cleanup);

describe("Open prefab", () => {
  it("opens from the inspector, edits in isolation, every instance follows, then Back", () => {
    const fake = setup();
    const { doc, live, game } = fake;
    act(() => live.session.select(["post-1"]));
    fireEvent.click(inspector().getByRole("button", { name: "Open prefab" }));

    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("posts›post");
    // The edit world holds the prefab alone, at its local coordinates.
    expect(worldAt(fake, "top")).toEqual([0, -40]);
    expect(worldAt(fake, "post-1/top")).toBeUndefined();
    expect(game.frame).toHaveBeenCalled();

    fireEvent.click(outliner().getByRole("button", { name: /^top/ }));
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    act(() => setX(10));

    expect(transactions).toBe(1);
    expect(readLog(doc).at(-1)!.label).toBe("Set Position in post");
    expect(worldAt(fake, "top")).toEqual([10, -40]);
    expect(topOf(live, "post-1")).toEqual([110, 860]);
    expect(topOf(live, "post-2")).toEqual([310, 860]);
    expect(topOf(live, "post-3")).toEqual([1110, 860]);

    // Undo here steps the scene's history: the prefab and every instance go back.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(worldAt(fake, "top")).toEqual([0, -40]);
    expect(topOf(live, "post-2")).toEqual([300, 860]);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    });
    expect(topOf(live, "post-2")).toEqual([310, 860]);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(worldAt(fake, "post-1/top")).toEqual([110, 860]);
    expect(worldAt(fake, "post-3/top")).toEqual([1110, 860]);
    expect(worldAt(fake, "top")).toBeUndefined();
    expect(outliner().getAllByText("prefab").length).toBe(3);
    // Back in the scene, its undo still covers the edit.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(topOf(live, "post-1")).toEqual([100, 860]);
  });

  it("opens from an instance row in the outliner", () => {
    const fake = setup();
    fireEvent.click(outliner().getAllByRole("button", { name: "Open prefab post" })[0]!);
    expect(fake.live.prefab.state?.isolation.prefab).toBe("post");
    expect(worldAt(fake, "top")).toEqual([0, -40]);
  });

  it("offers no Create prefab inside a prefab", () => {
    const fake = setup();
    act(() => {
      fake.live.openPrefab("post", "post-1");
    });
    fireEvent.click(outliner().getByRole("button", { name: /^top/ }));
    expect(inspector().queryByRole("button", { name: "Create prefab" })).toBeNull();
  });

  it("goes back to the scene when the prefab is deleted, and when Play starts", () => {
    const fake = setup();
    const { live, game } = fake;
    act(() => {
      live.openPrefab("post");
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });
    expect(live.prefab.state).toBeNull();
    expect(game.getMode()).toBe("play");
    act(() => live.stop());
    expect(worldAt(fake, "post-1/top")).toEqual([100, 860]);

    act(() => {
      live.openPrefab("post");
    });
    act(() => {
      live.session.dispatch({ ops: [{ op: "definePrefab", id: "post", prefab: null }] });
    });
    expect(live.prefab.state).toBeNull();
    expect(toast).toHaveBeenCalledWith("The prefab was deleted", expect.anything());
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });
});
