// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import {
  sceneToDoc,
  sequentialKeys,
  type PrefabSource,
  type SceneOrigin,
} from "../../collab/index";
import { createEditorSession } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { runPlaytest, type PlaytestReport, type RapierModule } from "../../headless/index";
import {
  parsePrefab,
  parseSceneOrThrow,
  prefabLibrary,
  sceneHash,
  sceneHashWith,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
} from "../../scene/index";
import type { EditorNotify } from "../host";
import { LoadRunPanel } from "../panels/LoadRunPanel";
import {
  createLoadedRunStore,
  parseRun,
  runHashOf,
  runOverlay,
  runStart,
} from "../session/loaded-run";

const toasts = { error: vi.fn(), warning: vi.fn(), success: vi.fn() };
const notify: EditorNotify = Object.assign(vi.fn(), toasts);

const registry = createRegistry(testGame);
const yard = parseSceneOrThrow(
  readFileSync(resolve("packages/engine/scenes/engine-yard.json"), "utf8"),
  registry,
);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const parsedPost = parsePrefab(
  readFileSync(resolve("packages/engine/scenes/prefabs/post.json"), "utf8"),
  registry,
);
if (!parsedPost.ok) throw new Error("post.json doesn't parse");
const post: Prefab = parsedPost.prefab;
const yardWithPost: SceneDefinition = {
  ...yard,
  instances: [{ id: "post-1", prefab: "post", at: [1800, 960] }],
};

/** A prefab source whose library can be swapped, as a prefab doc edit does. */
function swappableSource(initial: PrefabLibrary) {
  let library = initial;
  const listeners = new Set<(changed: readonly string[]) => void>();
  const source: PrefabSource = {
    library: () => library,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    open: async () => null,
  };
  const set = (next: PrefabLibrary) => {
    library = next;
    for (const l of listeners) l(["post"]);
  };
  return { source, set };
}

let report: PlaytestReport;
/** The report as `scene playtest --json` prints it. */
let printed: string;
/** A run of `yardWithPost`, recorded with the post prefab. */
let withPost: PlaytestReport;

beforeAll(async () => {
  const rapier: RapierModule = await import("@dimforge/rapier2d");
  const placed = runPlaytest({
    rapier,
    game: testGame,
    registry,
    scene: yardWithPost,
    prefabs: prefabLibrary([post]),
    script: { v: 1, scene: "engine-yard", steps: [{ hold: ["right"], for: 30 }] },
  });
  if (placed.blocked) throw new Error(`blocked at ${placed.stage}`);
  withPost = placed;
  const run = runPlaytest({
    rapier,
    game: testGame,
    registry,
    scene: yard,
    script: { v: 1, scene: "engine-yard", steps: [{ hold: ["right"], for: 90 }] },
  });
  if (run.blocked) throw new Error(`blocked at ${run.stage}`);
  report = run;
  printed = JSON.stringify({ game: "test-game", ...run });
});

beforeEach(() => toasts.error.mockReset());

/** A marker shaped as a recording carries one. */
const marker = () => ({ type: "jump", at: [0, 0] as [number, number], tick: 0 });
afterEach(cleanup);

