import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

import { NOTCH_SIZE, notchClip, notchClipInner } from "@/lib/notch";
import { cn } from "@/lib/utils";

interface NotchedCardProps {
  children: React.ReactNode;
  className?: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  scrollable?: boolean;
}

export function NotchedCard({
  children,
  className,
  header,
  footer,
  scrollable = true,
}: NotchedCardProps) {
  return (
    <div
      className={cn("pointer-events-auto bg-muted/60", className)}
      style={{ clipPath: notchClip, padding: "2px" }}
    >
      <div
        className="relative flex h-full flex-col bg-background/70"
        style={{ clipPath: notchClipInner }}
      >
        <NotchedCardDecorators />

        {header && (
          <div className="shrink-0 border-b border-muted/60 bg-card/40 px-4 py-2.5">{header}</div>
        )}

        {scrollable ? (
          <OverlayScrollbarsComponent
            element="div"
            className="min-h-0 flex-1"
            options={{
              scrollbars: {
                theme: "os-theme-dark",
                autoHide: "scroll",
                autoHideDelay: 800,
              },
            }}
          >
            {children}
          </OverlayScrollbarsComponent>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        )}

        {footer && <div className="shrink-0 border-t border-muted/60 bg-card/30">{footer}</div>}
      </div>
    </div>
  );
}

export function NotchedCardDecorators() {
  return (
    <>
      <span className="pointer-events-none absolute top-0 left-0 z-10 h-2 w-2 border-t border-l border-brackeys-yellow/50" />
      <span className="pointer-events-none absolute right-0 bottom-0 z-10 h-2 w-2 border-r border-b border-brackeys-yellow/50" />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 z-10 text-brackeys-yellow/40"
        width={NOTCH_SIZE + 2}
        height={NOTCH_SIZE + 2}
        viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
        fill="none"
      >
        <line
          x1="0"
          y1="1"
          x2={NOTCH_SIZE + 1}
          y2={NOTCH_SIZE + 2}
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 z-10 text-brackeys-yellow/40"
        width={NOTCH_SIZE + 2}
        height={NOTCH_SIZE + 2}
        viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
        fill="none"
      >
        <line
          x1={NOTCH_SIZE + 1}
          y1={NOTCH_SIZE + 1}
          x2="0"
          y2="0"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
    </>
  );
}
