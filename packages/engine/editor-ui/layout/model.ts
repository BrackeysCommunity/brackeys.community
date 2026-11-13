/**
 * The editor frame's layout: two columns of at most two tab groups each,
 * sized in pixels. Stored sizes are the viewer's; `fitLayout` derives what
 * is drawn for a window and never writes back. Pure: no React, no DOM.
 */

export type Side = "left" | "right";
export type PanelId =
  | "outliner"
  | "project"
  | "inspector"
  | "problems"
  | "run"
  | "history"
  | (string & {});
export type GroupState = {
  panels: PanelId[];
  active: PanelId;
  /** px of the bottom group; the top group takes the rest. Null on a top group. */
  size: number | null;
  collapsed: boolean;
};
export type ColumnState = {
  width: number;
  collapsed: boolean;
  groups: [GroupState] | [GroupState, GroupState];
};
export type EditorLayout = {
  v: 1;
  left: ColumnState;
  right: ColumnState;
  /** The column opened last: the one drawn when only one fits. Default the right. */
  lastOpened?: Side;
};

export const LIMITS = {
  column: { min: 232, max: 520 },
  /**
   * The 28 px tab strip plus content. With both groups open, the top one
   * keeps `topShare` of the room they share, however tall the bottom one is
   * stored, and a bottom one with no stored height starts at `bottomShare`.
   */
  group: { min: 96, topShare: 0.4, bottomShare: 0.4 },
  canvas: { min: 320 },
  phone: 640,
} as const;

const group = (panels: [PanelId, ...PanelId[]], size: number | null): GroupState => ({
  panels,
  active: panels[0],
  size,
  collapsed: false,
});

export const DEFAULT_LAYOUT: EditorLayout = {
  v: 1,
  left: {
    width: 288,
    collapsed: false,
    groups: [group(["outliner"], null), group(["project", "settings"], 260)],
  },
  right: {
    width: 320,
    collapsed: false,
    groups: [group(["inspector"], null), group(["problems", "run", "history"], 240)],
  },
};

export type Viewport = {
  width: number;
  height: number;
  /** The heights of the host's islands over each column's top. */
  topLeft: number;
  topRight: number;
  bottom: number;
};
export type FittedColumn = {
  x: number;
  y: number;
  width: number;
  height: number;
  rail: boolean;
  /** Each group's top (from the column's top) and height; empty on a rail. */
  groups: { y: number; height: number; collapsed: boolean }[];
};
export type FittedLayout = {
  mode: "desktop" | "single" | "phone";
  /** Null when the column isn't drawn. */
  left: FittedColumn | null;
  right: FittedColumn | null;
  /** What the columns cover of the canvas, so framing can keep a target in the visible part. */
  canvas: { left: number; right: number; top: number; bottom: number };
};

/** The frame's distances in px, matching `--je-inset`, `--je-gap`, `--je-rail` and `--je-tab`. */
export const FRAME = { inset: 8, gap: 8, rail: 36, strip: 28 } as const;
const { inset: INSET, gap: GAP, rail: RAIL, strip: STRIP } = FRAME;

const SIDES: readonly Side[] = ["left", "right"];
const other = (side: Side): Side => (side === "left" ? "right" : "left");
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const columnWidth = (width: number): number =>
  Math.round(clamp(width, LIMITS.column.min, LIMITS.column.max));

// ─── Fitting ─────────────────────────────────────────────

/** Whether both columns open, at their minimums, still leave the canvas its minimum. */
const bothFit = (viewportWidth: number): boolean =>
  viewportWidth - 2 * INSET - 2 * LIMITS.column.min >= LIMITS.canvas.min;

/** The heights a bottom group may be drawn at when both groups open in `room` px (the column less the gap). */
export function splitRange(room: number): { min: number; max: number } {
  const { min, topShare } = LIMITS.group;
  const top = Math.max(min, Math.round(room * topShare));
  return { min, max: Math.max(min, room - top) };
}

