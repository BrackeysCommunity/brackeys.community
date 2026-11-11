// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

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

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import {
  createEditorSession,
  type Registry,
  type SceneDefinition,
  type SceneIssue,
} from "../../editor/index";
import { createRegistry } from "../../game/index";
import type { RapierModule } from "../../headless/index";
import type { EditorNotify } from "../host";
import { DEFAULT_LAYOUT, fitLayout } from "../layout/model";
import { ProblemsPanel } from "../panels/ProblemsPanel";
import { usePhysicalIssues } from "../session/use-physical-issues";

const toasts = { error: vi.fn(), warning: vi.fn(), success: vi.fn() };
const notify: EditorNotify = Object.assign(vi.fn(), toasts);

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
    render(
      <ProblemsPanel session={session} physical={[crushed]} onFrame={() => {}} notify={notify} />,
    );
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
    render(
      <ProblemsPanel session={session} physical={[crushed]} onFrame={onFrame} notify={notify} />,
    );
    fireEvent.click(screen.getByText("zone overlaps the ground"));
    expect(session.store.state.selection).toEqual(["zone"]);
    expect(onFrame).toHaveBeenCalledWith(["zone"]);
  });

  it("applies an issue's fix as one batch, and disables Fix without one", () => {
    const session = sessionOf(scene());
    const dispatch = vi.spyOn(session, "dispatch");
    render(
      <ProblemsPanel session={session} physical={[crushed]} onFrame={() => {}} notify={notify} />,
    );

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

describe("ProblemsPanel in a narrow column", () => {
  const styleCss = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");

  it("is a size container, each row's code a sibling of its message", () => {
    const session = sessionOf(scene());
    render(
      <ProblemsPanel session={session} physical={[crushed]} onFrame={() => {}} notify={notify} />,
    );
    const panel = screen.getByRole("region", { name: "Problems" });
    expect(panel.classList.contains("je-problems")).toBe(true);
    const code = within(panel).getByText("spawn-in-solid");
    expect(code.className).toBe("je-problems-code");
    expect(code.previousElementSibling?.className).toBe("je-problems-message");
    expect(code.parentElement?.className).toBe("je-problems-show");
  });

  it("puts the rule code on a line of its own under a column's narrower widths", () => {
    expect(styleCss).toMatch(/\.je-problems \{\s*container: je-problems \/ inline-size;/);
    const at = styleCss.indexOf("@container je-problems (max-width: 288px)");
    expect(at).toBeGreaterThan(0);
    const block = styleCss.slice(at, styleCss.indexOf("\n  }\n", at));
    expect(block).toMatch(/\.je-problems-show \{[^}]*flex-wrap: wrap;/);
    expect(block).toMatch(/\.je-problems-code \{[^}]*flex-basis: 100%;[^}]*max-width: none;/);
  });

  it("wraps at the right column's width under 900 px and not at its default", () => {
    // The panel's inline size is the column's less the group's border and the body's padding.
    const bodyWidth = (column: number) => column - 2 * 1 - 2 * 6;
    const right = (width: number) =>
      fitLayout(DEFAULT_LAYOUT, { width, height: 900, topLeft: 0, topRight: 0, bottom: 0 }).right!
        .width;
    expect(bodyWidth(right(1440))).toBeGreaterThan(288);
    expect(bodyWidth(right(899))).toBeLessThanOrEqual(288);
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
