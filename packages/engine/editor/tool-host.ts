import { ENGINE_TOOL_IDS } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import type { SpriteAssetLookup } from "../scene/render-geometry";
import type { Aabb, OpBatch, Pt, Ref } from "../scene/types";
import { TOOL_PRIORITY, type ToolEvent, type ToolRouter } from "../tool-router";
import type { Vec2 } from "../types";
import { boxTool, circleTool } from "./builtin/draw";
import { penTool, waypointsTool } from "./builtin/polyline";
import { selectTool } from "./builtin/select";
import { panTool, rotateTool } from "./builtin/transform";
import { copySelection, cutSelection, duplicateSelection, pasteFragment } from "./clipboard";
import {
  deleteBatch,
  flipBatch,
  groupBatch,
  hierarchyDown,
  hierarchyUp,
  nudgeBatch,
  nudgeDelta,
  rotateSelectionBatch,
  selectAllRefs,
  selectionRoots,
  turnBatch,
  ungroupBatch,
  zOrderBatch,
} from "./commands";
import { createGesturePreview, type PreviewRuntime } from "./gesture";
import type { EditSource } from "./gizmos/tree";
import type { KeyContext } from "./keymap";
import {
  frameBounds,
  isComposite,
  marksBounds,
  outlineBounds,
  outlineLook,
  outlinesOfRef,
  type OutlineLook,
  type OutlineMarks,
} from "./outline-bounds";
import type { EditorSession } from "./session";
import { roundPt } from "./snap";
import { createSpatialIndex } from "./spatial-index";
import { setHover } from "./store";
import {
  DEFAULT_SNAP,
  type EditorTool,
  type EditorToolContext,
  type EditorToolDef,
  type SnapSettings,
  type SpatialIndex,
  type ToolKeyEvent,
  type ToolModifiers,
  type ToolOption,
  type ToolOverlay,
  type ToolPointerEvent,
} from "./tools";

export {
  frameBounds,
  marksBounds,
  outlineBounds,
  outlineLook,
  outlinesOfRef,
  type OutlineLook,
  type OutlineMarks,
} from "./outline-bounds";

/** How long the readout says why a command did nothing, unless the next input clears it first. */
const NOTICE_MS = 2500;

/** Presses this close in time (ms) and space (screen px) count as one multi-click. */
export const MULTI_CLICK_MS = 500;
/** The shortest gap between two cursor positions sent to other editors, as canvases throttle theirs. */
export const CURSOR_THROTTLE_MS = 40;
export const MULTI_CLICK_PX = 5;
/** How much one wheel notch (`deltaY` 100) zooms when no tool takes the wheel. */
export const WHEEL_ZOOM = 1.15;

/** The engine's tools, one fresh list per call: select, pan, box, circle, pen, waypoints, rotate. */
export function builtinTools(): EditorToolDef[] {
  return [selectTool, panTool, boxTool, circleTool, penTool, waypointsTool, rotateTool];
}

export type ToolLayers = { hidden: ReadonlySet<string>; locked: ReadonlySet<string> };

export type ToolHostOptions = {
  session: EditorSession;
  /** The shell's router; the host registers one pointer consumer at `TOOL_PRIORITY.editor`. */
  router: ToolRouter;
  /** Router screen px to world metres: the shell's `screenToWorld`. */
  toWorld: (screen: Vec2) => Pt;
  /** Screen px per metre now. */
  scale: () => number;
  /**
   * A runtime to show previews in as well as the overlay. The editor leaves
   * it out, so the edit world only ever holds committed state.
   */
  runtime?: PreviewRuntime | null;
  /** The game's tools (`GameDefinition.editor.tools()`, loaded); an engine id or a repeated id throws. */
  gameTools?: readonly EditorToolDef[];
  /** Replacements for built-in tools, by their engine id (a box tool drawing another type). */
  engineTools?: readonly EditorToolDef[];
  snap?: SnapSettings;
  layers?: { hidden?: Iterable<string>; locked?: Iterable<string> };
  /** Pans the camera by a screen-px drag (the pan tool, Space, the middle button). */
  pan?: (screenDelta: Pt) => void;
  /** Zooms about a screen point, for wheel turns no tool takes. */
  zoomAt?: (screen: Pt, factor: number) => void;
  /** Frames a world rect (the `frame` command). */
  frame?: (rect: Aabb) => void;
  /** After anything the overlay, cursor or key context depend on changed. */
  onChange?: () => void;
  /** Clock for multi-click detection; default `performance.now`. */
  now?: () => number;
  /** The tool to start with; default `select`. */
  tool?: string;
  /**
   * Asset info for sizing sprite boxes (`ProjectRuntimeView.asset`), read at
   * each re-index; call `reindex` when its answers change.
   */
  asset?: SpriteAssetLookup;
};

