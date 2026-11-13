import { Store } from "@tanstack/store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

import {
  createKeymap,
  type EditorSession,
  type Keymap,
  type Ref as SceneRef,
  type SceneIssue,
} from "../../editor/index";
import { frameBounds, outlineBounds, outlineLook } from "../../editor/tool-host";
import type { RapierModule } from "../../index";
import type { AssetKey } from "../../project/index";
import { hostPeerColor, type EditorHost, type EditorPublishHost } from "../host";
import { cx, KitProvider, useKit } from "../kit/index";
import { useIsomorphicLayoutEffect, useWindowSize } from "../kit/ssr";
import {
  fitLayout,
  FRAME,
  panelGroup,
  revealPanel,
  selectTab,
  toggleColumn,
  type EditorLayout,
  type PanelId,
  type Side,
  type Viewport,
} from "../layout/model";
import { useLayout } from "../layout/use-layout";
import { CanvasLayer } from "../panels/canvas-layer/CanvasLayer";
import {
  createToolHostCell,
  hostAsset,
  useToolHost,
  useToolHostLifecycle,
} from "../panels/canvas-layer/tool-host";
import { CodeSkewNotice } from "../panels/CodeSkewNotice";
import { EditorCanvasOverlay } from "../panels/EditorCanvasOverlay";
import { EditorPlayBar } from "../panels/EditorPlayBar";
import { EditorStatusBar } from "../panels/EditorStatusBar";
import { EditorToolbar } from "../panels/EditorToolbar";
import { PeerColorProvider } from "../panels/peer-faces";
import { PrefabHeader } from "../panels/PrefabHeader";
import {
  createPanelContext,
  editorPanels,
  PANELS,
  type PanelContext,
  type PanelDef,
} from "../panels/registry";
import type { EditorHostState } from "../session/live-scene-editor";
import { createLoadedRunStore } from "../session/loaded-run";
import { useEditorStore } from "../session/use-editor-store";
import { usePhysicalIssues } from "../session/use-physical-issues";
import { useStoreValue, type ReadableStore } from "../session/use-store-value";
import { usePanelBadges } from "./badges";
import { Column, groupClass, type ColumnPanels } from "./Column";
import {
  useEditorClipboard,
  useEditorKeys,
  type EditorChromeProps,
  type EditorControls,
} from "./keys";
import { PanelGroup } from "./PanelGroup";
import { Rail, type RailPanel } from "./Rail";
import { frameInView, revealInView, setVisibleArea, type VisibleArea } from "./visible-rect";

export type { EditorChromeProps, EditorControls } from "./keys";

// ─── The frame ───────────────────────────────────────────

/** A floating panel of chrome over the canvas. */
export function Island({
  className,
  region = true,
  ...props
}: ComponentProps<"div"> & {
  /** A stop for F6; off when the island sits inside a bar that is one. */
  region?: boolean;
}) {
  return (
    <div
      data-je-region={region ? "" : undefined}
      className={cx("je-island", className)}
      {...props}
    />
  );
}

const REGION = "[data-je-region]";
/** What Tab would stop on; a roving tab strip's other tabs (`tabindex="-1"`) aren't. */
const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select",
  "textarea",
  "[tabindex]",
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(", ");

/**
 * Focuses a region: the canvas itself, else its first tabbable control, else
 * the island, made focusable for it, so a panel with nothing to press still
 * takes focus.
 */
export function focusRegion(region: HTMLElement): void {
  const target = region.hasAttribute("data-je-document")
    ? region
    : (region.querySelector<HTMLElement>(TABBABLE) ?? region);
  if (target === region && !region.hasAttribute("tabindex")) region.tabIndex = -1;
  target.focus({ preventScroll: true });
}

/** F6 and Shift+F6 move focus between the islands and the canvas, in document order. */
function useRegionCycling(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F6" || e.metaKey || e.ctrlKey || e.altKey) return;
      const frame = root.current;
      if (!frame) return;
      // An island inside a corner the frame already made a stop is not a second one.
      const all = [...frame.querySelectorAll<HTMLElement>(REGION)].filter(
        (r) => !r.closest("[hidden]"),
      );
      const regions = all.filter((r) => !all.some((o) => o !== r && o.contains(r)));
      if (regions.length === 0) return;
      e.preventDefault();
      const current = regions.findIndex((r) => r.contains(document.activeElement));
      const step = e.shiftKey ? -1 : 1;
      const next = regions[(current + step + regions.length) % regions.length];
      if (next) focusRegion(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root]);
}

