import { Store } from "@tanstack/store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

import {
  createKeymap,
  selectionBounds,
  type EditorSession,
  type Keymap,
  type SceneIssue,
} from "../../editor/index";
import type { RapierModule } from "../../index";
import type { AssetKey } from "../../project/index";
import { hostPeerColor, type EditorHost } from "../host";
import { cx, KitProvider, useKit } from "../kit/index";
import {
  DEFAULT_LAYOUT,
  fitLayout,
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
import { createPanelContext, PANELS, type PanelContext, type PanelDef } from "../panels/registry";
import { createLoadedRunStore } from "../session/loaded-run";
import { useEditorStore } from "../session/use-editor-store";
import { usePhysicalIssues } from "../session/use-physical-issues";
import { useStoreValue, type ReadableStore } from "../session/use-store-value";
import { Column, groupClass, type ColumnPanels } from "./Column";
import {
  useEditorClipboard,
  useEditorKeys,
  type EditorChromeProps,
  type EditorControls,
} from "./keys";
import { PanelGroup } from "./PanelGroup";
import { Rail, type RailPanel } from "./Rail";
import { frameInView, setVisibleArea, type VisibleArea } from "./visible-rect";

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
      const all = [...frame.querySelectorAll<HTMLElement>(REGION)];
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

/** The heights (and the host's top-left width) of what the frame places around the columns. */
type Measured = {
  width: number;
  height: number;
  hostTopLeft: { width: number; height: number };
  topRight: number;
  context: number;
  bottom: number;
};

/** The model's own inset and gap, read off a fit so the frame never disagrees with it. */
const { INSET, GAP } = (() => {
  const probe = fitLayout(DEFAULT_LAYOUT, {
    width: 4096,
    height: 2048,
    topLeft: 1,
    topRight: 0,
    bottom: 0,
  });
  const inset = probe.right?.y ?? 0;
  return { INSET: inset, GAP: (probe.left?.y ?? 0) - inset - 1 };
})();

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
  [topLeft, topRight, context, bottom]: readonly (HTMLElement | null)[],
): Measured {
  const frame = box(root);
  const host = box(topLeft);
  return {
    width: frame?.width || window.innerWidth,
    height: frame?.height || window.innerHeight,
    hostTopLeft: { width: host?.width ?? 0, height: host?.height ?? 0 },
    topRight: box(topRight)?.height ?? 0,
    context: box(context)?.height ?? 0,
    bottom: box(bottom)?.height ?? 0,
  };
}

const sameMeasure = (a: Measured, b: Measured) =>
  a.width === b.width &&
  a.height === b.height &&
  a.hostTopLeft.width === b.hostTopLeft.width &&
  a.hostTopLeft.height === b.hostTopLeft.height &&
  a.topRight === b.topRight &&
  a.context === b.context &&
  a.bottom === b.bottom;

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
    topRight: m.topRight,
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

