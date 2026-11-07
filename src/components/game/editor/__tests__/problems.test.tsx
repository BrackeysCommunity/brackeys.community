// @vitest-environment jsdom
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "@jams/engine/collab";
import {
  createEditorSession,
  type Registry,
  type SceneDefinition,
  type SceneIssue,
} from "@jams/engine/editor";
import { createRegistry } from "@jams/engine/game";
import type { RapierModule } from "@jams/engine/headless";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { ProblemsPanel } from "@/components/game/editor/ProblemsPanel";
import { usePhysicalIssues } from "@/components/game/editor/use-physical-issues";

const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), toasts) }));

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

/** `pad` sits half a pixel off the grid: a `non-integer` warning with a fix. */
function scene(): SceneDefinition {
  return {
    v: 1,
    name: "problem-yard",
    bounds: [0, 0, 2000, 1200],
    solid: [["box", 1000, 1180, 1000, 20]],
    entities: [
      { id: "zone", type: "sensor", shape: ["circle", 900, 600, 12], tags: ["goal"] },
      { id: "pad", type: "marker", at: [1000.5, 1010] },
    ],
  };
}

function sessionOf(def: SceneDefinition, registry: Registry = createRegistry()) {
  return createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: def.name,
    registry,
    issuesDebounceMs: 0,
  });
}

const crushed: SceneIssue = {
  severity: "error",
  code: "spawn-in-solid" as SceneIssue["code"],
  message: "zone overlaps the ground",
  entityIds: ["zone"],
  hint: "Move it up.",
};

afterEach(cleanup);

describe("ProblemsPanel", () => {
  it("groups structural and physical issues by severity, with counts", () => {
    const session = sessionOf(scene());
    render(<ProblemsPanel session={session} physical={[crushed]} onFrame={() => {}} />);
    expect(screen.getByRole("region", { name: "Errors (1)" })).toBeTruthy();
    const warnings = screen.getByRole("region", { name: /^Warnings/ });
    expect(within(warnings).getByText("non-integer")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Errors (1)" })).getByText("spawn-in-solid"),
    ).toBeTruthy();
  });

  it("selects and frames a row's entities on click", () => {
    const session = sessionOf(scene());
    const onFrame = vi.fn();
    render(<ProblemsPanel session={session} physical={[crushed]} onFrame={onFrame} />);
    fireEvent.click(screen.getByText("zone overlaps the ground"));
    expect(session.store.state.selection).toEqual(["zone"]);
    expect(onFrame).toHaveBeenCalledWith(["zone"]);
  });

  it("applies an issue's fix as one batch, and disables Fix without one", () => {
    const session = sessionOf(scene());
    const dispatch = vi.spyOn(session, "dispatch");
    render(<ProblemsPanel session={session} physical={[crushed]} onFrame={() => {}} />);

    const offGrid = screen
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes("non-integer"))!;
    const unfixable = screen.getByRole("listitem", { name: "zone overlaps the ground" });
    expect(
      (within(unfixable).getByRole("button", { name: "Fix" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    act(() => {
      fireEvent.click(within(offGrid).getByRole("button", { name: "Fix" }));
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(session.getDoc().entities![1]).toMatchObject({ at: [1001, 1010] });
    expect(screen.queryByText("non-integer")).toBeNull();
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

describe("usePhysicalIssues", () => {
  let rapier: RapierModule;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
  });

  const overlapping: SceneDefinition = {
    v: 1,
    name: "overlap-yard",
    bounds: [0, 0, 2000, 1000],
    entities: [
      { id: "floor", type: "solid", shape: ["box", 500, 900, 200, 20] },
      { id: "slab", type: "solid", shape: ["box", 520, 900, 200, 20] },
    ],
  };

  it("finds physical issues after the doc settles, and none without Rapier", async () => {
    const session = sessionOf(overlapping, createRegistry());
    const { result, rerender } = renderHook(({ r }) => usePhysicalIssues(session, r, 10), {
      initialProps: { r: rapier as RapierModule | null },
    });
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current.map((i) => i.code)).toEqual(["solid-overlap"]));

    act(() => {
      session.dispatch({ ops: [{ op: "remove", refs: ["slab"] }] });
    });
    await waitFor(() => expect(result.current).toEqual([]));

    rerender({ r: null });
    expect(result.current).toEqual([]);
  });
});