export type EditorFrameSlots = {
  /** The host's chrome: a site menu, a title, a way out. */
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /**
   * Where the editor is (the prefab breadcrumb): beside the host's top-left
   * chrome, or below it when the top row has no room.
   */
  context?: ReactNode;
  /** A notice about the whole editor (read only), centred at the top of the canvas area. */
  banner?: ReactNode;
  /**
   * The panels, drawn in the viewer's tab groups. Without them the columns
   * hold `left` and `right` as they are.
   */
  panels?: FramePanels;
  /** The left column's content when there are no `panels`. */
  left?: ReactNode;
  /** The right column's content when there are no `panels`. */
  right?: ReactNode;
  /** The toolbar, or the play controls while playing. */
  dock?: ReactNode;
  /** The scene, its connection and who is here, bottom left. */
  status?: ReactNode;
  /** Chrome placed over the canvas by the scene itself: cursors, the tools' overlay. */
  overlay?: ReactNode;
  /** The editor's mode; while it is `play`, only the dock and the host's chrome are drawn. */
  mode?: ReadableStore<{ readonly mode: string }>;
};

/** What the frame draws its tab groups from. */
export type FramePanels = {
  /** The panels' shared state; the frame adds `openPanel` and the badges' subscription. */
  context: Omit<PanelContext, "openPanel" | "subscribe">;
  /** Default `PANELS`. */
  defs?: readonly PanelDef[];
  /** Each panel shows its skeleton. */
  booting?: boolean;
  /** Brings refs selected in a panel into the canvas's view; without it they stay where they are. */
  reveal?: (refs: readonly SceneRef[]) => boolean;
};

/** The frame's layout, for a host's "show this panel" and "reset layout". */
export type EditorFrameHandle = {
  /** Opens the panel's column and group, selects its tab and focuses its group. */
  openPanel(id: PanelId): void;
  resetLayout(): void;
};

export type EditorFrameProps = EditorFrameSlots & {
  /** The host's cues, storage and peer colours, for the kit and every face below. */
  host?: Pick<EditorHost, "cue" | "storage" | "peerColor">;
  /** Pins the theme; by default it follows the system's. */
  theme?: "light" | "dark";
  className?: string;
  frameRef?: Ref<EditorFrameHandle>;
  /** The game's canvas. */
  children: ReactNode;
};

const NO_PANELS: readonly PanelDef[] = Object.freeze([]);

const NO_HOST: Pick<EditorHost, "cue" | "storage" | "peerColor"> = {};

const EDITING: ReadableStore<{ readonly mode: string }> = {
  state: { mode: "edit" },
  subscribe: () => () => {},
};

const isPlaying = (s: { readonly mode: string }) => s.mode === "play";

/**
 * The editor's shell: the canvas fills the frame and the chrome floats over
 * it in islands. The columns, their tab groups, the context and the bottom
 * row are placed in px from `fitLayout`, so the viewer's sizes hold across
 * window sizes. Islands come first in the DOM, so Tab reaches the host's
 * chrome, the columns and the dock before the canvas. Kit portals render
 * into a `.je-root` container beside it.
 */
export function EditorFrame({ host = NO_HOST, theme, ...props }: EditorFrameProps) {
  return (
    <KitProvider host={host} theme={theme}>
      <PeerColorProvider value={hostPeerColor(host)}>
        <FrameBody theme={theme} {...props} />
      </PeerColorProvider>
    </KitProvider>
  );
}

type Size = { width: number; height: number };

/** The sizes of what the frame places around the columns. */
type Measured = {
  width: number;
  height: number;
  hostTopLeft: Size;
  topRight: Size;
  context: number;
  bottom: number;
  /** The phone layout's panel bar and sheet, over the bottom row. */
  phone: number;
};

const { inset: INSET, gap: GAP } = FRAME;

/** The least width the context takes beside the host's chrome before it moves below it. */
const CONTEXT_MIN = 240;

const box = (el: HTMLElement | null | undefined) => el?.getBoundingClientRect();

/**
 * The frame's size and what its host chrome, context and bottom row take,
 * kept current as any of them resizes. An element the browser hasn't laid
 * out (or jsdom) measures as the window.
 */
