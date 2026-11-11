import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** A floating panel of chrome over the document. */
export function Island({
  className,
  region = true,
  ...props
}: React.ComponentProps<"div"> & {
  /** A stop for F6; off when the island sits inside a bar that is one. */
  region?: boolean;
}) {
  return (
    <div
      data-shell-region={region ? "" : undefined}
      className={cn(
        "pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg",
        className,
      )}
      {...props}
    />
  );
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** F6 and Shift+F6 move focus between the islands and the document. */
function useRegionCycling(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F6" || e.metaKey || e.ctrlKey || e.altKey) return;
      const host = root.current;
      if (!host) return;
      const regions = [...host.querySelectorAll<HTMLElement>("[data-shell-region]")];
      if (regions.length === 0) return;
      e.preventDefault();
      const current = regions.findIndex((r) => r.contains(document.activeElement));
      const step = e.shiftKey ? -1 : 1;
      const next = regions[(current + step + regions.length) % regions.length]!;
      const target = next.hasAttribute("data-shell-document")
        ? next
        : (next.querySelector<HTMLElement>(TABBABLE) ?? next);
      target.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root]);
}

type Edge = "top" | "right" | "bottom" | "left";
const EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];
const SLOTS = ["topLeft", "topRight", "left", "right", "dock", "status"] as const;

/**
 * How far the islands reach in from each edge of the document, in px: a top
 * corner's bottom, the dock's or the status's top, a side panel's inner edge.
 */
export function islandInsets(
  doc: DOMRect,
  islands: Partial<Record<(typeof SLOTS)[number], DOMRect | undefined>>,
): Record<Edge, number> {
  const out: Record<Edge, number> = { top: 0, right: 0, bottom: 0, left: 0 };
  const shown = (r: DOMRect | undefined): r is DOMRect => !!r && r.width > 0 && r.height > 0;
  for (const r of [islands.topLeft, islands.topRight])
    if (shown(r)) out.top = Math.max(out.top, r.bottom - doc.top);
  for (const r of [islands.dock, islands.status])
    if (shown(r)) out.bottom = Math.max(out.bottom, doc.bottom - r.top);
  if (shown(islands.left)) out.left = Math.max(0, islands.left.right - doc.left);
  if (shown(islands.right)) out.right = Math.max(0, doc.right - islands.right.left);
  for (const edge of EDGES) out[edge] = Math.max(0, Math.ceil(out[edge]));
  return out;
}

/** The box around what a slot draws, or undefined while it draws nothing. */
function slotBox(slot: Element | null): DOMRect | undefined {
  let box: DOMRect | undefined;
  for (const child of slot?.children ?? []) {
    const r = child.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    box = box
      ? DOMRect.fromRect({
          x: Math.min(box.left, r.left),
          y: Math.min(box.top, r.top),
          width: Math.max(box.right, r.right) - Math.min(box.left, r.left),
          height: Math.max(box.bottom, r.bottom) - Math.min(box.top, r.top),
        })
      : r;
  }
  return box;
}

/**
 * Sets `--jams-ui-safe-*` on the document for a game's HUD (see the engine's
 * UiContext.root), so it keeps clear of the islands floating over it.
 */
