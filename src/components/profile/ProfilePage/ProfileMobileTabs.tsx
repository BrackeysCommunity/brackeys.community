import {
  ChampionIcon,
  Comment01Icon,
  HashtagIcon,
  Note01Icon,
  Shield02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { motion } from "framer-motion";

import { useAnimatedUnderline } from "@/lib/hooks/use-animated-underline";
import { PAGE_CUES } from "@/lib/sound";
import { cn } from "@/lib/utils";

export type ProfileMobileTab = "overview" | "projects" | "jams" | "skills" | "posts";

interface ProfileMobileTabsProps {
  active: ProfileMobileTab;
  onChange: (tab: ProfileMobileTab) => void;
  /** Toggles the sticky-on-scroll positioning. The mobile layout uses
   * this to pin the tab bar below the app header; passing `false`
   * (e.g. for tests) renders it inline. */
  sticky?: boolean;
  /** The forum's POSTS tab, while the forum is on for the viewer. */
  showPosts?: boolean;
}

interface TabDef {
  id: ProfileMobileTab;
  icon: IconSvgElement;
  label: string;
}

const TABS: TabDef[] = [
  { id: "overview", icon: Shield02Icon as IconSvgElement, label: "OVERVIEW" },
  { id: "projects", icon: Note01Icon as IconSvgElement, label: "PROJECTS" },
  { id: "jams", icon: ChampionIcon as IconSvgElement, label: "JAMS" },
  { id: "skills", icon: HashtagIcon as IconSvgElement, label: "SKILLS" },
  { id: "posts", icon: Comment01Icon as IconSvgElement, label: "POSTS" },
];

/**
 * Mobile sub-navigation. Bleeds out of the page's content padding to
 * span the full viewport via negative insets — the bar reads as a
 * horizontal rail rather than a chip group constrained to the content
 * column. The active underline grows-and-shrinks via
 * `useAnimatedUnderline`.
 */
export function ProfileMobileTabs({
  active,
  onChange,
  sticky = true,
  showPosts = false,
}: ProfileMobileTabsProps) {
  const tabs = showPosts ? TABS : TABS.filter((t) => t.id !== "posts");
  const { containerRef, registerTab, motionStyle } = useAnimatedUnderline({
    active,
    tabIds: tabs.map((t) => t.id),
  });

  return (
    <div
      className={cn(
        "z-30 -mx-4 border-y border-muted/30 bg-background/95 backdrop-blur",
        // Rides up with the app bar when it auto-hides — see
        // `--app-header-shift`.
        sticky && "header-follow sticky top-0",
      )}
    >
      <div
        ref={containerRef}
        role="tablist"
        aria-label="Profile section"
        className={cn("relative grid", showPosts ? "grid-cols-5" : "grid-cols-4")}
      >
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            ref={registerTab(tab.id)}
            tab={tab}
            isActive={tab.id === active}
            onSelect={() => onChange(tab.id)}
          />
        ))}
        <motion.span
          aria-hidden
          style={motionStyle}
          className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-accent"
        />
      </div>
    </div>
  );
}

interface TabButtonProps {
  tab: TabDef;
  isActive: boolean;
  onSelect: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}

function TabButton({ tab, isActive, onSelect, ref }: TabButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onSelect}
      {...PAGE_CUES}
      className={cn(
        "relative flex w-full cursor-pointer flex-col items-center justify-center gap-1 px-2 py-3 transition-colors",
        isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={tab.icon} size={18} />
      <span className="text-[10px] tracking-widest">{tab.label}</span>
    </button>
  );
}
