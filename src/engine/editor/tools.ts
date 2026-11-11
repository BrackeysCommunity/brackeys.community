import type { Registry, Style } from "../game/types";
import type { Aabb, OpBatch, Pt, Ref, SceneDefinition, ShapeObj } from "../scene/types";
import type { EditorCommand } from "./keymap";
import type { SelectMode } from "./selection";

// ─── Settings the tools share ────────────────────────────

/** Grid snapping as the editor's settings hold it; persisted per viewer by the host. */
export type SnapSettings = {
  enabled: boolean;
  /** Metres between grid lines, one of `SNAP_STEPS`. */
  step: number;
  /** Snap to other entities' edges, vertices and centres after the grid. */
  geometry: boolean;
  /** Rotation snaps to this many degrees (15); Shift rotates freely. */
  angleDeg: number;
};

export const DEFAULT_SNAP: SnapSettings = {
  enabled: true,
  step: 0.5,
  geometry: true,
  angleDeg: 15,
};
/** The grid steps in metres; each is whole world px at any px per metre divisible by 4. */
export const SNAP_STEPS = [0.25, 0.5, 1, 2, 4] as const;

/** One entry of the spatial index: a ref, its world AABB and what picking needs to know about it. */
export type IndexEntry = {
  ref: Ref;
  /** The doc key, which stays put while bulk refs shift; the ref for a plain definition. */
  key: string;
  type: string;
  /** A registry layer's name. */
  layer: string;
  aabb: Aabb;
  /** Draw order: higher is on top. The registry's layer order first, then `z`, then document order. */
  z: number;
  /** The entity's geometry: a shape, or a point for point entities. */
  geometry: ShapeObj | Pt;
  /** The world box the entity's sprite draws, when it has one. */
  sprite?: ShapeObj;
};

/** The uniform grid of AABBs picking and marquee query. */
export type SpatialIndex = {
  /** Entries whose AABB intersects `rect`, topmost first. */
  query(rect: Aabb): IndexEntry[];
  get(ref: Ref): IndexEntry | undefined;
  entries(): IndexEntry[];
  readonly size: number;
};

// ─── What a tool shows ───────────────────────────────────

export type HandleKind =
  | "move"
  | "resize"
  | "rotate"
  | "radius"
  | "length"
  | "vertex"
  | "insert"
  | "waypoint";

/** A gizmo handle, drawn at a constant screen size. */
export type GizmoHandle = {
  /** Stable within one gizmo: `resize:nw`, `rotate`, `vertex:3`, `insert:2`, `waypoint:1`. */
  id: string;
  kind: HandleKind;
  at: Pt;
  /** A CSS cursor name for hover. */
  cursor?: string;
  active?: boolean;
};

export type OverlayTone = "selected" | "hover" | "invalid" | "ghost" | "guide";

/**
 * Everything a tool wants drawn over the scene this frame, in world
 * coordinates. The host draws it (the site in SVG over the canvas) and
 * never interprets it.
 */
export type ToolOverlay = {
  /**
   * `ref` names the entity an outline belongs to, so panels can match it.
   * `preview` marks where the drag in progress puts it, drawn filled; a
   * `ghost` outline is where it started.
   */
  outlines?: { shape: ShapeObj; tone: OverlayTone; ref?: Ref; preview?: boolean }[];
  points?: { at: Pt; tone: OverlayTone; ref?: Ref; preview?: boolean }[];
  /** One box around a selection of several items, or of an instance's children. */
  bounds?: Aabb;
  handles?: GizmoHandle[];
  /**
   * A drag-select rectangle; `touch` selects what it touches, not only what
   * it contains. `hits` is what releasing it now would select; the host
   * outlines them during the drag.
   */
  marquee?: { rect: Aabb; touch: boolean; hits?: Ref[] };
  /** Snap alignment lines. */
  guides?: { from: Pt; to: Pt }[];
  /** Paths and pen strokes; `numbered` labels each point from 0. */
  polylines?: {
    pts: Pt[];
    closed: boolean;
    dashed?: boolean;
    numbered?: boolean;
    tone: OverlayTone;
  }[];
  /** Shapes about to be placed. */
  ghosts?: { shape: ShapeObj; style?: Style; valid: boolean; reason?: string }[];
  /** The drag readout: `Δ 0.64, 0 m`, `W 1.6 H 0.16 m`, `37°`. */
  readout?: { at: Pt; text: string };
  /**
   * A fix the host may offer after a commit (a poly left concave offers
   * **Convert to chain**); the tool's `accept-offer` command applies it.
   */
  offer?: { label: string; batch: OpBatch };
  /** A setting of the active tool the host shows beside the tools (the type a draw tool adds). */
  option?: ToolOption;
};

