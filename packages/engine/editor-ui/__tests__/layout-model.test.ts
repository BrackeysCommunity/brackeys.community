import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_LAYOUT,
  fitLayout,
  FRAME,
  LIMITS,
  movePanel,
  parseLayout,
  resizeColumn,
  resizeSplit,
  revealPanel,
  selectTab,
  splitRange,
  toggleColumn,
  toggleGroup,
  type EditorLayout,
  type FittedColumn,
  type FittedLayout,
  type PanelId,
  type Viewport,
} from "../layout/model";

const KNOWN: readonly PanelId[] = [
  "outliner",
  "project",
  "settings",
  "inspector",
  "problems",
  "run",
  "history",
];
const INSET = 8;
const RAIL = 36;
const STRIP = 28;

const view = (width: number, height: number, chrome: Partial<Viewport> = {}): Viewport => ({
  width,
  height,
  topLeft: 40,
  topRight: 0,
  bottom: 36,
  ...chrome,
});

const CUSTOM: EditorLayout = movePanel(
  resizeSplit(
    resizeSplit(
      resizeColumn(resizeColumn(DEFAULT_LAYOUT, "right", 420), "left", 250),
      "right",
      360,
    ),
    "left",
    180,
  ),
  "history",
  { side: "right", group: 0 },
);

/** The default layout with the left column's bottom group moved into its top one. */
const LEFT_MERGED: EditorLayout = movePanel(
  movePanel(DEFAULT_LAYOUT, "project", { side: "left", group: 0 }),
  "settings",
  { side: "left", group: 0 },
);

const VIEWPORTS: [number, number][] = [
  [375, 812],
  [414, 896],
  [639, 900],
  [640, 700],
  [700, 700],
  [760, 700],
  [800, 600],
  [900, 700],
  [1024, 700],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
];

const columns = (fit: FittedLayout): FittedColumn[] =>
  [fit.left, fit.right].filter((c): c is FittedColumn => c !== null);
const canvasWidth = (fit: FittedLayout, width: number): number =>
  width - fit.canvas.left - fit.canvas.right;

describe("fitLayout across viewports", () => {
  for (const [name, layout] of [
    ["default", DEFAULT_LAYOUT],
    ["customised", CUSTOM],
  ] as const) {
    for (const [width, height] of VIEWPORTS) {
      it(`${name} at ${width}×${height}`, () => {
        const before = structuredClone(layout);
        const fit = fitLayout(layout, view(width, height));
        expect(layout).toEqual(before);

        if (width < LIMITS.phone) {
          expect(fit.mode).toBe("phone");
          expect(fit.left).toBeNull();
          expect(fit.right).toBeNull();
          return;
        }
        expect(fit.mode).toBe(
          width >= 2 * INSET + 2 * LIMITS.column.min + LIMITS.canvas.min ? "desktop" : "single",
        );
        expect(canvasWidth(fit, width)).toBeGreaterThanOrEqual(LIMITS.canvas.min);

        for (const col of columns(fit)) {
          expect(col.x).toBeGreaterThanOrEqual(INSET);
          expect(col.x + col.width).toBeLessThanOrEqual(width - INSET);
          expect(col.y + col.height).toBe(height - INSET);
          if (col.rail) {
            expect(col.width).toBe(RAIL);
            continue;
          }
          expect(col.width).toBeGreaterThanOrEqual(LIMITS.column.min);
          expect(col.width).toBeLessThanOrEqual(LIMITS.column.max);
          for (const g of col.groups) {
            expect(g.y).toBeGreaterThanOrEqual(0);
            expect(g.y + g.height).toBeLessThanOrEqual(col.height);
            expect(g.height).toBeGreaterThanOrEqual(g.collapsed ? STRIP : LIMITS.group.min);
          }
          const [a, b] = col.groups;
          if (a && b) expect(a.y + a.height).toBeLessThanOrEqual(b.y);
        }
        const [left, right] = [fit.left!, fit.right!];
        expect(left.x + left.width).toBeLessThan(right.x);
        if (fit.mode === "single") expect(columns(fit).filter((c) => c.rail)).toHaveLength(1);
      });
    }
  }

  it("draws stored sizes unchanged when the window has room", () => {
    const fit = fitLayout(CUSTOM, view(2560, 1440));
    expect(fit.left!.width).toBe(250);
    expect(fit.right!.width).toBe(420);
    expect(fit.left!.groups[1]!.height).toBe(180);
    expect(fit.right!.groups[1]!.height).toBe(360);
  });

  it("keeps stored sizes through any sequence of fits", () => {
    let layout = CUSTOM;
    for (const [w, h] of [...VIEWPORTS, ...[...VIEWPORTS].reverse()]) {
      fitLayout(layout, view(w, h));
      layout = { ...layout };
    }
    expect(layout).toEqual(CUSTOM);
    const wide = fitLayout(layout, view(1440, 900));
    expect(wide.right!.width).toBe(420);
    expect(wide.right!.groups[1]!.height).toBe(360);
  });

  it("shrinks both columns toward their minimum before dropping one", () => {
    const fit = fitLayout(CUSTOM, view(1000, 800));
    expect(fit.mode).toBe("desktop");
    expect(fit.left!.width).toBeLessThan(250);
    expect(fit.right!.width).toBeLessThan(420);
    expect(canvasWidth(fit, 1000)).toBe(LIMITS.canvas.min);
  });

  it("starts each column below its own side's island", () => {
    const fit = fitLayout(DEFAULT_LAYOUT, view(1440, 900, { topLeft: 40, topRight: 0 }));
    expect(fit.left!.y).toBe(INSET + 40 + 8);
    expect(fit.right!.y).toBe(INSET);
    expect(fit.right!.height).toBe(900 - 2 * INSET);
  });

  it("gives the inspector most of the right column at 1440×900", () => {
    const fit = fitLayout(DEFAULT_LAYOUT, view(1440, 900));
    expect(fit.right!.groups[0]!.height).toBeGreaterThanOrEqual(500);
    expect(fit.right!.groups[1]!.height).toBe(240);
  });

  it("reports what the columns cover for framing", () => {
    const fit = fitLayout(DEFAULT_LAYOUT, view(1440, 900));
    expect(fit.canvas).toEqual({
      left: INSET + 288,
      right: INSET + 320,
      top: INSET + 40,
      bottom: INSET + 36,
    });
  });
});