function measure(
  root: HTMLElement | null,
  [topLeft, topRight, context, bottom, phone]: readonly (HTMLElement | null)[],
): Measured {
  const frame = box(root);
  const size = (el: HTMLElement | null | undefined): Size => {
    const r = box(el);
    return { width: r?.width ?? 0, height: r?.height ?? 0 };
  };
  return {
    width: frame?.width || window.innerWidth,
    height: frame?.height || window.innerHeight,
    hostTopLeft: size(topLeft),
    topRight: size(topRight),
    context: box(context)?.height ?? 0,
    bottom: box(bottom)?.height ?? 0,
    phone: box(phone)?.height ?? 0,
  };
}

const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;

const sameMeasure = (a: Measured, b: Measured) =>
  a.width === b.width &&
  a.height === b.height &&
  sameSize(a.hostTopLeft, b.hostTopLeft) &&
  sameSize(a.topRight, b.topRight) &&
  a.context === b.context &&
  a.bottom === b.bottom &&
  a.phone === b.phone;

type ContextPlace = { left: number; top: number; maxWidth: number };

/**
 * The viewport the columns fit into, and where the context goes: beside the
 * host's top-left chrome while the top row leaves it `CONTEXT_MIN` before the
 * right column, so it takes no column space; else below the chrome, as wide
 * as the left column.
 */
function placeTop(
  layout: EditorLayout,
  m: Measured,
  hasContext: boolean,
): { viewport: Viewport; context: ContextPlace | null } {
  const host = m.hostTopLeft;
  const base: Viewport = {
    width: m.width,
    height: m.height,
    topLeft: host.height,
    topRight: m.topRight.height,
    bottom: m.bottom,
  };
  if (!hasContext) return { viewport: base, context: null };
  const right = fitLayout(layout, base).right;
  const edge = (right ? right.x : m.width) - GAP;
  const besideLeft = INSET + (host.width > 0 ? host.width + GAP : 0);
  if (edge - besideLeft >= CONTEXT_MIN || host.height === 0) {
    return {
      viewport: { ...base, topLeft: Math.max(host.height, m.context) },
      context: { left: besideLeft, top: INSET, maxWidth: Math.max(0, edge - besideLeft) },
    };
  }
  const viewport = {
    ...base,
    topLeft: host.height + (m.context > 0 ? GAP + m.context : 0),
  };
  const left = fitLayout(layout, viewport).left;
  return {
    viewport,
    context: {
      left: INSET,
      top: INSET + host.height + GAP,
      maxWidth: left && !left.rail ? left.width : Math.max(0, edge - INSET),
    },
  };
}

/** What a server render lays the frame out for: a desktop window, until the browser measures. */
const SERVER_WINDOW = { width: 1280, height: 800 };

const UNMEASURED: Measured = {
  ...SERVER_WINDOW,
  hostTopLeft: { width: 0, height: 0 },
  topRight: { width: 0, height: 0 },
  context: 0,
  bottom: 0,
  phone: 0,
};

function useMeasured(
  root: RefObject<HTMLDivElement | null>,
  parts: readonly RefObject<HTMLElement | null>[],
): Measured {
  const [measured, setMeasured] = useState<Measured | null>(null);
  const win = useWindowSize(SERVER_WINDOW);
  const unmeasured = useMemo(
    () => ({ ...UNMEASURED, width: win.width, height: win.height }),
    [win.width, win.height],
  );

  useIsomorphicLayoutEffect(() => {
    const elements = parts.map((p) => p.current);
    const update = () =>
      setMeasured((last) => {
        const next = measure(root.current, elements);
        return last && sameMeasure(last, next) ? last : next;
      });
    update();
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    for (const el of [root.current, ...elements]) {
      if (el) observer?.observe(el);
    }
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  });
  return measured ?? unmeasured;
}

type GroupAt = { side: Side; group: 0 | 1 };

/** `openPanel` for the panels and the handle: stable, and carried out by whoever listens now. */
function createOpener() {
  let listener: ((id: PanelId) => void) | null = null;
  return {
    open: (id: PanelId) => listener?.(id),
    listen(next: (id: PanelId) => void) {
      listener = next;
      return () => {
        if (listener === next) listener = null;
      };
    },
  };
}

const VisibleAreaContext = createContext<() => VisibleArea | null>(() => null);