export type ToolHost = {
  /** Picks a tool and passes it `arg` as a command; false for an unknown id. */
  setTool(id: string, arg?: string): boolean;
  /** The active tool's id. */
  tool(): string;
  /** Every tool the host can pick: the engine's, then the game's. */
  tools(): readonly EditorToolDef[];
  /** What to draw this frame: the selection's outlines (as previewed) and the active tool's overlay. */
  overlay(): ToolOverlay;
  /** The active tool's setting (`overlay().option`), without building the selection's outlines. */
  option(): ToolOption | undefined;
  /** The canvas cursor the active tool asks for. */
  cursor(): string | undefined;
  /** The parts of the keymap's context the host knows. */
  keyContext(): Pick<KeyContext, "gesture" | "subObject" | "tool" | "hasSelection">;
  /**
   * A key press or release for the active tool (the pen's Enter and
   * Backspace); call it before resolving the keymap and stop when it returns
   * true. An unclaimed Enter enters point editing; releasing Space ends a
   * held pan.
   */
  key(e: ToolKeyEvent): boolean;
  /**
   * A keymap command or a host button: `tool:<id>[:<arg>]` picks a tool;
   * anything else goes to the active tool first, then the host's defaults
   * (nudge, rotate, turn, flip, select-all, group, ungroup, bring-forward,
   * send-backward, hierarchy, delete,
   * duplicate, toggle-snap, frame, undo, redo, pan-hold and Escape's
   * commands). True when it applied.
   */
  command(command: string): boolean;
  /** Escape: cancels the gesture, else leaves point editing, else drops the tool, else clears the selection. */
  cancel(): boolean;
  snap(): SnapSettings;
  setSnap(patch: Partial<SnapSettings>): void;
  layers(): ToolLayers;
  setLayers(patch: { hidden?: Iterable<string>; locked?: Iterable<string> }): void;
  /** The spatial index the tools pick from, kept current with the session. */
  index(): SpatialIndex;
  /** Rebuilds the index, for when the `asset` lookup's answers changed. */
  reindex(): void;
  /** The selection as clipboard text; empty with nothing selected. */
  copy(): string;
  /** The selection's clipboard text, removing it in one batch; empty with nothing selected. */
  cut(): string;
  /** Pastes clipboard text centred at `at` (default the last pointer position) in one batch. */
  paste(text: string, at?: Pt): boolean;
  /** Copies the selection one grid step down and right, in one batch. */
  duplicate(): boolean;
  /** The box around the selection; `null` when nothing selected has geometry. */
  selectionBounds(): Aabb | null;
  /** Applies the active tool's overlay offer (**Convert to chain**). */
  acceptOffer(): boolean;
  /** The last pointer position in world metres; `null` before any. */
  pointerWorld(): Pt | null;
  subscribe(listener: () => void): () => void;
  destroy(): void;
};

const modsOf = (n: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>>) => ({
  shift: n.shiftKey === true,
  alt: n.altKey === true,
  mod: n.ctrlKey === true || n.metaKey === true,
});

/** A router key event as a tool sees it. */
export function toolKeyEventOf(e: Extract<ToolEvent, { kind: "key" }>): ToolKeyEvent {
  return { type: e.type, key: e.key, repeat: e.native.repeat === true, ...modsOf(e.native) };
}

const isSpace = (key: string) => key === " " || key === "Space" || key === "Spacebar";

/**
 * Runs the editor's tools on a session: takes the canvas's pointer events
 * from the router, keeps a spatial index current, previews gestures in the
 * overlay (and in `runtime` when given one) and commits each as one batch,
 * and carries the commands the keymap resolves. Framework-free; the site draws `overlay()`
 * and calls `key` and `command` from its keymap consumer.
 */