describe("minimums", () => {
  it("clamps stored widths to the column limits", () => {
    expect(resizeColumn(DEFAULT_LAYOUT, "left", 10).left.width).toBe(LIMITS.column.min);
    expect(resizeColumn(DEFAULT_LAYOUT, "left", 9000).left.width).toBe(LIMITS.column.max);
    expect(resizeColumn(DEFAULT_LAYOUT, "left", 300.4).left.width).toBe(300);
    expect(resizeColumn(DEFAULT_LAYOUT, "left", 288)).toBe(DEFAULT_LAYOUT);
    expect(resizeColumn(DEFAULT_LAYOUT, "left", Number.NaN)).toBe(DEFAULT_LAYOUT);
  });

  it("keeps the bottom group at least its minimum", () => {
    expect(resizeSplit(DEFAULT_LAYOUT, "right", 20).right.groups[1]!.size).toBe(LIMITS.group.min);
    expect(resizeSplit(LEFT_MERGED, "left", 200)).toBe(LEFT_MERGED);
  });

  it("draws a tall stored split no taller than leaves the top group its share", () => {
    const tall = resizeSplit(DEFAULT_LAYOUT, "right", 5000);
    const fit = fitLayout(tall, view(1440, 900));
    const room = fit.right!.height - FRAME.gap;
    expect(fit.right!.groups[0]!.height).toBe(Math.round(room * LIMITS.group.topShare));
    expect(fit.right!.groups[1]!.height).toBe(splitRange(room).max);
    expect(tall.right.groups[1]!.size).toBe(5000);
  });

  it("at 1024 px with Project settings open, leaves the outliner its share of the left column", () => {
    const layout = selectTab(DEFAULT_LAYOUT, "settings");
    expect(layout.left.groups[1]!.size).toBe(480);
    for (const height of [700, 768]) {
      const left = fitLayout(layout, view(1024, height)).left!;
      const [outliner, settings] = left.groups;
      const room = left.height - FRAME.gap;
      expect(outliner!.height).toBeGreaterThanOrEqual(Math.round(room * LIMITS.group.topShare));
      expect(outliner!.height).toBeGreaterThanOrEqual(settings!.height);
      expect(outliner!.height + settings!.height).toBe(room);
      expect(settings!.height).toBeGreaterThan(DEFAULT_LAYOUT.left.groups[1]!.size!);
    }
  });

  it("never draws the outliner the smaller group, however tall a stored Project group is", () => {
    const layout = selectTab(resizeSplit(DEFAULT_LAYOUT, "left", 5000), "project");
    for (const height of [700, 768, 900]) {
      const [outliner, project] = fitLayout(layout, view(1024, height)).left!.groups;
      expect(outliner!.height).toBeGreaterThanOrEqual(project!.height);
    }
  });

  it("starts a bottom group with no stored height at its default share", () => {
    const layout: EditorLayout = {
      ...DEFAULT_LAYOUT,
      left: {
        ...DEFAULT_LAYOUT.left,
        groups: [DEFAULT_LAYOUT.left.groups[0], { ...DEFAULT_LAYOUT.left.groups[1]!, size: null }],
      },
    };
    const left = fitLayout(layout, view(1024, 768)).left!;
    const room = left.height - FRAME.gap;
    expect(left.groups[1]!.height).toBe(Math.round(room * LIMITS.group.bottomShare));
  });

  it("bounds the split between the bottom group's minimum and the top group's share", () => {
    expect(splitRange(600)).toEqual({ min: LIMITS.group.min, max: 300 });
    expect(splitRange(150)).toEqual({ min: LIMITS.group.min, max: LIMITS.group.min });
  });

  it("collapses the bottom group first when both minimums don't fit", () => {
    const fit = fitLayout(DEFAULT_LAYOUT, view(1440, 200));
    const [top, bottom] = fit.right!.groups;
    expect(bottom).toMatchObject({ collapsed: true, height: STRIP });
    expect(top!.collapsed).toBe(false);
    expect(top!.height).toBeGreaterThanOrEqual(LIMITS.group.min);
    expect(DEFAULT_LAYOUT.right.groups[1]!.collapsed).toBe(false);
  });

  it("draws a collapsed group as its strip and gives the room to the other", () => {
    const layout = toggleGroup(DEFAULT_LAYOUT, "right", 1);
    expect(layout.right.groups[1]!.collapsed).toBe(true);
    const fit = fitLayout(layout, view(1440, 900));
    const [top, bottom] = fit.right!.groups;
    expect(bottom!.height).toBe(STRIP);
    expect(top!.height + bottom!.height + 8).toBe(fit.right!.height);
    expect(toggleGroup(layout, "right", 1)).toEqual(DEFAULT_LAYOUT);
  });
});