function fitGroups(column: ColumnState, height: number): FittedColumn["groups"] {
  const [top, bottom] = column.groups;
  if (!bottom) {
    return [{ y: 0, height: top.collapsed ? STRIP : height, collapsed: top.collapsed }];
  }
  const room = height - GAP;
  let topCollapsed = top.collapsed;
  let bottomCollapsed = bottom.collapsed;
  if (!topCollapsed && !bottomCollapsed && room < 2 * LIMITS.group.min) bottomCollapsed = true;
  if (!topCollapsed && bottomCollapsed && room - STRIP < LIMITS.group.min) topCollapsed = true;

  let topHeight: number;
  let bottomHeight: number;
  if (topCollapsed && bottomCollapsed) {
    topHeight = STRIP;
    bottomHeight = STRIP;
  } else if (topCollapsed) {
    topHeight = STRIP;
    bottomHeight = Math.max(STRIP, room - STRIP);
  } else if (bottomCollapsed) {
    bottomHeight = STRIP;
    topHeight = Math.max(STRIP, room - STRIP);
  } else {
    const stored = bottom.size ?? room * LIMITS.group.bottomShare;
    const range = splitRange(room);
    bottomHeight = Math.round(clamp(stored, range.min, range.max));
    topHeight = room - bottomHeight;
  }
  const bottomY = topCollapsed && bottomCollapsed ? STRIP + GAP : height - bottomHeight;
  return [
    { y: 0, height: topHeight, collapsed: topCollapsed },
    { y: bottomY, height: bottomHeight, collapsed: bottomCollapsed },
  ];
}

function fitColumn(
  column: ColumnState,
  side: Side,
  width: number,
  rail: boolean,
  viewport: Viewport,
): FittedColumn {
  const island = side === "left" ? viewport.topLeft : viewport.topRight;
  const y = INSET + (island > 0 ? island + GAP : 0);
  const height = Math.max(0, viewport.height - y - INSET);
  const drawn = rail ? RAIL : width;
  return {
    x: side === "left" ? INSET : viewport.width - INSET - drawn,
    y,
    width: drawn,
    height,
    rail,
    groups: rail ? [] : fitGroups(column, height),
  };
}

/**
 * What the frame draws for this window. Columns shrink toward their minimums
 * before the canvas goes under its own; past that only one column is drawn
 * (`single`: with both stored open, the one opened last) and the other is a rail;
 * under `LIMITS.phone` the frame uses its phone layout and draws no column.
 */
export const fitLayout = (layout: EditorLayout, viewport: Viewport): FittedLayout => {
  const top = Math.max(viewport.topLeft, viewport.topRight);
  const canvasTop = top > 0 ? INSET + top : 0;
  const canvasBottom = viewport.bottom > 0 ? INSET + viewport.bottom : 0;

  if (viewport.width < LIMITS.phone) {
    return {
      mode: "phone",
      left: null,
      right: null,
      canvas: { left: 0, right: 0, top: canvasTop, bottom: canvasBottom },
    };
  }

  const open = { left: !layout.left.collapsed, right: !layout.right.collapsed };
  let mode: FittedLayout["mode"] = "desktop";
  if (open.left && open.right && !bothFit(viewport.width)) {
    mode = "single";
    open[other(layout.lastOpened ?? "right")] = false;
  }

  const want = {
    left: open.left ? columnWidth(layout.left.width) : RAIL,
    right: open.right ? columnWidth(layout.right.width) : RAIL,
  };
  const room = viewport.width - 2 * INSET - LIMITS.canvas.min;
  const deficit = want.left + want.right - room;
  if (deficit > 0) {
    const slack = {
      left: open.left ? want.left - LIMITS.column.min : 0,
      right: open.right ? want.right - LIMITS.column.min : 0,
    };
    const total = slack.left + slack.right;
    const cut = Math.min(deficit, total);
    if (total > 0) {
      const leftCut = Math.min(slack.left, Math.ceil((cut * slack.left) / total));
      want.left -= leftCut;
      want.right -= cut - leftCut;
    }
  }

  const left = fitColumn(layout.left, "left", want.left, !open.left, viewport);
  const right = fitColumn(layout.right, "right", want.right, !open.right, viewport);
  return {
    mode,
    left,
    right,
    canvas: {
      left: left.x + left.width,
      right: viewport.width - right.x,
      top: canvasTop,
      bottom: canvasBottom,
    },
  };
};

