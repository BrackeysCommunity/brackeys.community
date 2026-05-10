import { motion } from "framer-motion";

import { useAnimatedUnderline } from "@/components/profile/ProfilePage/useAnimatedUnderline";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import type { WizardTabDef } from "./shared";

interface CollabCreateStepperProps {
  /** All visible tabs (3 or 4 depending on post type). */
  tabs: WizardTabDef[];
  /** Index of the active tab within `tabs`. */
  activeIndex: number;
  /** Click handler for tab buttons — index argument matches `tabs`. */
  onSelect: (index: number) => void;
}

/**
 * Animated-underline tab strip used by the create flyout. Reuses the
 * profile flyout's `useAnimatedUnderline` hook so the stretch +
 * contract motion is identical between flows.
 */
export function CollabCreateStepper({ tabs, activeIndex, onSelect }: CollabCreateStepperProps) {
  const tabIds = tabs.map((t) => t.id);
  const { containerRef, registerTab, motionStyle } = useAnimatedUnderline({
    active: tabs[activeIndex]?.id ?? tabs[0]!.id,
    tabIds,
  });

  return (
    <div
      ref={containerRef}
      className="relative grid border-b border-muted/30"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={tab.id}
            ref={registerTab(tab.id)}
            type="button"
            onClick={() => onSelect(i)}
            className={cn(
              "relative flex cursor-pointer flex-col items-center justify-center gap-1 px-2 py-3 transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Text
              as="span"
              monospace
              size="xs"
              variant="muted"
              className={cn(
                "rounded px-1.5 py-0.5 tracking-widest tabular-nums",
                isActive ? "bg-warning/20 text-warning" : "bg-muted/40",
              )}
            >
              {tab.num}
            </Text>
            <span className="font-mono text-[10px] tracking-widest">{tab.label}</span>
          </button>
        );
      })}
      <motion.span
        aria-hidden
        style={motionStyle}
        className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-warning"
      />
    </div>
  );
}