describe("narrow widths", () => {
  it("draws one column and a rail in single mode, and keeps the stored width", () => {
    const fit = fitLayout(CUSTOM, view(760, 700));
    expect(fit.mode).toBe("single");
    expect(fit.left).toMatchObject({ rail: true, width: RAIL, groups: [] });
    expect(fit.right!.rail).toBe(false);
    expect(canvasWidth(fit, 760)).toBeGreaterThanOrEqual(LIMITS.canvas.min);
    expect(fitLayout(CUSTOM, view(1440, 900)).right!.width).toBe(420);
  });

  it("opening the rail's column in single mode draws it and the other as a rail", () => {
    const narrow = view(760, 700);
    const opened = toggleColumn(DEFAULT_LAYOUT, "left", narrow);
    expect(opened.lastOpened).toBe("left");
    expect(opened.left.collapsed).toBe(false);
    expect(opened.right.collapsed).toBe(false);
    const fit = fitLayout(opened, narrow);
    expect(fit.mode).toBe("single");
    expect(fit.left!.rail).toBe(false);
    expect(fit.right!.rail).toBe(true);

    const back = revealPanel(opened, "history", narrow);
    expect(back.lastOpened).toBe("right");
    expect(back.left.collapsed).toBe(false);
    expect(back.right.groups[1]!.active).toBe("history");
    const fitBack = fitLayout(back, narrow);
    expect(fitBack.left!.rail).toBe(true);
    expect(fitBack.right!.rail).toBe(false);
  });

  it("brings both columns back when the window widens after a rail opened one", () => {
    const opened = toggleColumn(DEFAULT_LAYOUT, "left", view(760, 700));
    const wide = fitLayout(opened, view(1440, 900));
    expect(wide.mode).toBe("desktop");
    expect(wide.left!.rail).toBe(false);
    expect(wide.right!.rail).toBe(false);
    expect(wide.right!.width).toBe(DEFAULT_LAYOUT.right.width);
  });

  it("draws the column opened last in single mode, the right one by default", () => {
    const narrow = view(760, 700);
    expect(fitLayout(DEFAULT_LAYOUT, narrow).left!.rail).toBe(true);
    const wide = view(1440, 900);
    const leftLast = toggleColumn(toggleColumn(DEFAULT_LAYOUT, "left", wide), "left", wide);
    expect(leftLast.lastOpened).toBe("left");
    const fit = fitLayout(leftLast, narrow);
    expect(fit.left!.rail).toBe(false);
    expect(fit.right!.rail).toBe(true);
  });

  it("toggles a column to its rail and back on a wide window without touching the other", () => {
    const wide = view(1440, 900);
    const closed = toggleColumn(DEFAULT_LAYOUT, "left", wide);
    expect(closed.left.collapsed).toBe(true);
    expect(fitLayout(closed, wide).left!.rail).toBe(true);
    const reopened = toggleColumn(closed, "left", wide);
    expect(reopened).toEqual({ ...DEFAULT_LAYOUT, lastOpened: "left" });
  });

  it("uses the phone layout under 640 px and draws no column", () => {
    const fit = fitLayout(DEFAULT_LAYOUT, view(375, 812));
    expect(fit).toMatchObject({ mode: "phone", left: null, right: null });
    expect(fit.canvas.left).toBe(0);
    expect(fit.canvas.right).toBe(0);
    expect(fitLayout(DEFAULT_LAYOUT, view(640, 812)).mode).toBe("single");
  });
});