function useMeasured(
  root: RefObject<HTMLDivElement | null>,
  parts: readonly RefObject<HTMLElement | null>[],
): Measured {
  const [measured, setMeasured] = useState<Measured>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    hostTopLeft: { width: 0, height: 0 },
    topRight: 0,
    context: 0,
    bottom: 0,
  }));

  useLayoutEffect(() => {
    const elements = parts.map((p) => p.current);
    const update = () =>
      setMeasured((last) => {
        const next = measure(root.current, elements);
        return sameMeasure(last, next) ? last : next;
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
  return measured;
}

type GroupAt = { side: Side; index: 0 | 1 };

function groupOf(layout: EditorLayout, panel: PanelId): GroupAt | null {
  for (const side of ["left", "right"] as const) {
    const index = layout[side].groups.findIndex((g) => g.panels.includes(panel));
    if (index === 0 || index === 1) return { side, index };
  }
  return null;
}

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

/** What the dock and the status each take of the bottom row: drawn in full, and at their least. */
export type BottomPartWidths = { full: number; least: number };

/** The bottom row's room, as the frame shares it with the dock and the status. */
export type BottomRow = {
  /** px the dock may take; `Infinity` outside a frame. */
  dock: number;
  /** The status draws its dot and counts only. */
  compactStatus: boolean;
};

const WIDE_ROW: BottomRow = { dock: Infinity, compactStatus: false };

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
  useLayoutEffect(() => report(part, { full, least }), [report, part, full, least]);
  useLayoutEffect(() => () => report(part, null), [report, part]);
  return row;
}

type PartWidths = Record<"dock" | "status", BottomPartWidths | null>;

function bottomRow(room: number, parts: PartWidths, statusShown: boolean): BottomRow {
  const status = statusShown ? parts.status : null;
  const dock = parts.dock?.full ?? 0;
  const compactStatus = status !== null && status.full + GAP + dock > room;
  const taken = status ? (compactStatus ? status.least : status.full) + GAP : 0;
  return { dock: Math.max(0, room - taken), compactStatus };
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
  const parts = useMemo(() => [topLeftRef, topRightRef, contextRef, bottomRef], []);
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
  useLayoutEffect(() => {
    live.current = { viewport, fitted, playing };
  });

  const [opener] = useState(createOpener);
  const focusAfter = useRef<PanelId | null>(null);
  const [, refocus] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () =>
      opener.listen((id) => {
        const at = groupOf(layout, id);
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
    const at = groupOf(layout, id);
    const group = at
      ? root.current?.querySelector<HTMLElement>(`.${groupClass(at.side, at.index)}`)
      : null;
    // The opened panel's own tab: the strip's roving tabindex can still point
    // at the tab it showed before, and focusing that one would select it back.
    const tab = group?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (tab) tab.focus({ preventScroll: true });
    else if (group) focusRegion(group);
  });

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
        (was && widths && was.full === widths.full && was.least === widths.least)
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

  const railPanels = (side: Side): RailPanel[] =>
    defs
      ? layout[side].groups.flatMap((g) =>
          g.panels.flatMap((id) => {
            const def = defs.find((d) => d.id === id);
            return def ? [def] : [];
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
    return (
      <PanelGroup
        side={sheet.side}
        index={sheet.index}
        layout={layoutState}
        viewport={viewport}
        ctx={columnPanels.ctx}
        panels={columnPanels.defs}
        booting={columnPanels.booting}
        className={cx("je-frame-sheet", groupClass(sheet.side, sheet.index))}
        style={{ height: Math.round(viewport.height / 2) }}
      />
    );
  };

  const phoneRail = (side: Side) => {
    if (!columnPanels && !(side === "left" ? left : right)) return null;
    const open = sheet && typeof sheet !== "string" ? sheet : null;
    const active = open?.side === side ? layout[side].groups[open.index]?.active : null;
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
          const at = groupOf(layout, id);
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

  return (
    <VisibleAreaContext.Provider value={readArea}>
      <div ref={root} className={cx("je-root je-frame", className)} data-je-theme={theme}>
        <div className="je-frame-chrome" data-je-mode={fitted.mode}>
          {topLeft ? (
            <div ref={topLeftRef} className="je-frame-top-left je-host" data-je-region="">
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
          {playing ? null : phone ? (
            <div className="je-frame-phone" style={{ bottom: bottomInset }}>
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
                {dock ? <div className="je-frame-dock">{dock}</div> : null}
                {statusShown ? <div className="je-frame-status">{status}</div> : null}
              </BottomRowContext.Provider>
            </div>
          ) : null}
        </div>
        <div data-je-region="" data-je-document="" tabIndex={-1} className="je-frame-document">
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
  { dev = false }: { dev?: boolean } = {},
): EditorChrome {
  const { session, host, game, notify } = props;
  const editorKeys = game.registry.game?.editorKeys;
  const keymap = createKeymap(editorKeys);
  if (dev && editorKeys) warnShadowedKeys(editorKeys, keymap);
  const physical = new Store<readonly SceneIssue[]>([]);
  const pickedAsset = new Store<AssetKey | null>(null);
  const controls: EditorControls = {
    ...props,
    rapier: props.rapier ?? null,
    runStore: props.runStore ?? createLoadedRunStore(),
    keymap,
    tools: createToolHostCell(),
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
      const box = selectionBounds(session.getResolved(), session.registry, refs);
      if (!box) return false;
      frameInView(game, box);
      return true;
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
    panels: { context: { controls, physical, pickedAsset } },
    mode: session.store,
    dock: <EditorDock {...controls} />,
    status: (
      <EditMode session={session}>
        <Island>
          <EditorStatusBar session={session} host={host} />
        </Island>
      </EditMode>
    ),
    overlay: (
      <EditMode session={session}>
        <PhysicalWatch session={session} rapier={controls.rapier} store={physical} />
        <VisibleAreaOf game={game} />
        <EditorCanvasOverlay session={session} store={game.getStore()} />
        <EditorCanvasLayer {...controls} />
      </EditMode>
    ),
  };
}

/** Keeps framing on `game` inside the canvas the columns leave visible. */
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

/** Physical validation, run once for the panels that show it. */
function PhysicalWatch({
  session,
  rapier,
  store,
}: {
  session: EditorSession;
  rapier: RapierModule | null;
  store: Store<readonly SceneIssue[]>;
}) {
  const issues = usePhysicalIssues(session, rapier);
  useEffect(() => store.setState(() => issues), [issues, store]);
  return null;
}

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
      />
    </Island>
  );
}