function useSafeArea(
  doc: React.RefObject<HTMLDivElement | null>,
  slots: React.RefObject<HTMLDivElement | null>,
  shown: string,
) {
  useEffect(() => {
    const docEl = doc.current;
    const slotsEl = slots.current;
    if (!docEl || !slotsEl) return;
    const slotOf = (name: (typeof SLOTS)[number]) =>
      slotsEl.querySelector(`:scope > [data-shell-slot="${name}"]`);
    const update = () => {
      const islands = Object.fromEntries(SLOTS.map((name) => [name, slotBox(slotOf(name))]));
      const insets = islandInsets(docEl.getBoundingClientRect(), islands);
      for (const edge of EDGES)
        docEl.style.setProperty(`--jams-ui-safe-${edge}`, `${insets[edge]}px`);
    };
    update();
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (observer) {
      observer.observe(docEl);
      for (const slot of slotsEl.children) {
        observer.observe(slot);
        for (const child of slot.children) observer.observe(child);
      }
    }
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [doc, slots, shown]);
}

export type CanvasShellSlots = {
  topLeft: React.ReactNode;
  topRight?: React.ReactNode;
  /** The Outline panel. */
  left?: React.ReactNode;
  /** The inspector or History. */
  right?: React.ReactNode;
  /** The tool dock; on phones, the bottom bar. */
  dock?: React.ReactNode;
  /** Save and connection status, bottom left. */
  status?: React.ReactNode;
  /** Chrome placed by the document itself, such as the selection bar. */
  overlay?: React.ReactNode;
  phone?: boolean;
};

/**
 * The takeover layout for a document: the document fills the window and
 * the chrome floats over it in islands. Islands come first in the DOM, so
 * Tab reaches the site menu, the crumb, the top right and the dock before
 * the document. On phones the islands become a top bar and a bottom bar.
 */
export function CanvasShell({
  topLeft,
  topRight,
  left,
  right,
  dock,
  status,
  overlay,
  phone = false,
  children,
}: CanvasShellSlots & { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  useRegionCycling(root);
  const shownSlots = [topRight, left, right, dock, status].map((slot) => (slot ? 1 : 0)).join("");
  useSafeArea(docRef, slotsRef, `${phone}${shownSlots}`);

  if (phone) {
    return (
      <div ref={root} className="flex h-full w-full flex-col bg-background">
        <div
          data-shell-region=""
          className="flex shrink-0 items-center gap-1 border-b border-border bg-popover px-2 pt-[env(safe-area-inset-top)] text-popover-foreground"
          style={{ minHeight: "calc(3rem + env(safe-area-inset-top))" }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1">{topLeft}</div>
          {topRight}
        </div>
        <div
          data-shell-region=""
          data-shell-document=""
          tabIndex={-1}
          className="relative min-h-0 flex-1 outline-none"
        >
          {children}
          {left ? <div className="absolute inset-0 z-20 flex">{left}</div> : null}
        </div>
        {dock || status ? (
          <div
            data-shell-region=""
            className="flex shrink-0 items-center gap-2 border-t border-border bg-popover px-3 pb-[env(safe-area-inset-bottom)] text-popover-foreground"
            style={{ minHeight: "calc(3rem + env(safe-area-inset-bottom))" }}
          >
            <div className="min-w-0 flex-1">{status}</div>
            {dock}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={root} className="relative h-full w-full bg-background">
      <div ref={slotsRef} className="pointer-events-none absolute inset-3 z-20">
        <div
          data-shell-slot="topLeft"
          className="absolute top-0 left-0 flex max-w-[calc(100%-22rem)] min-w-0"
        >
          {topLeft}
        </div>
        {topRight ? (
          <div data-shell-slot="topRight" className="absolute top-0 right-0 flex">
            {topRight}
          </div>
        ) : null}
        {left ? (
          <div
            data-shell-slot="left"
            className="absolute top-14 bottom-14 left-0 flex w-80 max-w-[calc(100%-1.5rem)]"
          >
            {left}
          </div>
        ) : null}
        {right ? (
          <div
            data-shell-slot="right"
            className="absolute top-14 right-0 bottom-0 flex w-80 flex-col items-stretch"
          >
            {right}
          </div>
        ) : null}
        {dock ? (
          <div data-shell-slot="dock" className="absolute bottom-0 left-1/2 flex -translate-x-1/2">
            {dock}
          </div>
        ) : null}
        {status ? (
          <div data-shell-slot="status" className="absolute bottom-0 left-0 flex">
            {status}
          </div>
        ) : null}
      </div>
      <div
        ref={docRef}
        data-shell-region=""
        data-shell-document=""
        tabIndex={-1}
        className="absolute inset-0 z-0 outline-none"
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}