describe("tabs and panels", () => {
  it("selects a tab in its group", () => {
    const layout = selectTab(DEFAULT_LAYOUT, "run");
    expect(layout.right.groups[1]!.active).toBe("run");
    expect(selectTab(layout, "run")).toBe(layout);
    expect(selectTab(layout, "nope")).toBe(layout);
  });

  it("moves a panel into the other group and selects it there", () => {
    const layout = movePanel(DEFAULT_LAYOUT, "history", { side: "right", group: 0 });
    expect(layout.right.groups[0]).toMatchObject({
      panels: ["inspector", "history"],
      active: "history",
    });
    expect(layout.right.groups[1]!.panels).toEqual(["problems", "run"]);
    const back = movePanel(layout, "history", { side: "right", group: 1 });
    expect(back.right.groups[1]!.panels).toEqual(["problems", "run", "history"]);
  });

  it("grows a short bottom group to the height a form panel needs, and never shrinks one", () => {
    const opened = selectTab(DEFAULT_LAYOUT, "settings");
    expect(opened.left.groups[1]).toMatchObject({ active: "settings", size: 480 });
    const tall = selectTab(resizeSplit(DEFAULT_LAYOUT, "left", 600), "settings");
    expect(tall.left.groups[1]!.size).toBe(600);
    const top = selectTab(
      movePanel(LEFT_MERGED, "outliner", { side: "left", group: 0 }),
      "settings",
    );
    expect(top.left.groups[0]).toMatchObject({ active: "settings", size: null });
  });

  it("moves the active tab and selects its neighbour", () => {
    const layout = movePanel(selectTab(DEFAULT_LAYOUT, "run"), "run", { side: "right", group: 0 });
    expect(layout.right.groups[1]!.active).toBe("history");
  });

  it("removes a group the move empties, and the top group stays sizeless", () => {
    const partial = movePanel(DEFAULT_LAYOUT, "project", { side: "left", group: 0 });
    expect(partial.left.groups[1]).toMatchObject({ panels: ["settings"], active: "settings" });
    expect(LEFT_MERGED.left.groups).toHaveLength(1);
    expect(LEFT_MERGED.left.groups[0]).toMatchObject({
      panels: ["outliner", "project", "settings"],
      size: null,
    });

    const topGone = movePanel(DEFAULT_LAYOUT, "inspector", { side: "right", group: 1 });
    expect(topGone.right.groups).toHaveLength(1);
    expect(topGone.right.groups[0]).toMatchObject({
      panels: ["problems", "run", "history", "inspector"],
      size: null,
      active: "inspector",
    });
  });

  it("creates a missing bottom group, across columns too", () => {
    const split = movePanel(LEFT_MERGED, "project", { side: "left", group: 1 });
    expect(split.left.groups).toHaveLength(2);
    expect(split.left.groups[1]).toMatchObject({ panels: ["project"], size: 260 });

    const across = movePanel(
      movePanel(DEFAULT_LAYOUT, "project", { side: "right", group: 0 }),
      "settings",
      { side: "right", group: 0 },
    );
    expect(across.left.groups).toHaveLength(1);
    expect(across.right.groups[0]!.panels).toEqual(["inspector", "project", "settings"]);
  });

  it("refuses a move that would leave a column with no group", () => {
    const lone = movePanel(
      movePanel(LEFT_MERGED, "outliner", { side: "right", group: 0 }),
      "settings",
      { side: "right", group: 0 },
    );
    expect(lone.left.groups[0]!.panels).toEqual(["project"]);
    const last = movePanel(lone, "project", { side: "right", group: 0 });
    expect(last).toBe(lone);
    expect(movePanel(DEFAULT_LAYOUT, "outliner", { side: "left", group: 0 })).toBe(DEFAULT_LAYOUT);
  });

  it("reveals a panel: opens its column and group and selects it", () => {
    const hidden = toggleGroup(toggleColumn(DEFAULT_LAYOUT, "right", view(1440, 900)), "right", 1);
    const shown = revealPanel(hidden, "run", view(1440, 900));
    expect(shown.right.collapsed).toBe(false);
    expect(shown.right.groups[1]).toMatchObject({ collapsed: false, active: "run" });
    expect(shown.left.collapsed).toBe(false);
    expect(revealPanel(DEFAULT_LAYOUT, "inspector", view(1440, 900))).toBe(DEFAULT_LAYOUT);
  });
});

