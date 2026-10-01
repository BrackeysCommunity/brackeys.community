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
}: {
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
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useRegionCycling(root);

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
      <div className="pointer-events-none absolute inset-3 z-20">
        <div className="absolute top-0 left-0 flex max-w-[calc(100%-22rem)] min-w-0">{topLeft}</div>
        {topRight ? <div className="absolute top-0 right-0 flex">{topRight}</div> : null}
        {left ? (
          <div className="absolute top-14 bottom-14 left-0 flex w-80 max-w-[calc(100%-1.5rem)]">
            {left}
          </div>
        ) : null}
        {right ? (
          <div className="absolute top-14 right-0 bottom-0 flex w-80 flex-col items-stretch">
            {right}
          </div>
        ) : null}
        {dock ? (
          <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2">{dock}</div>
        ) : null}
        {status ? <div className="absolute bottom-0 left-0 flex">{status}</div> : null}
      </div>
      <div
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