const RevealContext = createContext<((refs: readonly SceneRef[]) => boolean) | null>(null);

/**
 * Brings refs a panel selects into the canvas's view, panning only when they
 * lie outside the part the chrome leaves visible; null outside an editor.
 */
export function useCanvasReveal(): ((refs: readonly SceneRef[]) => boolean) | null {
  return useContext(RevealContext);
}

/** The frame's `openPanel` for chrome outside the panels (the dock), with the panels it can open. */
const PanelOpenerContext = createContext<{
  open: (id: PanelId) => void;
  known: readonly PanelId[];
} | null>(null);

/** Opens `id` in the frame around this part, or null when the frame has no such panel. */
export function usePanelOpener(id: PanelId): (() => void) | null {
  const opener = useContext(PanelOpenerContext);
  return useMemo(() => (opener?.known.includes(id) ? () => opener.open(id) : null), [opener, id]);
}

type Widths = { full: number; least: number };

/** What the dock and the status each take of the bottom row: drawn in full, and at their least. */
export type BottomPartWidths = Widths & {
  /** The status's running activity, beside its own words: in full, and with its label cut short. */
  activity?: Widths;
};

/** The bottom row's room, as the frame shares it with the dock and the status. */
export type BottomRow = {
  /** px the dock may take; `Infinity` outside a frame. */
  dock: number;
  /** The status draws its dot and counts in place of its words. */
  compactStatus: boolean;
  /** px the status may take, its activity included; `Infinity` while nothing runs or outside a frame. */
  status: number;
};

const WIDE_ROW: BottomRow = { dock: Infinity, compactStatus: false, status: Infinity };

const BottomRowContext = createContext<{
  row: BottomRow;
  report: (part: "dock" | "status", widths: BottomPartWidths | null) => void;
}>({ row: WIDE_ROW, report: () => {} });

/**
 * The bottom row's room for this part, after telling the frame what the part
 * takes. The status gives way first: it shrinks to its dot and counts when it
 * and the whole dock don't fit side by side; the dock then fits in what is left.
 */
export function useBottomRow(part: "dock" | "status", widths: BottomPartWidths): BottomRow {
  const { row, report } = useContext(BottomRowContext);
  const { full, least } = widths;
  const activityFull = widths.activity?.full ?? 0;
  const activityLeast = widths.activity?.least ?? 0;
  useIsomorphicLayoutEffect(
    () =>
      report(part, {
        full,
        least,
        ...(activityFull > 0 ? { activity: { full: activityFull, least: activityLeast } } : {}),
      }),
    [report, part, full, least, activityFull, activityLeast],
  );
  useIsomorphicLayoutEffect(() => () => report(part, null), [report, part]);
  return row;
}

export type PartWidths = Record<"dock" | "status", BottomPartWidths | null>;

const sameWidths = (a: Widths | undefined, b: Widths | undefined) =>
  a === b || (!!a && !!b && a.full === b.full && a.least === b.least);

/**
 * How the bottom row's `room` is shared. The status's words give way first,
 * to their dot and counts, when they and the whole dock don't fit side by
 * side. A running activity then takes its room from the dock's tools, which
 * move into the overflow menu, and is cut short only once the dock is at its
 * least; the words give way for it only when even that isn't enough.
 */
export function bottomRow(room: number, parts: PartWidths, statusShown: boolean): BottomRow {
  const status = statusShown ? parts.status : null;
  if (!status) return { dock: Math.max(0, room), compactStatus: false, status: Infinity };
  const dock = parts.dock ?? { full: 0, least: 0 };
  const activity = status.activity;
  const besideDock = (own: number) => room - own - GAP - dock.least;
  let compactStatus = status.full + GAP + dock.full > room;
  if (!compactStatus && activity && besideDock(status.full) < activity.least) compactStatus = true;
  const own = compactStatus ? status.least : status.full;
  const running = activity ? Math.min(activity.full, Math.max(activity.least, besideDock(own))) : 0;
  const taken = own + running;
  return {
    dock: Math.max(0, room - taken - GAP),
    compactStatus,
    status: activity ? Math.max(0, Math.min(taken, room)) : Infinity,
  };
}

/** Keeps `frameInView` for `game` fitting into what the frame around it leaves visible. */
export function useVisibleArea(game: object): void {
  const read = useContext(VisibleAreaContext);
  useEffect(() => setVisibleArea(game, read), [game, read]);
}

