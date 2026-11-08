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
export type EditorLayout = { v: 1; left: ColumnState; right: ColumnState };

export const LIMITS = {
  column: { min: 232, max: 520 },
  /** The 28 px tab strip plus content. */
  group: { min: 96 },
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
    groups: [group(["outliner"], null), group(["project"], 260)],
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

const notBuilt = (name: string): Error => new Error(`${name}: not built`);

export const fitLayout: (layout: EditorLayout, viewport: Viewport) => FittedLayout = () => {
  throw notBuilt("fitLayout");
};
export const resizeColumn: (
  layout: EditorLayout,
  side: Side,
  width: number,
) => EditorLayout = () => {
  throw notBuilt("resizeColumn");
};
export const resizeSplit: (
  layout: EditorLayout,
  side: Side,
  bottomHeight: number,
) => EditorLayout = () => {
  throw notBuilt("resizeSplit");
};
export const toggleColumn: (
  layout: EditorLayout,
  side: Side,
  viewport: Viewport,
) => EditorLayout = () => {
  throw notBuilt("toggleColumn");
};
export const toggleGroup: (layout: EditorLayout, side: Side, group: 0 | 1) => EditorLayout = () => {
  throw notBuilt("toggleGroup");
};
export const selectTab: (layout: EditorLayout, panel: PanelId) => EditorLayout = () => {
  throw notBuilt("selectTab");
};
export const movePanel: (
  layout: EditorLayout,
  panel: PanelId,
  to: { side: Side; group: 0 | 1 },
) => EditorLayout = () => {
  throw notBuilt("movePanel");
};
/** Opens the panel's column and group, and selects it. */
export const revealPanel: (
  layout: EditorLayout,
  panel: PanelId,
  viewport: Viewport,
) => EditorLayout = () => {
  throw notBuilt("revealPanel");
};
/** The stored layout if its shape and version hold; unknown panels dropped, missing ones back in their default group. */
export const parseLayout: (raw: unknown, known: readonly PanelId[]) => EditorLayout | null = () => {
  throw notBuilt("parseLayout");
};
