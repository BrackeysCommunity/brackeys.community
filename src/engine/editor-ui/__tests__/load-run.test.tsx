// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import { createEditorSession } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { runPlaytest, type PlaytestReport, type RapierModule } from "../../headless/index";
import { parseSceneOrThrow } from "../../scene/index";
import type { EditorNotify } from "../host";
import { LoadRunPanel } from "../panels/LoadRunPanel";
import { createLoadedRunStore, parseRun, runOverlay, runStart } from "../session/loaded-run";

const toasts = { error: vi.fn(), warning: vi.fn(), success: vi.fn() };
const notify: EditorNotify = Object.assign(vi.fn(), toasts);

const registry = createRegistry(testGame);
const yard = parseSceneOrThrow(
  readFileSync(resolve("src/engine/scenes/engine-yard.json"), "utf8"),
  registry,
);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

let report: PlaytestReport;
/** The report as `scene playtest --json` prints it. */
let printed: string;

beforeAll(async () => {
  const rapier: RapierModule = await import("@dimforge/rapier2d");
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
  function setup() {
    const session = createEditorSession({
      doc: sceneToDoc(yard, { key: sequentialKeys("t") }),
      origin: ada,
      name: "engine-yard",
      registry,
      issuesDebounceMs: 0,
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
});
