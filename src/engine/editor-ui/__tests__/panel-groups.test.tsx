// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import { createEditorSession, type SceneDefinition, type SceneIssue } from "../../editor/index";
import { createRegistry } from "../../game/index";
import type { AssetKey } from "../../project/index";
import { PanelGroup } from "../frame/PanelGroup";
import type { EditorNotify, EditorStorage } from "../host";
import { KitProvider } from "../kit/index";
import { DEFAULT_LAYOUT, type EditorLayout, type Viewport } from "../layout/model";
import { LAYOUT_KEY, useLayout } from "../layout/use-layout";
import { createPanelContext, PANEL_IDS, PANELS, type PanelContext } from "../panels/registry";
import { createPending, type Pending } from "../pending/pending";
import { PendingProvider } from "../pending/use-pending";
import type { LoadedRun } from "../session/loaded-run";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const VIEWPORT: Viewport = { width: 1440, height: 900, topLeft: 48, topRight: 0, bottom: 40 };

/** `pad` sits half a pixel off the grid: one structural warning. */
function scene(): SceneDefinition {
  return {
    v: 1,
    name: "tab-yard",
    bounds: [0, 0, 2000, 1200],
    solid: [["box", 1000, 1180, 1000, 20]],
    entities: [
      { id: "zone", type: "sensor", shape: ["circle", 900, 600, 12], tags: ["goal"] },
      { id: "pad", type: "marker", at: [1000.005, 1010] },
    ],
  };
}

const crushed: SceneIssue = {
  severity: "error",
  code: "spawn-in-solid" as SceneIssue["code"],
  message: "zone overlaps the ground",
  entityIds: ["zone"],
};

function memoryStorage(initial?: EditorLayout): EditorStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial) data.set(LAYOUT_KEY, JSON.stringify(initial));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

function Groups({ storage, ctx }: { storage: EditorStorage; ctx: PanelContext }) {
  const layout = useLayout(storage, PANEL_IDS);
  return (
    <>
      {(["left", "right"] as const).flatMap((side) =>
        layout.layout[side].groups.map((_, i) => (
          <PanelGroup
            key={`${side}${i}`}
            side={side}
            index={i as 0 | 1}
            layout={layout}
            viewport={VIEWPORT}
            ctx={ctx}
          />
        )),
      )}
    </>
  );
}

function setup({ layout, pending }: { layout?: EditorLayout; pending?: Pending } = {}) {
  const session = createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("t") }),
    origin: ada,
    name: "tab-yard",
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });
  const notify: EditorNotify = Object.assign(vi.fn(), {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  });
  const physical = new Store<readonly SceneIssue[]>([]);
  const ctx = createPanelContext({
    openPanel: vi.fn(),
    controls: {
      session,
      notify,
      runStore: new Store<LoadedRun | null>(null),
      playFrom: vi.fn(),
      onReplay: vi.fn(),
      frame: () => true,
    },
    physical,
    pickedAsset: new Store<AssetKey | null>(null),
  });
  const storage = memoryStorage(layout);
  const ui = <Groups storage={storage} ctx={ctx} />;
  render(
    <KitProvider host={{}}>
      {pending ? <PendingProvider pending={pending}>{ui}</PendingProvider> : ui}
    </KitProvider>,
  );
  return { session, physical, storage };
}

const strip = (name: string) => screen.getByRole("tablist", { name });
const tabNames = (name: string) =>
  within(strip(name))
    .getAllByRole("tab")
    .map((t) => t.querySelector(".je-tab-label")?.textContent);
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const portal = () => document.querySelector<HTMLElement>(".je-portal")!;

async function chooseFromMenu(of: RegExp, item: string) {
  fireEvent.contextMenu(tab(of));
  const option = await waitFor(() => within(portal()).getByRole("menuitem", { name: item }));
  fireEvent.click(option);
}

afterEach(cleanup);