function FrameBody({
  topLeft,
  topRight,
  context,
  banner,
  panels,
  left,
  right,
  dock,
  status,
  overlay,
  mode = EDITING,
  theme,
  className,
  frameRef,
  children,
}: Omit<EditorFrameProps, "host">) {
  const root = useRef<HTMLDivElement>(null);
  const topLeftRef = useRef<HTMLDivElement>(null);
  const topRightRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const parts = useMemo(() => [topLeftRef, topRightRef, contextRef, bottomRef, phoneRef], []);
  useRegionCycling(root);

  const { storage } = useKit();
  const defs = panels ? (panels.defs ?? PANELS) : null;
  const known = useMemo(() => defs?.map((d) => d.id), [defs]);
  const layoutState = useLayout(storage, known);
  const { layout, update } = layoutState;
  const measured = useMeasured(root, parts);
  const playing = useStoreValue(mode, isPlaying, Object.is);
  const showContext = Boolean(context) && !playing;
  const top = useMemo(
    () => placeTop(layout, measured, showContext),
    [layout, measured, showContext],
  );
  const { viewport } = top;
  const fitted = useMemo(() => fitLayout(layout, viewport), [layout, viewport]);
  const [sheet, setSheet] = useState<GroupAt | "left" | "right" | null>(null);
  const phone = fitted.mode === "phone";

  const live = useRef({ viewport, fitted, playing });
  useIsomorphicLayoutEffect(() => {
    live.current = { viewport, fitted, playing };
  });

  const [opener] = useState(createOpener);
  const focusAfter = useRef<PanelId | null>(null);
  const [, refocus] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () =>
      opener.listen((id) => {
        const at = panelGroup(layout, id);
        if (!at) return;
        if (phone) {
          update((l) => selectTab(l, id));
          setSheet(at);
        } else {
          update((l) => revealPanel(l, id, viewport));
        }
        focusAfter.current = id;
        refocus();
      }),
    [opener, layout, phone, viewport, update],
  );
  useImperativeHandle(
    frameRef,
    () => ({ openPanel: opener.open, resetLayout: layoutState.reset }),
    [opener, layoutState.reset],
  );

  useEffect(() => {
    const id = focusAfter.current;
    if (id === null) return;
    focusAfter.current = null;
    const at = panelGroup(layout, id);
    const group = at
      ? root.current?.querySelector<HTMLElement>(`.${groupClass(at.side, at.group)}`)
      : null;
    // The opened panel's own tab: the strip's roving tabindex can still point
    // at the tab it showed before, and focusing that one would select it back.
    const tab = group?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (tab) tab.focus({ preventScroll: true });
    else if (group) focusRegion(group);
  });

  const panelOpener = useMemo(() => (known ? { open: opener.open, known } : null), [opener, known]);

  const base = panels?.context;
  const ctx = useMemo(
    () => (base ? createPanelContext({ ...base, openPanel: opener.open }) : null),
    [base, opener],
  );

  const [partWidths, setPartWidths] = useState<PartWidths>({ dock: null, status: null });
  const reportPart = useCallback((part: "dock" | "status", widths: BottomPartWidths | null) => {
    setPartWidths((last) => {
      const was = last[part];
      if (
        was === widths ||
        (was && widths && sameWidths(was, widths) && sameWidths(was.activity, widths.activity))
      )
        return last;
      return { ...last, [part]: widths };
    });
  }, []);
  const rowWidth =
    (playing ? viewport.width : viewport.width - fitted.canvas.left - fitted.canvas.right) -
    2 * GAP;
  const statusShown = Boolean(status) && !playing;
  const row = useMemo(
    () => bottomRow(rowWidth, partWidths, statusShown),
    [rowWidth, partWidths, statusShown],
  );
  const bottom = useMemo(() => ({ row, report: reportPart }), [row, reportPart]);

  const readArea = useCallback((): VisibleArea | null => {
    const now = live.current;
    const insets = now.playing ? { left: 0, right: 0, top: 0, bottom: 0 } : now.fitted.canvas;
    return { width: now.viewport.width, height: now.viewport.height, insets };
  }, []);

  const badges = usePanelBadges(defs ?? NO_PANELS, ctx);
  const railPanels = (side: Side): RailPanel[] =>
    defs
      ? layout[side].groups.flatMap((g) =>
          g.panels.flatMap((id) => {
            const at = defs.findIndex((d) => d.id === id);
            const def = defs[at];
            return def ? [{ ...def, badge: badges[at] ?? null }] : [];
          }),
        )
      : [];

  const columnPanels: ColumnPanels | undefined =
    defs && ctx ? { defs, ctx, booting: panels?.booting } : undefined;

  const column = (side: Side) => {
    const at = fitted[side];
    const content = side === "left" ? left : right;
    if (!at || (!columnPanels && !content)) return null;
    if (at.rail) {
      return (
        <Rail
          side={side}
          panels={railPanels(side)}
          className={`je-frame-${side}`}
          style={{ left: at.x, top: at.y, width: at.width, height: at.height }}
          onOpen={(id) =>
            update((l) =>
              id === null ? toggleColumn(l, side, viewport) : revealPanel(l, id, viewport),
            )
          }
        />
      );
    }
    return (
      <Column
        side={side}
        fitted={at}
        layout={layoutState}
        viewport={viewport}
        panels={columnPanels}
      >
        {content}
      </Column>
    );
  };

  const phoneSheet = () => {
    if (!sheet) return null;
    if (typeof sheet === "string") {
      const content = sheet === "left" ? left : right;
      return content ? <div className="je-frame-sheet">{content}</div> : null;
    }
    if (!columnPanels) return null;
    // As tall as the open panel's content, up to half the window: a short run or list leaves the canvas free.
    return (
      <PanelGroup
        side={sheet.side}
        index={sheet.group}
        layout={layoutState}
        viewport={viewport}
        ctx={columnPanels.ctx}
        panels={columnPanels.defs}
        booting={columnPanels.booting}
        className={cx("je-frame-sheet", groupClass(sheet.side, sheet.group))}
        style={{ maxHeight: Math.round(viewport.height / 2) }}
      />
    );
  };

  const phoneRail = (side: Side) => {
    if (!columnPanels && !(side === "left" ? left : right)) return null;
    const open = sheet && typeof sheet !== "string" ? sheet : null;
    const active = open?.side === side ? layout[side].groups[open.group]?.active : null;
    return (
      <Rail
        side={side}
        orientation="horizontal"
        panels={railPanels(side)}
        active={active}
        onOpen={(id) => {
          if (id === null) {
            setSheet((s) => (s === side ? null : side));
            return;
          }
          const at = panelGroup(layout, id);
          if (!at) return;
          if (active === id) {
            setSheet(null);
            return;
          }
          update((l) => selectTab(l, id));
          setSheet(at);
        }}
      />
    );
  };

  const bottomInset = viewport.bottom > 0 ? INSET + viewport.bottom + GAP : INSET;
  // The host's two corners share the top row: the left one stops short of the right one.
  const topLeftMax =
    measured.topRight.width > 0
      ? Math.max(0, measured.width - 2 * INSET - GAP - measured.topRight.width)
      : undefined;
  // The default toasts sit in the canvas area, over the bottom row and the phone's panel bar.
  const toasts = {
    "--je-toasts-right": `${(playing ? 0 : fitted.canvas.right) + INSET}px`,
    "--je-toasts-bottom": `${bottomInset + (phone && !playing && measured.phone > 0 ? measured.phone + GAP : 0)}px`,
  } as CSSProperties;
  // What the chrome covers of the canvas, as the safe area a game's HUD reads
  // (UiContext.root); in Play only the host's corners and the dock stay.
  const covered = playing ? { ...fitted.canvas, left: 0, right: 0 } : fitted.canvas;
  const safeArea = {
    "--jams-ui-safe-top": `${covered.top}px`,
    "--jams-ui-safe-right": `${covered.right}px`,
    "--jams-ui-safe-bottom": `${covered.bottom}px`,
    "--jams-ui-safe-left": `${covered.left}px`,
  } as CSSProperties;

  return (
    <VisibleAreaContext.Provider value={readArea}>
      <div
        ref={root}
        className={cx("je-root je-frame", className)}
        data-je-theme={theme}
        style={toasts}
      >
        <div className="je-frame-chrome" data-je-mode={fitted.mode}>
          {topLeft ? (
            <div
              ref={topLeftRef}
              className="je-frame-top-left je-host"
              data-je-region=""
              style={topLeftMax === undefined ? undefined : { maxWidth: topLeftMax }}
            >
              {topLeft}
            </div>
          ) : null}
          {topRight ? (
            <div ref={topRightRef} className="je-frame-top-right je-host" data-je-region="">
              {topRight}
            </div>
          ) : null}
          {showContext && top.context ? (
            <div
              ref={contextRef}
              className="je-frame-context"
              style={{
                left: top.context.left,
                top: top.context.top,
                maxWidth: top.context.maxWidth,
              }}
            >
              {context}
            </div>
          ) : null}
          {banner && !playing ? (
            <div
              className="je-frame-banner"
              style={{
                left: fitted.canvas.left,
                right: fitted.canvas.right,
                top: fitted.canvas.top > 0 ? fitted.canvas.top + GAP : INSET,
              }}
            >
              {banner}
            </div>
          ) : null}
          {/* Kept mounted in play mode, so the panels' scroll, filters and drafts survive a playtest. */}
          <div className="je-frame-columns" hidden={playing} inert={playing}>
            <RevealContext.Provider value={panels?.reveal ?? null}>
              {phone ? (
                <div ref={phoneRef} className="je-frame-phone" style={{ bottom: bottomInset }}>
                  {phoneSheet()}
                  <div className="je-frame-phone-bar">
                    {phoneRail("left")}
                    {phoneRail("right")}
                  </div>
                </div>
              ) : (
                <>
                  {column("left")}
                  {column("right")}
                </>
              )}
            </RevealContext.Provider>
          </div>
          {dock || (status && !playing) ? (
            <div
              ref={bottomRef}
              className="je-frame-bottom"
              style={
                playing
                  ? { left: 0, right: 0 }
                  : { left: fitted.canvas.left, right: fitted.canvas.right }
              }
            >
              <BottomRowContext.Provider value={bottom}>
                {dock ? (
                  <PanelOpenerContext.Provider value={panelOpener}>
                    <div className="je-frame-dock">{dock}</div>
                  </PanelOpenerContext.Provider>
                ) : null}
                {statusShown ? (
                  <div
                    className="je-frame-status"
                    style={Number.isFinite(row.status) ? { maxWidth: row.status } : undefined}
                  >
                    {status}
                  </div>
                ) : null}
              </BottomRowContext.Provider>
            </div>
          ) : null}
        </div>
        <div
          data-je-region=""
          data-je-document=""
          tabIndex={-1}
          className="je-frame-document"
          style={safeArea}
        >
          {children}
        </div>
        {overlay}
      </div>
    </VisibleAreaContext.Provider>
  );
}