describe("parseLayout", () => {
  it("round-trips a stored layout, as an object or as JSON", () => {
    expect(parseLayout(CUSTOM, KNOWN)).toEqual(CUSTOM);
    expect(parseLayout(JSON.stringify(CUSTOM), KNOWN)).toEqual(CUSTOM);
  });

  it("keeps the column opened last, and drops a bad value for it", () => {
    const last = { ...CUSTOM, lastOpened: "left" as const };
    expect(parseLayout(JSON.stringify(last), KNOWN)).toEqual(last);
    expect(parseLayout({ ...CUSTOM, lastOpened: "middle" }, KNOWN)).toEqual(CUSTOM);
  });

  it("rejects other versions and bad shapes", () => {
    expect(parseLayout({ ...DEFAULT_LAYOUT, v: 2 }, KNOWN)).toBeNull();
    expect(parseLayout({ ...DEFAULT_LAYOUT, v: undefined }, KNOWN)).toBeNull();
    expect(parseLayout(null, KNOWN)).toBeNull();
    expect(parseLayout("{nope", KNOWN)).toBeNull();
    expect(parseLayout({ v: 1, left: DEFAULT_LAYOUT.left }, KNOWN)).toBeNull();
    expect(
      parseLayout({ ...DEFAULT_LAYOUT, left: { ...DEFAULT_LAYOUT.left, width: "wide" } }, KNOWN),
    ).toBeNull();
    expect(
      parseLayout({ ...DEFAULT_LAYOUT, right: { ...DEFAULT_LAYOUT.right, groups: [] } }, KNOWN),
    ).toBeNull();
    const three = [...DEFAULT_LAYOUT.right.groups, DEFAULT_LAYOUT.right.groups[0]];
    expect(
      parseLayout({ ...DEFAULT_LAYOUT, right: { ...DEFAULT_LAYOUT.right, groups: three } }, KNOWN),
    ).toBeNull();
  });

  it("drops unknown panels and groups they empty, and fixes the active tab", () => {
    const stored = structuredClone(CUSTOM) as EditorLayout;
    stored.right.groups[0]!.panels.push("ghost");
    stored.right.groups[0]!.active = "ghost";
    stored.left.groups[1]!.panels = ["gone"];
    stored.left.groups[1]!.active = "gone";
    const parsed = parseLayout(stored, KNOWN)!;
    expect(parsed.right.groups[0]).toMatchObject({
      panels: ["inspector", "history"],
      active: "inspector",
    });
    expect(parsed.left.groups[0]!.panels).toEqual(["outliner", "project", "settings"]);
    expect(parsed.left.groups).toHaveLength(1);
  });

  it("appends missing panels to their default group", () => {
    const stored = structuredClone(DEFAULT_LAYOUT) as EditorLayout;
    stored.right.groups[1]!.panels = ["problems"];
    const parsed = parseLayout(stored, [...KNOWN, "console"])!;
    expect(parsed.right.groups[1]!.panels).toEqual(["problems", "run", "history", "console"]);
  });

  it("keeps each panel once", () => {
    const stored = structuredClone(DEFAULT_LAYOUT) as EditorLayout;
    stored.left.groups[0]!.panels.push("inspector");
    const parsed = parseLayout(stored, KNOWN)!;
    expect(parsed.left.groups[0]!.panels).toEqual(["outliner", "inspector"]);
    expect(parsed.right.groups).toHaveLength(1);
    expect(parsed.right.groups[0]).toMatchObject({
      panels: ["problems", "run", "history"],
      size: null,
    });
  });

  it("clamps stored sizes into the limits", () => {
    const stored = structuredClone(DEFAULT_LAYOUT) as EditorLayout;
    stored.left.width = 9999;
    stored.right.groups[1]!.size = 3;
    const parsed = parseLayout(stored, KNOWN)!;
    expect(parsed.left.width).toBe(LIMITS.column.max);
    expect(parsed.right.groups[1]!.size).toBe(LIMITS.group.min);
  });
});
