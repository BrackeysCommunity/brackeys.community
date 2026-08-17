import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { useAnimatedUnderline } from "@/hooks/use-animated-underline";
import { PAGE_CUES } from "@/lib/sound";
import { cn } from "@/lib/utils";

export interface UnderlineTab<Id extends string> {
  key: Id;
  label: string;
  /** Rendered as a badge beside the label; zero and undefined both hide it. */
  count?: number;
}

export interface UnderlineTabsProps<Id extends string> {
  tabs: readonly UnderlineTab<Id>[];
  active: Id;
  onSelect: (key: Id) => void;
  /** Names the strip for screen readers, e.g. "Admin section". */
  label: string;
  className?: string;
}

/**
 * The label-and-count tab strip used by the page-level surfaces (`/admin`,
 * `/notifications`). One element pinned to the strip's bottom carries the
 * active underline, so a tab wearing a count badge can't drag its own
 * underline out of line with the rest.
 *
 * The scroll box is the outer div: an absolutely-positioned child of a
 * scrolling container measures against a box that moves under it, which
 * desyncs the bar as soon as the tabs overflow.
 */
export function UnderlineTabs<Id extends string>({
  tabs,
  active,
  onSelect,
  label,
  className,
}: UnderlineTabsProps<Id>) {
  const { containerRef, registerTab, motionStyle } = useAnimatedUnderline({
    active,
    tabIds: tabs.map((t) => t.key),
  });

  return (
    <div className={cn("overflow-x-auto border-b border-muted/30", className)}>
      <div
        ref={containerRef}
        role="tablist"
        aria-label={label}
        className="relative flex w-max min-w-full items-stretch gap-1"
      >
        {tabs.map((tab) => {
          const isActive = active === tab.key;
          const count = tab.count ?? 0;
          return (
            <button
              key={tab.key}
              ref={registerTab(tab.key)}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(tab.key)}
              {...PAGE_CUES}
              className={cn(
                "relative flex cursor-pointer items-center gap-1.5 px-3 py-3 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {count > 0 && (
                <Badge size="label" variant={isActive ? "default" : "secondary"}>
                  {count}
                </Badge>
              )}
            </button>
          );
        })}
        <motion.span
          aria-hidden
          style={motionStyle}
          className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-primary"
        />
      </div>
    </div>
  );
}