// ─── Edits ───────────────────────────────────────────────

const withColumn = (layout: EditorLayout, side: Side, column: ColumnState): EditorLayout =>
  side === "left" ? { ...layout, left: column } : { ...layout, right: column };

export const resizeColumn = (layout: EditorLayout, side: Side, width: number): EditorLayout => {
  if (!Number.isFinite(width)) return layout;
  const column = layout[side];
  const next = columnWidth(width);
  return next === column.width ? layout : withColumn(layout, side, { ...column, width: next });
};

/** Sets the bottom group's height; the drawn height is still bounded by the column's. */
export const resizeSplit = (
  layout: EditorLayout,
  side: Side,
  bottomHeight: number,
): EditorLayout => {
  const column = layout[side];
  const [top, bottom] = column.groups;
  if (!bottom || !Number.isFinite(bottomHeight)) return layout;
  const size = Math.round(Math.max(LIMITS.group.min, bottomHeight));
  if (size === bottom.size) return layout;
  return withColumn(layout, side, { ...column, groups: [top, { ...bottom, size }] });
};

/**
 * Opens a column and records it as the one opened last, so a window too
 * narrow for both draws it and the other as a rail. The other column's
 * stored state is untouched: widening the window brings both back.
 */
function openColumn(layout: EditorLayout, side: Side): EditorLayout {
  const next = layout[side].collapsed
    ? withColumn(layout, side, { ...layout[side], collapsed: false })
    : layout;
  return next.lastOpened === side ? next : { ...next, lastOpened: side };
}

export const toggleColumn = (
  layout: EditorLayout,
  side: Side,
  viewport: Viewport,
): EditorLayout => {
  const shown = fitLayout(layout, viewport)[side];
  const drawnOpen = shown ? !shown.rail : !layout[side].collapsed;
  if (drawnOpen) return withColumn(layout, side, { ...layout[side], collapsed: true });
  return openColumn(layout, side);
};

const setGroup = (
  layout: EditorLayout,
  side: Side,
  index: 0 | 1,
  update: (group: GroupState) => GroupState,
): EditorLayout => {
  const column = layout[side];
  const [top, bottom] = column.groups;
  const groups: ColumnState["groups"] =
    index === 0 ? (bottom ? [update(top), bottom] : [update(top)]) : [top, update(bottom!)];
  return withColumn(layout, side, { ...column, groups });
};

export const toggleGroup = (layout: EditorLayout, side: Side, group: 0 | 1): EditorLayout => {
  if (!layout[side].groups[group]) return layout;
  return setGroup(layout, side, group, (g) => ({ ...g, collapsed: !g.collapsed }));
};

/**
 * `layout` holding exactly `known`, as when the frame's panels change: panels
 * no longer known leave it, and each one it lacks goes where `saved` keeps
 * it, when that group exists here, else to its home group. Columns, sizes and
 * tabs stay as `layout` has them, so the layout a person set outlives a
 * change of panels whatever `saved` holds.
 */
export function withPanels(
  layout: EditorLayout,
  known: readonly PanelId[],
  saved?: EditorLayout | null,
): EditorLayout {
  let next = layout;
  for (const panel of saved ? known : []) {
    if (panelGroup(next, panel)) continue;
    const at = panelGroup(saved!, panel);
    if (!at || !next[at.side].groups[at.group]) continue;
    next = setGroup(next, at.side, at.group, (g) => ({ ...g, panels: [...g.panels, panel] }));
  }
  return parseLayout(next, known) ?? layout;
}