// ─── The editor's chrome ─────────────────────────────────

export type EditorChrome = Pick<
  EditorFrameSlots,
  "context" | "banner" | "panels" | "mode" | "dock" | "status" | "overlay"
>;

/**
 * The editor's islands and panels for `EditorFrame`'s slots. In play mode
 * only the dock stays, as the play controls and the "scene changed" chip.
 */
export function editorChrome(
  props: EditorChromeProps,
  {
    dev = false,
    publish,
  }: {
    dev?: boolean;
    /** The host's publishing: the Publish panel and the project settings' Usage section. */
    publish?: EditorPublishHost;
  } = {},
): EditorChrome {
  const { session, host, game, notify } = props;
  const editorKeys = game.registry.game?.editorKeys;
  const keymap = createKeymap(editorKeys);
  if (dev && editorKeys) warnShadowedKeys(editorKeys, keymap);
  const physical = new Store<readonly SceneIssue[]>([]);
  const pickedAsset = new Store<AssetKey | null>(null);
  const tools = createToolHostCell();
  const look = () =>
    outlineLook(session.registry, tools.state ? hostAsset(tools.state) : undefined);
  const controls: EditorControls = {
    ...props,
    rapier: props.rapier ?? null,
    runStore: props.runStore ?? createLoadedRunStore(),
    keymap,
    tools,
    playHere() {
      const at = game.pointerWorld();
      if (!at) {
        notify("Point at the scene first", {
          description: "Play from here starts where the pointer last was over the scene.",
        });
        return;
      }
      props.onPlay({ at });
    },
    playFrom: (opts) => props.onPlay(opts),
    frame(refs) {
      const box = frameBounds(session.getResolved(), refs, look());
      if (!box) return false;
      frameInView(game, box);
      return true;
    },
    reveal(refs) {
      const box = outlineBounds(session.getResolved(), refs, look());
      return box !== null && revealInView(game, box);
    },
  };
  return {
    context: props.prefab ? (
      <EditMode session={session}>
        <PrefabHeader session={session} {...props.prefab} />
      </EditMode>
    ) : undefined,
    banner: (
      <EditMode session={session}>
        <CodeSkewNotice host={host} />
      </EditMode>
    ),
    panels: {
      defs: editorPanels(publish ? { publish } : {}),
      context: { controls: publish ? { ...controls, publish } : controls, physical, pickedAsset },
      reveal: controls.reveal,
    },
    mode: session.store,
    dock: <EditorDock {...controls} />,
    status: (
      <EditMode session={session}>
        <Island>
          <EditorStatusBar
            session={session}
            host={host}
            {...(props.project?.notice ? { notice: props.project.notice } : {})}
          />
        </Island>
      </EditMode>
    ),
    overlay: (
      <EditMode session={session}>
        <PhysicalWatch session={session} rapier={controls.rapier} host={host} store={physical} />
        <VisibleAreaOf game={game} />
        <EditorCanvasOverlay session={session} store={game.getStore()} />
        <EditorCanvasLayer {...controls} />
      </EditMode>
    ),
  };
}