describe("panel groups", () => {
  it("draw the default grouping, one strip per group", () => {
    setup();
    expect(tabNames("Left column, top group")).toEqual(["Outliner"]);
    expect(tabNames("Left column, bottom group")).toEqual(["Project"]);
    expect(tabNames("Right column, top group")).toEqual(["Inspector"]);
    expect(tabNames("Right column, bottom group")).toEqual(["Problems", "Run", "History"]);
    expect(PANELS.map((p) => p.id)).toEqual([
      "outliner",
      "project",
      "inspector",
      "problems",
      "run",
      "history",
    ]);
    expect(screen.queryByRole("heading", { name: /History|Problems|Run/ })).toBeNull();
  });

  it("move between tabs with the arrow keys", async () => {
    setup();
    const problems = tab(/Problems/);
    act(() => problems.focus());
    fireEvent.keyDown(problems, { key: "ArrowRight" });
    await waitFor(() => expect(tab(/Run/).getAttribute("aria-selected")).toBe("true"));
    expect(
      screen
        .getByRole("region", { name: "Run" })
        .closest("[role=tabpanel]")
        ?.hasAttribute("hidden"),
    ).toBe(false);
    fireEvent.keyDown(tab(/Run/), { key: "ArrowRight" });
    await waitFor(() => expect(tab(/History/).getAttribute("aria-selected")).toBe("true"));
  });

  it("count errors and warnings on Problems' tab as they change", async () => {
    const { physical } = setup();
    const badge = () => tab(/Problems/).querySelector(".je-tab-badge");
    await waitFor(() => expect(badge()?.textContent).toBe("1"));
    expect(badge()?.getAttribute("data-tone")).toBe("warning");
    act(() => physical.setState(() => [crushed]));
    expect(badge()?.textContent).toBe("2");
    expect(badge()?.getAttribute("data-tone")).toBe("danger");
    // A rising count doesn't steal the tab.
    expect(tab(/Problems/).getAttribute("aria-selected")).toBe("true");
    expect(tab(/Inspector/).getAttribute("aria-selected")).toBe("true");
  });

  it("show a spinner on Problems' tab while its checks run", () => {
    const pending = createPending({
      notify: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
    });
    setup({ pending });
    expect(tab(/Problems/).getAttribute("aria-busy")).toBeNull();
    let release!: () => void;
    act(() => {
      release = pending.hold({ id: "checks", label: "Checking", scope: "panel:problems" });
    });
    expect(tab(/Problems/).getAttribute("aria-busy")).toBe("true");
    act(() => release());
    expect(tab(/Problems/).getAttribute("aria-busy")).toBeNull();
  });

  it("bring Inspector forward when something in the scene is selected", () => {
    const shared: EditorLayout = {
      ...DEFAULT_LAYOUT,
      right: {
        ...DEFAULT_LAYOUT.right,
        groups: [
          {
            panels: ["inspector", "problems", "run", "history"],
            active: "history",
            size: null,
            collapsed: false,
          },
        ],
      },
    };
    const { session } = setup({ layout: shared });
    expect(tab(/History/).getAttribute("aria-selected")).toBe("true");
    act(() => session.select(["zone"]));
    expect(tab(/Inspector/).getAttribute("aria-selected")).toBe("true");
  });

  it("move History to the top group, store it, and reset the layout", async () => {
    const { storage } = setup();
    await chooseFromMenu(/History/, "Move to top group");
    await waitFor(() =>
      expect(tabNames("Right column, top group")).toEqual(["Inspector", "History"]),
    );
    expect(tabNames("Right column, bottom group")).toEqual(["Problems", "Run"]);
    expect(tab(/History/).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => {
      const stored = JSON.parse(storage.data.get(LAYOUT_KEY) ?? "null") as EditorLayout | null;
      expect(stored?.right.groups[0].panels).toEqual(["inspector", "history"]);
    });

    await chooseFromMenu(/History/, "Reset layout");
    await waitFor(() => expect(tabNames("Right column, top group")).toEqual(["Inspector"]));
    expect(tabNames("Right column, bottom group")).toEqual(["Problems", "Run", "History"]);
    await waitFor(() => expect(JSON.parse(storage.data.get(LAYOUT_KEY)!)).toEqual(DEFAULT_LAYOUT));
  });

  it("drop a group its last panel leaves, and refuse to empty a column", async () => {
    setup();
    await chooseFromMenu(/Project/, "Move to top group");
    await waitFor(() =>
      expect(tabNames("Left column, top group")).toEqual(["Outliner", "Project"]),
    );
    expect(screen.queryByRole("tablist", { name: "Left column, bottom group" })).toBeNull();
    fireEvent.contextMenu(tab(/Project/));
    const move = await waitFor(() =>
      within(portal()).getByRole("menuitem", { name: "Move to bottom group" }),
    );
    expect(move.getAttribute("aria-disabled")).toBeNull();
  });

  it("collapse a group to its strip, keeping its panels mounted", async () => {
    setup();
    const group = strip("Right column, bottom group").closest(".je-panel-group")!;
    fireEvent.click(within(group as HTMLElement).getByRole("button", { name: "Collapse group" }));
    await waitFor(() => expect(group.hasAttribute("data-collapsed")).toBe(true));
    expect(
      within(group as HTMLElement).getByRole("region", { name: "History", hidden: true }),
    ).toBeTruthy();
    fireEvent.click(within(group as HTMLElement).getByRole("button", { name: "Expand group" }));
    await waitFor(() => expect(group.hasAttribute("data-collapsed")).toBe(false));
  });

  it("keep an outliner filter across a tab switch", async () => {
    const together: EditorLayout = {
      ...DEFAULT_LAYOUT,
      left: {
        ...DEFAULT_LAYOUT.left,
        groups: [
          { panels: ["outliner", "project"], active: "outliner", size: null, collapsed: false },
        ],
      },
    };
    setup({ layout: together });
    const filter = screen.getByRole("searchbox", { name: "Filter rows" }) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "type:sensor" } });
    fireEvent.click(tab(/Project/));
    await waitFor(() => expect(tab(/Project/).getAttribute("aria-selected")).toBe("true"));
    expect(filter.closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(tab(/Outliner/));
    await waitFor(() => expect(tab(/Outliner/).getAttribute("aria-selected")).toBe("true"));
    expect((screen.getByRole("searchbox", { name: "Filter rows" }) as HTMLInputElement).value).toBe(
      "type:sensor",
    );
  });
});
