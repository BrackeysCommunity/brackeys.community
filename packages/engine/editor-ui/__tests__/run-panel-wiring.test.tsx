// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import type { RunRecording, StagedVersion } from "../../index";
import type { Sha256 } from "../../project/index";
import type { RecordedSwap } from "../../scene/recording-schema";
import { EditorFrame, editorChrome, type EditorFrameHandle } from "../frame/EditorFrame";
import type { EditorHostState } from "../session/live-scene-editor";
import { createLoadedRunStore } from "../session/loaded-run";
import { fakeWorldGame } from "./fake-world-game";

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

const notify = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });

afterEach(cleanup);

const scene: SceneDefinition = {
  v: 1,
  name: "run-yard",
  bounds: [0, 0, 2000, 1200],
  entities: [{ id: "pad", type: "marker", at: [100, 100] }],
};

const kept: Sha256 = "a".repeat(64);
const lost: Sha256 = "b".repeat(64);

const run = (patch: Partial<RunRecording>) =>
  ({
    scene: "run-yard",
    sceneHash: "h",
    ticks: 240,
    time: { kind: "fixed", rate: 60 },
    outcome: { result: "won", at: [0, 0], tick: 240 },
    markers: [],
    ...patch,
  }) as unknown as RunRecording;

const swap = (tick: number, version: Sha256): RecordedSwap => ({
  tick,
  version,
  strategy: "reconcile",
  timing: "now",
  sceneHash: "h",
  runHash: "r",
});

describe("the editor's Run panel", () => {
  it("checks a run's live versions against the ones the editor holds", () => {
    const registry = createRegistry();
    const session = createEditorSession({
      doc: sceneToDoc(scene, { key: sequentialKeys("t") }),
      origin: { kind: "user", userId: "ada", name: "Ada" },
      name: "run-yard",
      registry,
      issuesDebounceMs: 0,
    });
    const host = new Store<EditorHostState>({ connection: "live", sceneChanged: false });
    const { game } = fakeWorldGame(registry);
    const runStore = createLoadedRunStore();
    const onReplay = vi.fn();
    const frame = createRef<EditorFrameHandle>();
    render(
      <EditorFrame
        frameRef={frame}
        topLeft={null}
        {...editorChrome({
          session,
          host,
          game,
          notify,
          runStore,
          onPlay: vi.fn(),
          onReplay,
          onStop: vi.fn(),
          onRestart: vi.fn(),
          liveVersion: (id) => (id === kept ? ({ id } as unknown as StagedVersion) : null),
        })}
      >
        <canvas />
      </EditorFrame>,
    );
    act(() => frame.current?.openPanel("run"));
    const show = (recording: RunRecording) =>
      act(() => runStore.setState(() => ({ recording, name: "Last run" })));
    const panel = () => within(screen.getByRole("region", { name: "Run" }));
    const replay = () => panel().getByRole("button", { name: "Replay" });

    show(run({ sceneVersion: kept, swaps: [swap(30, kept)] }));
    expect(panel().getByText(/that this editor holds, so Replay plays all of it/)).toBeTruthy();
    fireEvent.click(replay());
    expect(onReplay).toHaveBeenCalledTimes(1);

    show(run({ swaps: [swap(30, kept), swap(90, lost)] }));
    expect(panel().getByText(/^Replay stops at 1\.5s/)).toBeTruthy();

    show(run({ sceneVersion: lost }));
    expect(panel().getByText(/can't replay here/)).toBeTruthy();
    expect(replay().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(replay());
    expect(onReplay).toHaveBeenCalledTimes(1);
  });
});