/** Keeps framing and revealing on `game` inside the canvas the columns leave visible. */
function VisibleAreaOf({ game }: { game: object }) {
  useVisibleArea(game);
  return null;
}

const warnedKeys = new WeakSet<object>();

/** Once per game's key list: the bindings the engine's own keys hide. */
function warnShadowedKeys(editorKeys: object, keymap: Keymap): void {
  if (warnedKeys.has(editorKeys)) return;
  warnedKeys.add(editorKeys);
  for (const b of keymap.shadowed) {
    console.warn(`[editor] the game's ${b.scope} key "${b.key}" (${b.command}) is the engine's`);
  }
}

/** Physical validation, run once for the panels that show it, with the last Live in Play run's checks after it. */
function PhysicalWatch({
  session,
  rapier,
  host,
  store,
}: {
  session: EditorSession;
  rapier: RapierModule | null;
  host: Store<EditorHostState>;
  store: Store<readonly SceneIssue[]>;
}) {
  const issues = usePhysicalIssues(session, rapier);
  const checks = useStoreValue(host, (s) => s.livePlay?.checks ?? null);
  useEffect(
    () =>
      store.setState(() =>
        checks && checks.length > 0 ? [...issues, ...checks.map(fromLivePlay)] : issues,
      ),
    [issues, checks, store],
  );
  return null;
}