describe("loaded-run", () => {
  it("parses a printed report's recording and draws its trail, markers and outcome", () => {
    const parsed = parseRun(printed, "run.json");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.run.recording).toEqual(report.recording);
    const overlay = runOverlay(parsed.run);
    expect(report.trail.pts.length).toBeGreaterThan(0);
    expect(overlay.trail).toEqual(report.trail.pts);
    expect(overlay.events?.length ?? 0).toBe(report.recording.markers.length);
    expect(overlay.outcome).toMatchObject({ result: "script-end" });
    expect(runStart(parsed.run)).toEqual({});
  });

  it("parses a bare recording, and plays from its start options", () => {
    const recording = { ...report.recording, start: { at: [96, 40], timeOffsetMs: 250 } };
    const parsed = parseRun(JSON.stringify(recording), "pasted");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(runStart(parsed.run)).toEqual({ at: { x: 96, y: 40 }, timeOffsetMs: 250 });
  });

  it("hashes a scene with its prefabs as the recorder does, once per scene and library", () => {
    const library = prefabLibrary([post]);
    expect(runHashOf(yardWithPost, library)).toBe(withPost.recording.sceneHash);
    expect(runHashOf(yardWithPost, library, "ignored")).toBe(withPost.recording.sceneHash);
    // A scene that reaches no prefab takes the session's own hash of it.
    const plain = { ...yard };
    expect(sceneHashWith(plain, library)).toBe(sceneHash(plain));
    expect(runHashOf(plain, library, "own")).toBe("own");
    expect(runHashOf(plain, library)).toBe(sceneHash(plain));
    expect(runHashOf(plain, library, "own")).toBe("own");
  });

  it("says why a blocked run or a stranger file can't be shown", () => {
    const blocked = parseRun(
      JSON.stringify({
        ok: false,
        blocked: true,
        stage: "scene",
        scene: "engine-yard",
        issues: [{ message: "no spawn" }],
        scriptIssues: [],
      }),
      "pasted",
    );
    expect(blocked).toEqual({
      ok: false,
      error: "That run never played: the scene had errors (no spawn).",
    });
    expect(parseRun("{", "pasted")).toMatchObject({ ok: false, error: /isn't JSON/ });
    expect(parseRun('{"blocked": false}', "pasted")).toMatchObject({
      ok: false,
      error: /isn't a run recording/,
    });
  });
});

describe("LoadRunPanel", () => {
  function setup(def: SceneDefinition = yard, prefabs?: PrefabSource, reg = registry) {
    const session = createEditorSession({
      doc: sceneToDoc(def, { key: sequentialKeys("t") }),
      origin: ada,
      name: "engine-yard",
      registry: reg,
      issuesDebounceMs: 0,
      ...(prefabs ? { prefabs } : {}),
    });
    const store = createLoadedRunStore();
    const onPlayFrom = vi.fn();
    const onReplay = vi.fn();
    render(
      <LoadRunPanel
        session={session}
        run={store}
        onPlayFrom={onPlayFrom}
        onReplay={onReplay}
        notify={notify}
      />,
    );
    return { session, store, onPlayFrom, onReplay };
  }

  it("loads a pasted report, notes a changed scene, replays it and plays from its start", async () => {
    const { session, store, onPlayFrom, onReplay } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Load run" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Or paste it"), { target: { value: printed } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Load" }));

    expect(store.state?.name).toBe("pasted");
    expect(store.state?.recording.sceneHash).toBe(report.sceneHash);
    const panel = within(screen.getByRole("region", { name: "Run" }));
    expect(panel.getByText("script-end")).toBeTruthy();
    expect(panel.queryByRole("status")).toBeNull();

    fireEvent.click(panel.getByRole("button", { name: "Play from its start" }));
    expect(onPlayFrom).toHaveBeenCalledWith(runStart(store.state!));
    fireEvent.click(panel.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalledWith(store.state);

    act(() => {
      session.dispatch({ ops: [{ op: "move", refs: ["crate"], by: [16, 0] }] });
    });
    expect(panel.getByRole("status").textContent).toContain("scene changed since this run");

    fireEvent.click(panel.getByRole("button", { name: "Clear" }));
    expect(store.state).toBeNull();
  });

  it("reads a run recorded on the open scene and its prefabs as fresh", () => {
    const { source, set } = swappableSource(prefabLibrary([post]));
    const { session, store } = setup(yardWithPost, source);
    // The recorder's hash covers the prefabs the scene places; the scene's own doesn't.
    expect(withPost.recording.sceneHash).not.toBe(session.getHash());
    act(() => store.setState(() => ({ recording: withPost.recording, name: "Last run" })));
    const panel = within(screen.getByRole("region", { name: "Run" }));
    expect(panel.getByText("Last run")).toBeTruthy();
    expect(panel.queryByRole("status")).toBeNull();

    const moved: Prefab = {
      ...post,
      entities: post.entities!.map((e) => (e.id === "cap" ? { ...e, at: [0, -140] } : e)),
    };
    act(() => set(prefabLibrary([moved])));
    expect(panel.getByRole("status").textContent).toContain("scene changed since this run");
    act(() => set(prefabLibrary([post])));
    expect(panel.queryByRole("status")).toBeNull();

    act(() => {
      session.dispatch({ ops: [{ op: "move", refs: ["crate"], by: [16, 0] }] });
    });
    expect(panel.getByRole("status").textContent).toContain("scene changed since this run");
  });

  it("takes only the height a short run needs, its markers scrolling once they outgrow the panel", () => {
    const { store } = setup();
    const short = { ...report.recording, markers: [marker(), { ...marker(), tick: 30 }] };
    act(() => store.setState(() => ({ recording: short, name: "short" })));
    const panel = screen.getByRole("region", { name: "Run" });
    const markers = within(panel).getByRole("list", { name: "Run markers" });
    expect(within(markers).getAllByRole("listitem")).toHaveLength(2);
    expect(markers.parentElement?.className).toBe("je-run-summary");

    const css = readFileSync(resolve("packages/engine/editor-ui/style.css"), "utf8");
    const rule = (selector: string) => {
      const at = css.indexOf(`  ${selector} {`);
      expect(at).toBeGreaterThan(0);
      return css.slice(at, css.indexOf("}", at));
    };
    expect(rule(".je-run-summary")).toMatch(/flex: 0 1 auto;/);
    expect(rule(".je-run-markers")).toMatch(/flex: 0 1 auto;/);
    expect(css.indexOf("  .je-run-markers {")).toBeGreaterThan(
      css.indexOf("  .je-scene-panel-scroll {"),
    );
  });

  it("times the run and its markers at the recording's own tick rate", () => {
    const { store } = setup();
    const at60 = { ...report.recording, ticks: 300, markers: [{ ...marker(), tick: 90 }] };
    act(() => store.setState(() => ({ recording: at60, name: "sixty" })));
    const panel = within(screen.getByRole("region", { name: "Run" }));
    expect(panel.getByText(/300 ticks \(5\.0s\)/)).toBeTruthy();
    expect(panel.getByText("1.5s")).toBeTruthy();

    act(() =>
      store.setState(() => ({
        recording: { ...at60, time: { ...at60.time, rate: 30 } },
        name: "thirty",
      })),
    );
    expect(panel.getByText(/300 ticks \(10\.0s\)/)).toBeTruthy();
    expect(panel.getByText("3.0s")).toBeTruthy();
  });

  it("counts a turns or event game's run in steps, not seconds", () => {
    for (const kind of ["turns", "event"] as const) {
      const { store } = setup(
        yard,
        undefined,
        createRegistry({ ...testGame, time: { kind, rate: 60 } }),
      );
      const run = { ...report.recording, ticks: 300, markers: [{ ...marker(), tick: 90 }] };
      act(() => store.setState(() => ({ recording: run, name: kind })));
      const panel = within(screen.getByRole("region", { name: "Run" }));
      expect(panel.getByText(/300 steps/)).toBeTruthy();
      expect(panel.queryByText(/ticks|\d\.\ds/)).toBeNull();
      expect(panel.getByText("step 90")).toBeTruthy();
      cleanup();
    }
  });

  it("loads a report file, and toasts a bad one", async () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Load run" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Recording file");

    fireEvent.change(input, {
      target: { files: [new File(["not json"], "bad.json", { type: "application/json" })] },
    });
    await waitFor(() => expect(toasts.error).toHaveBeenCalledOnce());
    expect(store.state).toBeNull();

    fireEvent.change(input, {
      target: { files: [new File([printed], "run.json", { type: "application/json" })] },
    });
    await waitFor(() => expect(store.state?.name).toBe("run.json"));
  });

  it("keeps Load run in the toolbar row, with Clear beside it once a run is loaded", async () => {
    const { store } = setup();
    const region = screen.getByRole("region", { name: "Run" });
    const toolbar = region.querySelector(".je-panel-toolbar");
    if (!(toolbar instanceof HTMLElement)) throw new Error("no toolbar row");
    expect(region.firstElementChild).toBe(toolbar);
    expect(within(toolbar).getByRole("button", { name: "Load run" })).toBeTruthy();
    expect(within(toolbar).queryByRole("button", { name: "Clear" })).toBeNull();

    fireEvent.click(within(toolbar).getByRole("button", { name: "Load run" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Or paste it"), { target: { value: printed } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Load" }));
    expect(store.state).not.toBeNull();

    expect(within(toolbar).getByRole("button", { name: "Load run" })).toBeTruthy();
    fireEvent.click(within(toolbar).getByRole("button", { name: "Clear" }));
    expect(store.state).toBeNull();
    expect(within(toolbar).queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("shows a file being read as busy with no PendingProvider above it", async () => {
    const reads: Array<() => void> = [];
    const RealReader = globalThis.FileReader;
    class HeldReader extends RealReader {
      override readAsText(blob: Blob) {
        reads.push(() => super.readAsText(blob));
      }
    }
    vi.stubGlobal("FileReader", HeldReader);
    try {
      const { store } = setup();
      fireEvent.click(screen.getByRole("button", { name: "Load run" }));
      const dialog = await screen.findByRole("dialog");
      const input = within(dialog).getByLabelText("Recording file");
      fireEvent.change(input, {
        target: { files: [new File([printed], "run.json", { type: "application/json" })] },
      });

      await waitFor(() => expect(input.getAttribute("aria-busy")).toBe("true"));
      expect(input).toHaveProperty("disabled", true);
      expect(within(dialog).getByText("Reading run.json")).toBeTruthy();
      const toolbar = screen
        .getByRole("region", { name: "Run", hidden: true })
        .querySelector(".je-panel-toolbar");
      expect(toolbar?.querySelector("[aria-busy='true']")?.textContent).toContain("Load run");

      act(() => reads.splice(0).forEach((read) => read()));
      await waitFor(() => expect(store.state?.name).toBe("run.json"));
      expect(input.getAttribute("aria-busy")).toBeNull();
      expect(input).toHaveProperty("disabled", false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