export function createToolHost(opts: ToolHostOptions): ToolHost {
  const { session, router } = opts;
  const registry = session.registry;
  const listeners = new Set<() => void>();
  const now = opts.now ?? (() => performance.now());
  let lastCursorAt = -Infinity;

  const defs = new Map<string, EditorToolDef>();
  for (const t of builtinTools()) defs.set(t.id, t);
  for (const t of opts.engineTools ?? []) {
    if (!(ENGINE_TOOL_IDS as readonly string[]).includes(t.id))
      throw new Error(`engine tool "${t.id}" replaces no engine tool`);
    defs.set(t.id, t);
  }
  const gameIds = new Set<string>();
  for (const t of opts.gameTools ?? []) {
    if ((ENGINE_TOOL_IDS as readonly string[]).includes(t.id))
      throw new Error(`game tool "${t.id}" reuses an engine tool id`);
    if (gameIds.has(t.id)) throw new Error(`game tool "${t.id}" is listed twice`);
    gameIds.add(t.id);
    defs.set(t.id, t);
  }

  let snap: SnapSettings = { ...(opts.snap ?? DEFAULT_SNAP) };
  let layers: ToolLayers = {
    hidden: new Set(opts.layers?.hidden ?? []),
    locked: new Set(opts.layers?.locked ?? []),
  };
  const index = createSpatialIndex({
    keyOf: (r) => session.keyOf(r),
    ...(opts.asset ? { asset: opts.asset } : {}),
  });
  const editSource = (): EditSource => ({ doc: session.getDoc(), prefabs: session.getPrefabs() });
  index.rebuild(session.getResolved(), registry, editSource());
  const gesture = createGesturePreview({
    registry,
    getDoc: () => session.getResolved(),
    runtime: opts.runtime,
  });

  let activeId = "";
  let active: EditorTool | null = null;
  let subObject = false;
  /** The tool to go back to when a held Space is released. */
  let held: string | null = null;
  let pressed: number | null = null;
  let lastPress: { t: number; at: Vec2; button: number; clicks: number } | null = null;
  let middlePan: Vec2 | null = null;
  let cursorWorld: Pt | null = null;
  /** Why the last command did nothing, shown as the readout beside the selection. */
  let notice: { at: Pt; text: string } | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  function emit(): void {
    if (destroyed) return;
    opts.onChange?.();
    for (const l of listeners) l();
  }

  function commit(batch: OpBatch, o?: { selectionAfter?: Ref[] }): boolean {
    gesture.preview(null);
    const result = session.dispatch(batch, {
      resolved: true,
      ...(o?.selectionAfter ? { selectionAfter: o.selectionAfter } : {}),
    });
    emit();
    return result.ok;
  }

  const selection = () => session.store.state.selection;

  const ctx: EditorToolContext = {
    registry,
    getDoc: () => session.getResolved(),
    selection,
    select(refs, mode) {
      session.select(refs, mode);
      emit();
    },
    hover: (ref) => setHover(session.store, ref),
    commit,
    preview(batch) {
      gesture.preview(batch);
      emit();
    },
    previewDoc: () => gesture.def(),
    scale: () => opts.scale(),
    snap: () => snap,
    index: () => index,
    layers: () => layers,
    invalidate: emit,
    setTool: (id) => void setTool(id),
    setSubObject(on) {
      if (subObject === on) return;
      subObject = on;
      emit();
    },
    shareGhost: (ghost) => session.setGhost(ghost),
    source: editSource,
    ...(opts.pan ? { pan: opts.pan } : {}),
  };

  function setTool(id: string, arg?: string): boolean {
    const def = defs.get(id);
    if (!def || destroyed) return false;
    if (id !== activeId || !active) {
      const old = active;
      active = null;
      old?.cancel?.();
      old?.destroy?.();
      gesture.preview(null);
      session.setGhost(undefined);
      subObject = false;
      activeId = id;
      active = def.create(ctx);
      session.setTool(id);
      session.store.setState((s) => ({ ...s, tool: id }));
    }
    if (arg !== undefined) active.command?.(arg);
    emit();
    return true;
  }

  // ─── Pointer input ──────────────────────────────────────

  function pointer(e: Extract<ToolEvent, { kind: "pointer" }>): boolean {
    if (e.type === "down") clearNotice();
    const world = opts.toWorld(e.screen);
    const screen: Pt = [e.screen.x, e.screen.y];
    cursorWorld = world;
    const mods: ToolModifiers = modsOf(e.native);

    if (middlePan || (e.type === "down" && e.button === 1 && opts.pan)) {
      if (e.type === "down") middlePan = e.screen;
      else if (e.type === "move" && middlePan) {
        opts.pan?.([e.screen.x - middlePan.x, e.screen.y - middlePan.y]);
        middlePan = e.screen;
      } else if (e.type === "up") middlePan = null;
      return true;
    }

    let clicks = 1;
    if (e.type === "down") {
      const t = now();
      const p = lastPress;
      const near =
        p !== null &&
        p.button === e.button &&
        t - p.t <= MULTI_CLICK_MS &&
        Math.hypot(e.screen.x - p.at.x, e.screen.y - p.at.y) <= MULTI_CLICK_PX;
      clicks = near ? p.clicks + 1 : 1;
      lastPress = { t, at: e.screen, button: e.button, clicks };
      pressed = e.button;
    } else if (lastPress) clicks = lastPress.clicks;

    const event: ToolPointerEvent = {
      type: e.type,
      world,
      screen,
      button: e.type === "move" && pressed !== null ? pressed : e.button,
      deltaY: e.deltaY,
      clicks,
      ...mods,
    };
    if (e.type === "up") pressed = null;
    if (e.type === "move") {
      const t = now();
      if (t - lastCursorAt >= CURSOR_THROTTLE_MS) {
        lastCursorAt = t;
        session.setCursor(roundPt(world, pxPerMetreOf(registry)));
      }
    }

    const claimed = active?.pointer?.(event) ?? false;
    if (!claimed && e.type === "wheel" && opts.zoomAt && e.deltaY !== 0) {
      opts.zoomAt(screen, WHEEL_ZOOM ** (-e.deltaY / 100));
      return true;
    }
    return claimed;
  }

  const editing = () => !destroyed && session.store.state.mode === "edit";

  const unregister = router.register({
    id: "editor-tools",
    priority: TOOL_PRIORITY.editor,
    // Moves are seen but never claimed, so the shell still tracks the pointer (`pointerWorld`).
    accepts(e) {
      if (e.kind !== "pointer" || !editing()) return false;
      if (e.type === "move") {
        pointer(e);
        return false;
      }
      return true;
    },
    handle(e) {
      if (e.kind === "pointer") pointer(e);
    },
  });

  // The overlay outlines the selection and the hover, which the panels change too.
  let seen = session.store.state;
  const unwatchStore = session.store.subscribe(() => {
    const next = session.store.state;
    if (next.hover === seen.hover && next.selection === seen.selection) return;
    seen = next;
    emit();
  });

  const unsubscribe = session.subscribe((e) => {
    index.update(session.getResolved(), registry, e.touched, editSource());
    emit();
  });

  // ─── Commands ───────────────────────────────────────────

  function apply(batch: OpBatch | null, selectionAfter?: Ref[]): boolean {
    return batch !== null && commit(batch, selectionAfter ? { selectionAfter } : undefined);
  }

  function clearNotice(): void {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    noticeTimer = undefined;
    if (notice === null) return;
    notice = null;
    emit();
  }

  /** Says why a command did nothing, beside the selection (else the pointer) for a moment; false, as the command is. */
  function refuse(text: string): false {
    clearNotice();
    const box = outlineBounds(session.getResolved(), selection(), look());
    const at: Pt | null = box ? [box.maxX, box.minY] : cursorWorld;
    if (at === null) return false;
    notice = { at, text };
    noticeTimer = setTimeout(clearNotice, NOTICE_MS);
    emit();
    return false;
  }

  function selectRefs(refs: Ref[] | null): boolean {
    if (!refs) return false;
    ctx.select(refs);
    return true;
  }

  function dropGesture(): void {
    if (active?.gesture?.()) active.cancel?.();
  }

  function cancel(): boolean {
    if (!active) return false;
    if (active.gesture?.() || subObject || active.subObject?.()) {
      if (active.cancel?.()) return true;
      if (subObject) {
        subObject = false;
        emit();
        return true;
      }
    }
    if (activeId !== "select") {
      if (active.cancel?.()) return true;
      held = null;
      return setTool("select");
    }
    if (selection().length > 0) {
      ctx.select([]);
      return true;
    }
    return false;
  }

  function defaults(command: string): boolean {
    const def = session.getResolved();
    const doc = session.getDoc();
    const prefabs = session.getPrefabs();
    const sel = selection();
    const ppm = pxPerMetreOf(registry);
    const delta = nudgeDelta(command, ppm);
    if (delta) return apply(nudgeBatch(selectionRoots(doc, sel), delta, ppm));
    switch (command) {
      case "rotate-cw":
      case "rotate-ccw": {
        const deg = (command === "rotate-cw" ? 1 : -1) * (snap.angleDeg > 0 ? snap.angleDeg : 15);
        return apply(rotateSelectionBatch(doc, registry, sel, deg, prefabs));
      }
      case "turn-cw":
      case "turn-ccw":
        return apply(turnBatch(session.getDoc(), sel, command === "turn-cw" ? 1 : -1));
      case "flip-x":
      case "flip-y":
        return apply(flipBatch(session.getDoc(), sel, command === "flip-x" ? "x" : "y"));
      case "select-all":
        return selectRefs(selectAllRefs(def, index, layers));
      case "group": {
        const edit = groupBatch(doc, registry, sel, prefabs);
        if (edit) return apply(edit.batch, edit.select);
        return sel.length > 0 && refuse("Nothing selected can go under a node.");
      }
      case "ungroup": {
        const edit = ungroupBatch(doc, sel);
        if (edit) return apply(edit.batch, edit.select);
        return sel.length > 0 && refuse("Select a node to ungroup.");
      }
      case "bring-forward":
        return apply(zOrderBatch(sel, 1));
      case "send-backward":
        return apply(zOrderBatch(sel, -1));
      case "hierarchy-up":
        return selectRefs(hierarchyUp(doc, sel));
      case "hierarchy-down":
        return selectRefs(hierarchyDown(doc, registry, sel, prefabs));
      case "delete":
        return apply(deleteBatch(sel));
      case "duplicate":
        return host.duplicate();
      case "toggle-snap":
        host.setSnap({ enabled: !snap.enabled });
        return true;
      case "frame": {
        if (!opts.frame) return false;
        const [minX, minY, maxX, maxY] = def.bounds;
        opts.frame(frameBounds(def, sel, look()) ?? { minX, minY, maxX, maxY });
        return true;
      }
      case "undo":
      case "redo": {
        dropGesture();
        const ok = command === "undo" ? session.undo() : session.redo();
        emit();
        return ok;
      }
      case "pan-hold":
        if (held !== null || activeId === "pan") return true;
        held = activeId;
        return setTool("pan");
      case "cancel-gesture":
      case "leave-sub-object":
      case "clear-tool":
      case "clear-selection":
        return cancel();
      default:
        return false;
    }
  }

  const look = (): OutlineLook => outlineLook(registry, opts.asset, editSource());

  /**
   * The overlay's outlines: the selection's, the shared hover's and the
   * marquee's would-be selection. While a drag previews, the selection is
   * outlined where the preview puts it, over a ghost of where it started.
   */
  function selectionOverlay(own: ToolOverlay): ToolOverlay {
    const previewed = gesture.def();
    const committed = session.getResolved();
    const def = previewed ?? committed;
    const sel = selection();
    const ghost: OutlineMarks = { outlines: [], points: [] };
    const outline = look();
    if (previewed) for (const ref of sel) outlinesOfRef(committed, ref, "ghost", ghost, outline);
    const marks: OutlineMarks = { outlines: [], points: [] };
    for (const ref of sel) outlinesOfRef(def, ref, "selected", marks, outline);
    const bounds =
      sel.length > 1 || (sel.length === 1 && isComposite(def, sel[0]!, outline))
        ? marksBounds(marks.outlines, marks.points)
        : null;
    if (previewed) {
      marks.outlines = [...ghost.outlines, ...marks.outlines.map((o) => ({ ...o, preview: true }))];
      marks.points = [...ghost.points, ...marks.points.map((p) => ({ ...p, preview: true }))];
    }
    const taken = new Set(sel);
    const gesturing = active?.gesture?.() ?? false;
    const hover = session.store.state.hover;
    if (!gesturing && hover !== null && !taken.has(hover))
      outlinesOfRef(def, hover, "hover", marks, outline);
    for (const ref of own.marquee?.hits ?? [])
      if (!taken.has(ref)) outlinesOfRef(def, ref, "hover", marks, outline);
    return { ...marks, ...(bounds ? { bounds } : {}) };
  }

  const host: ToolHost = {
    setTool,
    tool: () => activeId,
    tools: () => [...defs.values()],
    overlay() {
      const own = active?.overlay?.() ?? {};
      const sel = selectionOverlay(own);
      const outlines = [...(sel.outlines ?? []), ...(own.outlines ?? [])];
      const points = [...(sel.points ?? []), ...(own.points ?? [])];
      return {
        ...own,
        ...(outlines.length > 0 ? { outlines } : {}),
        ...(points.length > 0 ? { points } : {}),
        ...(sel.bounds ? { bounds: sel.bounds } : {}),
        ...(notice && !own.readout ? { readout: notice } : {}),
      };
    },
    option: () => active?.overlay?.()?.option,
    cursor: () => active?.cursor?.(),
    keyContext: () => ({
      gesture: active?.gesture?.() ?? false,
      subObject: subObject || (active?.subObject?.() ?? false),
      tool: activeId,
      hasSelection: selection().length > 0,
    }),
    key(e) {
      if (active?.key?.(e)) return true;
      if (e.type === "up" && isSpace(e.key) && held !== null) {
        const back = held;
        held = null;
        return setTool(back);
      }
      if (e.type === "down" && e.key === "Enter" && !e.shift && !e.alt && !e.mod)
        return host.command("enter-sub-object");
      return false;
    },
    command(command) {
      if (destroyed) return false;
      clearNotice();
      const pick = /^tool:([^:]+)(?::(.*))?$/.exec(command);
      if (pick) {
        held = null;
        return setTool(pick[1]!, pick[2]);
      }
      if (active?.command?.(command)) {
        emit();
        return true;
      }
      return defaults(command);
    },
    cancel,
    snap: () => snap,
    setSnap(patch) {
      snap = { ...snap, ...patch };
      emit();
    },
    layers: () => layers,
    setLayers(patch) {
      layers = {
        hidden: patch.hidden ? new Set(patch.hidden) : layers.hidden,
        locked: patch.locked ? new Set(patch.locked) : layers.locked,
      };
      emit();
    },
    index: () => index,
    reindex() {
      index.rebuild(session.getResolved(), registry, editSource());
      emit();
    },
    copy: () =>
      selection().length > 0
        ? copySelection(session.getDoc(), selection(), registry, session.getPrefabs())
        : "",
    cut() {
      const sel = selection();
      if (sel.length === 0) return "";
      const { text, batch } = cutSelection(session.getDoc(), sel, registry, session.getPrefabs());
      return commit(batch) ? text : "";
    },
    paste(text, at) {
      const result = pasteFragment(text, {
        def: session.getDoc(),
        registry,
        prefabs: session.getPrefabs(),
        snap,
        ...((at ?? cursorWorld) ? { at: at ?? cursorWorld! } : {}),
      });
      return result.ok && commit(result.batch, { selectionAfter: result.select });
    },
    duplicate() {
      const sel = selection();
      if (sel.length === 0) return false;
      const result = duplicateSelection(session.getDoc(), sel, registry, snap.step, {
        prefabs: session.getPrefabs(),
      });
      return result.ok && commit(result.batch, { selectionAfter: result.select });
    },
    selectionBounds: () => outlineBounds(session.getResolved(), selection(), look()),
    acceptOffer: () => host.command("accept-offer"),
    pointerWorld: () => cursorWorld,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      if (noticeTimer !== undefined) clearTimeout(noticeTimer);
      active?.cancel?.();
      active?.destroy?.();
      active = null;
      gesture.preview(null);
      session.setGhost(undefined);
      destroyed = true;
      unregister();
      unsubscribe();
      unwatchStore();
      listeners.clear();
    },
  };

  setTool(opts.tool && defs.has(opts.tool) ? opts.tool : "select");
  return host;
}
