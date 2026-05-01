import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  Settings01Icon,
  Shield01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import { cn } from "@/lib/utils";

interface NavTabBody {
  icon: IconSvgElement;
  label: string;
}

function TabBody({ icon, label }: NavTabBody) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      <HugeiconsIcon icon={icon} />
      <span className="font-mono text-[10px] font-bold tracking-widest">{label}</span>
    </span>
  );
}

export interface MobileBottomNavProps {
  pathnameOverride?: string;
  inline?: boolean;
}

type TabValue = "home" | "jams" | "collab" | "command" | "settings";

export function MobileBottomNav({ pathnameOverride, inline = false }: MobileBottomNavProps = {}) {
  const routerPathname = useRouterState({ select: (s) => s.location.pathname });
  const pathname = pathnameOverride ?? routerPathname;
  const navigate = useNavigate();
  const { setOpen: openPalette } = useCommandPalette();

  const active: TabValue = pathname.startsWith("/collab")
    ? "collab"
    : pathname.startsWith("/command-center")
      ? "command"
      : pathname.startsWith("/settings")
        ? "settings"
        : pathname.startsWith("/jams")
          ? "jams"
          : "home";

  const handleChange = (value: string) => {
    switch (value as TabValue) {
      case "home":
        navigate({ to: "/" });
        return;
      case "jams":
        // No dedicated /jams route yet — open the command palette as a stand-in.
        openPalette(true);
        return;
      case "collab":
        navigate({ to: "/collab" });
        return;
      case "command":
        navigate({ to: "/command-center" });
        return;
      case "settings":
        openPalette(true);
        return;
    }
  };

  return (
    <nav
      aria-label="Primary"
      data-testid="mobile-bottom-nav"
      className={cn(
        inline
          ? "pointer-events-auto"
          : "pointer-events-auto fixed inset-x-0 bottom-0 z-50 flex justify-center px-3",
      )}
      style={
        inline
          ? undefined
          : {
              paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)",
              paddingLeft: "calc(env(safe-area-inset-left) + 0.75rem)",
              paddingRight: "calc(env(safe-area-inset-right) + 0.75rem)",
            }
      }
    >
      <SegmentedControl
        size="lg"
        priority="default"
        value={active}
        onChange={handleChange}
        aria-label="Primary navigation"
      >
        <SegmentedControl.Item value="home" aria-label="Home" className="rounded-l-md">
          <TabBody icon={Shield01Icon} label="HOME" />
        </SegmentedControl.Item>
        <SegmentedControl.Item value="jams" aria-label="Jams">
          <TabBody icon={Calendar03Icon} label="JAMS" />
        </SegmentedControl.Item>
        <SegmentedControl.Item value="collab" priority="primary" aria-label="Collab">
          <TabBody icon={UserGroupIcon} label="COLLAB" />
        </SegmentedControl.Item>
        <SegmentedControl.Item value="command" aria-label="Command">
          <TabBody icon={ComputerTerminal01Icon} label="BOTS" />
        </SegmentedControl.Item>
        <SegmentedControl.Item value="settings" aria-label="Settings" className="rounded-r-md">
          <TabBody icon={Settings01Icon} label="OPTS" />
        </SegmentedControl.Item>
      </SegmentedControl>
    </nav>
  );
}