/** The column and group that hold `panel`, or null when no group does. */
export function panelGroup(
  layout: EditorLayout,
  panel: PanelId,
): { side: Side; group: 0 | 1 } | null {
  for (const side of SIDES) {
    const index = layout[side].groups.findIndex((g) => g.panels.includes(panel));
    if (index === 0 || index === 1) return { side, group: index };
  }
  return null;
}

/**
 * The bottom-group height, px, a panel with long forms needs to be usable:
 * selecting it in a shorter bottom group grows the group to this (still
 * bounded by the column when drawn), and the viewer can shrink it again.
 */
const PANEL_HEIGHTS: Readonly<Partial<Record<PanelId, number>>> = { settings: 480, publish: 480 };

/** Where a panel only some hosts have starts, beside the project's other panels. */
const OPTIONAL_HOMES: Readonly<Partial<Record<PanelId, { side: Side; group: 0 | 1 }>>> = {
  publish: { side: "left", group: 1 },
};

export const selectTab = (layout: EditorLayout, panel: PanelId): EditorLayout => {
  const at = panelGroup(layout, panel);
  if (!at || layout[at.side].groups[at.group]?.active === panel) return layout;
  const wants = at.group === 1 ? PANEL_HEIGHTS[panel] : undefined;
  return setGroup(layout, at.side, at.group, (g) => ({
    ...g,
    active: panel,
    ...(wants !== undefined && g.size !== null && g.size < wants ? { size: wants } : {}),
  }));
};

/** The bottom group's height a column starts with when a panel moves into a new one. */
const defaultSplit = (side: Side): number => DEFAULT_LAYOUT[side].groups[1]?.size ?? 240;

/**
 * Moves a panel to the end of a group and selects it there. A group left
 * empty disappears; moving to a column's missing bottom group creates it. A
 * move that would leave a column with no group is refused.
 */
export const movePanel = (
  layout: EditorLayout,
  panel: PanelId,
  to: { side: Side; group: 0 | 1 },
): EditorLayout => {
  const from = panelGroup(layout, panel);
  if (!from) return layout;
  const source = layout[from.side].groups[from.group]!;
  if (from.side === to.side && from.group === to.group) return layout;
  if (source.panels.length === 1 && layout[from.side].groups.length === 1) return layout;

  type Slot = { panels: PanelId[]; active: PanelId; size: number | null; collapsed: boolean };
  const columns: Record<Side, Slot[]> = {
    left: layout.left.groups.map((g) => ({ ...g, panels: [...g.panels] })),
    right: layout.right.groups.map((g) => ({ ...g, panels: [...g.panels] })),
  };

  const target = columns[to.side][to.group];
  if (target) {
    target.panels.push(panel);
    target.active = panel;
  } else {
    columns[to.side].push({
      panels: [panel],
      active: panel,
      size: defaultSplit(to.side),
      collapsed: false,
    });
  }

  const emptied = columns[from.side][from.group]!;
  const at = emptied.panels.indexOf(panel);
  emptied.panels.splice(at, 1);
  if (emptied.active === panel) {
    emptied.active = emptied.panels[Math.min(at, emptied.panels.length - 1)] ?? panel;
  }
  if (emptied.panels.length === 0) columns[from.side].splice(from.group, 1);

  const rebuild = (side: Side): ColumnState => {
    const [top, bottom] = columns[side];
    const first: GroupState = { ...top!, size: null };
    const groups: ColumnState["groups"] = bottom
      ? [first, { ...bottom, size: bottom.size ?? defaultSplit(side) }]
      : [first];
    return { ...layout[side], groups };
  };
  return { ...layout, left: rebuild("left"), right: rebuild("right") };
};

