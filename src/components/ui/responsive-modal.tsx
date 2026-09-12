"use client";

import type * as React from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * A dialog on desktop, a drawer on phones, with one body.
 *
 * Yasahiro, on staging: "collab wizard shows as modal, whereas team wizard
 * shows as pinned at the bottom. that really threw me when I clicked 'start
 * a team'." Drawers are right on a phone and wrong on an ultrawide, where an
 * edge-pinned sheet is a long way from where the click happened — so the
 * surface, not the component, decides. This is `ModerationShell`'s branch
 * lifted out of it, since that shell had already worked the problem.
 *
 * Deliberately not a scroll container: the moderation shell scrolls one tab
 * panel below a fixed strip, the team form scrolls the whole body above a
 * pinned footer, and a container here would fight both. Own the scrolling in
 * `children`; this owns the frame, the title wiring and the footer's place.
 *
 * Not for edge-anchored *filter* panels — a sheet that slides from the side
 * of a list is arguably its own pattern, and §3.3 does not settle it.
 */
export function ResponsiveModal({
  open,
  onClose,
  title,
  description,
  className,
  dividedHeader = false,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Screen-reader only. The visible explanation belongs in `children`. */
  description: string;
  /** Width and anchoring for the desktop panel. */
  className?: string;
  /** Rule under the title, for bodies that don't open with one of their own. */
  dividedHeader?: boolean;
  /** Pinned below the body on both shapes — actions, not content. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const headerClass = cn(
    "flex shrink-0 items-center justify-between gap-3",
    dividedHeader && "border-b border-muted/40",
  );
  const titleClass = "text-base tracking-widest text-foreground uppercase";

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
        <DrawerContent className="max-h-[88vh] p-0">
          <DrawerDescription className="sr-only">{description}</DrawerDescription>
          <div className="flex min-h-0 flex-1 flex-col pt-3 pb-[env(safe-area-inset-bottom)]">
            <div className={cn(headerClass, "py-3 pr-3 pl-5")}>
              <DrawerTitle className={titleClass}>{title}</DrawerTitle>
            </div>
            {children}
            {footer}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {/* Top-anchored: the body's height changes as tabs and steps swap, so
          the top edge stays put and only the bottom moves. */}
      <DialogContent
        className={cn(
          "top-24 flex max-h-[calc(100vh-8rem)] translate-y-0 flex-col gap-0 p-0 sm:max-w-lg",
          className,
        )}
      >
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {/* The close button is absolutely placed at the panel's top right;
            the padding keeps a long title from running under it. */}
        <div className={cn(headerClass, "py-4 pr-12 pl-5")}>
          <DialogTitle className={titleClass}>{title}</DialogTitle>
        </div>
        {children}
        {footer}
      </DialogContent>
    </Dialog>
  );
}