/**
 * One choice the active tool offers. Picking a choice sends the tool the
 * command `<command><value>` (`type:nav`), which `tool:<id>:<command><value>`
 * also reaches from a key binding. Kept the same object while nothing in it
 * changes, so a host can compare it by identity.
 */
export type ToolOption = {
  label: string;
  value: string;
  choices: readonly { value: string; label: string; description?: string }[];
  command: string;
};

// ─── Tool input ──────────────────────────────────────────

export type ToolModifiers = { shift: boolean; alt: boolean; mod: boolean };

export type ToolPointerEvent = ToolModifiers & {
  type: "down" | "move" | "up" | "wheel";
  /** World metres under the pointer, unsnapped and unrounded. */
  world: Pt;
  button: number;
  deltaY: number;
  /** Presses in quick succession at about this spot: 2 on a double-click's second press. */
  clicks: number;
  /** CSS px from the canvas's top-left, for tools that work in screen space (panning). */
  screen?: Pt;
};

export type ToolKeyEvent = ToolModifiers & { type: "down" | "up"; key: string; repeat: boolean };

/** What the host gives a tool. */
export type EditorToolContext = {
  registry: Registry;
  getDoc(): SceneDefinition;
  selection(): readonly Ref[];
  select(refs: Ref[], mode?: SelectMode): void;
  /**
   * Reports the entity under the pointer, `null` for none. The host shares
   * it with the outliner and draws its hover outline; absent on a host that
   * shares no hover, where a tool draws its own.
   */
  hover?(ref: Ref | null): void;
  /** One gesture or stroke as one undoable batch; false when it didn't apply. */
  commit(batch: OpBatch, opts?: { selectionAfter?: Ref[] }): boolean;
  /**
   * Shows a batch without committing it (a drag in progress): the host
   * outlines the selection where the batch puts it; `null` puts it back.
   */
  preview(batch: OpBatch | null): void;
  /** The resolved document as the current preview shows it; `null` with nothing previewed. */
  previewDoc?(): SceneDefinition | null;
  /** Screen px per metre, for tolerances and handle sizes given in screen px. */
  scale(): number;
  snap(): SnapSettings;
  /** Kept current with the doc by the host. */
  index(): SpatialIndex;
  /** Layers hidden or locked in this editor; picking skips both. */
  layers(): { hidden: ReadonlySet<string>; locked: ReadonlySet<string> };
  /** Asks the host to draw the overlay again. */
  invalidate(): void;
  setTool(id: string): void;
  /** Point editing on one shape, which turns on the keymap's `sub-object` scope. */
  setSubObject(on: boolean): void;
  /** Shares a drag ghost (the keys moving and by how much) with other editors; `undefined` clears it. */
  shareGhost(ghost: { keys: string[]; by: Pt } | undefined): void;
  /** Pans the editor camera by a screen-px drag; absent when the host has no camera. */
  pan?(screenDelta: Pt): void;
};

/** A live tool. Every hook is optional; returning true claims the event. */
export type EditorTool = {
  pointer?(e: ToolPointerEvent): boolean;
  key?(e: ToolKeyEvent): boolean;
  /**
   * A command offered to the active tool before the host's default: an
   * engine command (nudge, rotate, delete-points), or the `<arg>` of a game
   * key bound to `tool:<id>:<arg>`.
   */
  command?(command: EditorCommand | (string & {})): boolean;
  /** Escape: true when the tool had a gesture or state of its own to drop. */
  cancel?(): boolean;
  /** A drag or stroke is in progress; the keymap's gesture context. */
  gesture?(): boolean;
  /** Point editing is on. */
  subObject?(): boolean;
  overlay?(): ToolOverlay;
  /** A CSS cursor name for the canvas while this tool is active. */
  cursor?(): string | undefined;
  destroy?(): void;
};

/**
 * A tool a game adds. An edit-scope `editorKeys` binding whose command is
 * `tool:<id>` picks it; `tool:<id>:<arg>` picks it and passes `<arg>` to
 * its `command`.
 */
export type EditorToolDef = {
  /** Unique among the engine's (`ENGINE_TOOL_IDS`) and the game's tools. */
  id: string;
  label: string;
  description: string;
  create(ctx: EditorToolContext): EditorTool;
};

/** Types a tool definition; a game lists the result in `GameDefinition.editor.tools`. */
export function defineEditorTool<T extends EditorToolDef>(def: T): T {
  return def;
}