/** Opens the panel's column and group, and selects it. */
export const revealPanel = (
  layout: EditorLayout,
  panel: PanelId,
  viewport: Viewport,
): EditorLayout => {
  const at = panelGroup(layout, panel);
  if (!at) return layout;
  let next = selectTab(layout, panel);
  if (next[at.side].groups[at.group]?.collapsed) next = toggleGroup(next, at.side, at.group);
  const shown = fitLayout(next, viewport)[at.side];
  const drawnOpen = shown ? !shown.rail : !next[at.side].collapsed;
  return drawnOpen ? next : openColumn(next, at.side);
};

// ─── Stored layouts ──────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type RawGroup = { panels: string[]; active: string; size: number | null; collapsed: boolean };

function readGroup(raw: unknown): RawGroup | null {
  if (!isRecord(raw)) return null;
  const { panels, active, size, collapsed } = raw;
  if (!Array.isArray(panels) || !panels.every((p) => typeof p === "string")) return null;
  if (typeof active !== "string" || typeof collapsed !== "boolean") return null;
  if (size !== null && !(typeof size === "number" && Number.isFinite(size))) return null;
  return { panels: panels as string[], active, size, collapsed };
}

function readColumn(
  raw: unknown,
): { width: number; collapsed: boolean; groups: RawGroup[] } | null {
  if (!isRecord(raw)) return null;
  const { width, collapsed, groups } = raw;
  if (typeof width !== "number" || !Number.isFinite(width) || typeof collapsed !== "boolean") {
    return null;
  }
  if (!Array.isArray(groups) || groups.length < 1 || groups.length > 2) return null;
  const read = groups.map(readGroup);
  if (read.some((g) => g === null)) return null;
  return { width, collapsed, groups: read as RawGroup[] };
}

/** The stored layout if its shape and version hold; unknown panels dropped, missing ones back in their default group. */
export const parseLayout = (raw: unknown, known: readonly PanelId[]): EditorLayout | null => {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || value.v !== 1) return null;
  const read = { left: readColumn(value.left), right: readColumn(value.right) };
  if (!read.left || !read.right) return null;

  const knownSet = new Set<PanelId>(known);
  const seen = new Set<PanelId>();
  const groups: Record<Side, RawGroup[]> = { left: [], right: [] };
  for (const side of SIDES) {
    for (const g of read[side]!.groups) {
      const panels = g.panels.filter((p) => knownSet.has(p) && !seen.has(p));
      for (const p of panels) seen.add(p);
      if (panels.length > 0) groups[side].push({ ...g, panels });
    }
  }

  for (const panel of known) {
    if (seen.has(panel)) continue;
    seen.add(panel);
    const home = panelGroup(DEFAULT_LAYOUT, panel) ??
      OPTIONAL_HOMES[panel] ?? { side: "right" as const, group: 1 as const };
    const column = groups[home.side];
    const into = column[Math.min(home.group, column.length - 1)];
    if (into) into.panels.push(panel);
    else column.push({ panels: [panel], active: panel, size: null, collapsed: false });
  }

  const column = (side: Side): ColumnState | null => {
    const [top, bottom] = groups[side];
    if (!top) return null;
    const settle = (g: RawGroup, size: number | null): GroupState => ({
      panels: g.panels,
      active: g.panels.includes(g.active) ? g.active : g.panels[0]!,
      size,
      collapsed: g.collapsed,
    });
    const bottomSize = (g: RawGroup): number =>
      Math.round(Math.max(LIMITS.group.min, g.size ?? defaultSplit(side)));
    return {
      width: columnWidth(read[side]!.width),
      collapsed: read[side]!.collapsed,
      groups: bottom
        ? [settle(top, null), settle(bottom, bottomSize(bottom))]
        : [settle(top, null)],
    };
  };
  const left = column("left");
  const right = column("right");
  if (!left || !right) return null;
  const last = value.lastOpened;
  return last === "left" || last === "right"
    ? { v: 1, left, right, lastOpened: last }
    : { v: 1, left, right };
};