/** How the problems panel opens a problem the last Live in Play run found, so it does not read as one in the doc. */
export const LIVE_PLAY_PROBLEM = "Last Live in Play run";

const fromLivePlay = (issue: SceneIssue): SceneIssue => ({
  ...issue,
  message: `${LIVE_PLAY_PROBLEM}: ${issue.message}`,
});

function EditMode({ session, children }: { session: EditorSession; children: ReactNode }) {
  const mode = useEditorStore(session, (s) => s.mode);
  return mode === "play" ? null : children;
}

function EditorCanvasLayer({ session, tools, game, runStore, canvas, notify }: EditorControls) {
  const host = useToolHost(tools);
  return (
    <CanvasLayer
      session={session}
      host={host}
      store={game.getStore()}
      runStore={runStore}
      canvas={canvas}
      notify={notify}
    />
  );
}

/** The toolbar, or the play controls while playing; owns the tool host and the editor keyboard. */
function EditorDock(controls: EditorControls) {
  const { session, game, tools, notify } = controls;
  const mode = useEditorStore(session, (s) => s.mode);
  useToolHostLifecycle(tools, session, game, notify, controls.project?.session);
  const host = useToolHost(tools);
  useEditorKeys(controls, host);
  useEditorClipboard(session, host);

  if (mode === "play") return <EditorPlayBar {...controls} />;
  return (
    <Island>
      <EditorToolbar
        session={session}
        keymap={controls.keymap}
        host={host}
        onPlay={() => controls.onPlay()}
        onPlayHere={controls.playHere}
        {...(controls.project ? { project: controls.project } : {})}
        notify={controls.notify}
      />
    </Island>
  );
}
