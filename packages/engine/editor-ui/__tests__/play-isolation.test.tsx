// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  applyOpsToDoc,
  docToScene,
  sceneToDoc,
  sequentialKeys,
  type SceneOrigin,
} from "../../collab/index";
import { createEditorSession, type EditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { expandScene, type ExpandedScene } from "../../scene/index";
import { EditorFrame, editorChrome } from "../frame/EditorFrame";
import { editorIdentity, openLiveEditor } from "../session/live-scene-editor";
import { fakeWorldGame } from "./fake-world-game";

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
);

const registry = createRegistry();
const bo: SceneOrigin = { kind: "user", userId: "bo", name: "Bo" };
const agent: SceneOrigin = { kind: "agent", agentId: "claude", onBehalfOf: "Ada" };

function scene(): SceneDefinition {
  return {
    v: 1,
    name: "play-yard",
    bounds: [0, 0, 2000, 1200],
    solid: [["box", 500, 1040, 500, 20]],
    entities: [
      { id: "zone", type: "sensor", shape: ["circle", 900, 600, 12], tags: ["goal"] },
      { id: "pad", type: "marker", at: [1000, 1010] },
    ],
  };
}

function linkedDocs() {
  const server = sceneToDoc(scene(), { key: sequentialKeys("srv") });
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  for (const d of [docA, docB]) Y.applyUpdate(d, Y.encodeStateAsUpdate(server));
  for (const [from, to] of [
    [docA, docB],
    [docB, docA],
  ] as const) {
    from.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "net") Y.applyUpdate(to, u, "net");
    });
  }
  return { docA, docB };
}

const pad = (w: ExpandedScene | null) => w?.entities.find((e) => e.id === "pad");
const latest = (doc: Y.Doc) => expandScene(docToScene(doc), registry);

function setup() {
  const { docA, docB } = linkedDocs();
  const fake = fakeWorldGame(registry);
  const live = openLiveEditor({
    game: fake.game,
    doc: docA,
    name: "play-yard",
    identity: editorIdentity("Ada"),
    notify: toast,
    issuesDebounceMs: 0,
  });
  const remote: EditorSession = createEditorSession({
    doc: docB,
    origin: bo,
    name: "play-yard",
    registry,
    issuesDebounceMs: 0,
  });
  render(
    <EditorFrame
      topLeft={null}
      {...editorChrome({
        session: live.session,
        host: live.host,
        game: fake.game,
        onPlay: live.play,
        onReplay: live.replay,
        onStop: live.stop,
        onRestart: live.restart,
        notify: toast,
      })}
    >
      <canvas />
    </EditorFrame>,
  );
  const movePad = (x: number) =>
    act(() => {
      remote.dispatch({ ops: [{ op: "update", ref: "pad", set: { at: [x, 1010] } }] });
    });
  return { docA, docB, live, remote, movePad, ...fake };
}

beforeEach(() => {
  toast.mockReset();
  for (const fn of [toast.error, toast.warning, toast.success]) fn.mockReset();
});
afterEach(cleanup);

describe("play isolation", () => {
  it("keeps the edit world in step with remote edits", () => {
    const { movePad, world, runtime, docA } = setup();
    expect(world()).toEqual(latest(docA));
    movePad(1100);
    expect(runtime.update).toHaveBeenCalledOnce();
    expect(pad(world())).toMatchObject({ at: [1100, 1010] });
  });

  it("plays a snapshot that remote edits don't touch, then Stop picks them up", () => {
    const { movePad, world, calls, docA, live, game } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(game.getMode()).toBe("play");
    expect(live.session.store.state.mode).toBe("play");
    expect(screen.queryByText("Scene changed")).toBeNull();

    const played = structuredClone(world());
    const before = calls();
    movePad(1100);
    movePad(1200);

    expect(calls()).toBe(before);
    expect(world()).toEqual(played);
    expect(pad(world())).toMatchObject({ at: [1000, 1010] });
    expect(screen.getByText("Scene changed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(game.getMode()).toBe("edit");
    expect(world()).toEqual(latest(docA));
    expect(pad(world())).toMatchObject({ at: [1200, 1010] });
    expect(screen.queryByText("Scene changed")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Outliner" })).toBeTruthy();
  });

  it("restarts play from the latest doc and stays isolated afterwards", () => {
    const { movePad, world, calls, docA, game } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    movePad(1100);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));

    expect(game.getMode()).toBe("play");
    expect(world()).toEqual(latest(docA));
    expect(screen.queryByText("Scene changed")).toBeNull();

    const before = calls();
    movePad(1300);
    expect(calls()).toBe(before);
    expect(pad(world())).toMatchObject({ at: [1100, 1010] });
    expect(screen.getByText("Scene changed")).toBeTruthy();
  });

  it("resumes binding after Stop: the next remote edit reconciles the edit world", () => {
    const { movePad, world, runtime } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    runtime.update.mockClear();
    movePad(1400);
    expect(runtime.update).toHaveBeenCalledOnce();
    expect(pad(world())).toMatchObject({ at: [1400, 1010] });
  });
});

describe("live editor announcements", () => {
  it("toasts an agent's batch with its actor and label, but not a person's", () => {
    const { docB, movePad } = setup();
    movePad(1100);
    expect(toast).not.toHaveBeenCalled();

    act(() => {
      applyOpsToDoc(
        docB,
        {
          label: "Widen the goal",
          ops: [{ op: "update", ref: "zone", set: { tags: ["goal", "wide"] } }],
        },
        agent,
        registry,
      );
    });
    expect(toast).toHaveBeenCalledWith("claude for Ada edited the scene", {
      description: "Widen the goal",
    });
  });

  it("toasts a change from disk", () => {
    const { docB } = setup();
    act(() => {
      applyOpsToDoc(
        docB,
        { ops: [{ op: "update", ref: "pad", set: { at: [10, 10] } }] },
        { kind: "disk" },
        registry,
        { label: "Changed on disk" },
      );
    });
    expect(toast).toHaveBeenCalledWith("The scene file changed on disk", {
      description: "Changed on disk",
    });
  });
});
