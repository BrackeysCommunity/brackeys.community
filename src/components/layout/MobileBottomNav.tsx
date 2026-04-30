import {
  Calendar03Icon,
  PaintBucketIcon,
  Shield01Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";

import { ButtonGroup } from "@/components/ui/button-group";
import { Chonk } from "@/components/ui/chonk";
import { activeUserStore } from "@/lib/active-user-store";
import { authClient } from "@/lib/auth-client";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import { cn } from "@/lib/utils";

const TAB_BASE =
  "flex h-14 w-16 flex-col items-center justify-center gap-0.5 font-mono text-[10px] font-bold tracking-widest";

interface TabBodyProps {
  icon: IconSvgElement;
  label: string;
  active: boolean;
  primary?: boolean;
}

function TabBody({ icon, label, active, primary }: TabBodyProps) {
  return (
    <span
      className={cn(
        "flex flex-col items-center gap-0.5 transition-colors",
        primary ? "text-primary-foreground" : active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={18} />
      <span>{label}</span>
    </span>
  );
}

export interface MobileBottomNavProps {
  /** Override active-route detection (useful in stories / demos). */
  pathnameOverride?: string;
  /** Render without fixed positioning so the nav sits inline (stories). */
  inline?: boolean;
  /** Override the Themes button action (defaults to opening command palette). */
  onOpenThemes?: () => void;
}

export function MobileBottomNav({
  pathnameOverride,
  inline = false,
  onOpenThemes,
}: MobileBottomNavProps = {}) {
  const routerPathname = useRouterState({ select: (s) => s.location.pathname });
  const pathname = pathnameOverride ?? routerPathname;
  const { data: session } = authClient.useSession();
  const activeProfile = useStore(activeUserStore, (s) => s.profile);
  const profileSlug = activeProfile?.urlStub ?? session?.user?.id;
  const { setOpen: openPalette } = useCommandPalette();

  const onHome = pathname === "/";
  const onCollab = pathname.startsWith("/collab");
  const onProfile = pathname.startsWith("/profile");

  const handleThemes = () => {
    if (onOpenThemes) onOpenThemes();
    else openPalette(true);
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
      <ButtonGroup>
        <Chonk
          variant="surface"
          size="sm"
          render={<Link to="/" aria-label="Home" />}
          className={TAB_BASE}
        >
          <TabBody icon={Shield01Icon} label="HOME" active={onHome} />
        </Chonk>

        {/* TODO: route to a dedicated /jams page when it exists */}
        <Chonk
          variant="surface"
          size="sm"
          render={<Link to="/" aria-label="Jams" />}
          className={TAB_BASE}
        >
          <TabBody icon={Calendar03Icon} label="JAMS" active={false} />
        </Chonk>

        <Chonk
          variant="primary"
          size="sm"
          render={<Link to="/collab" aria-label="Collab" />}
          className={TAB_BASE}
        >
          <TabBody icon={UserGroupIcon} label="COLLAB" active={onCollab} primary />
        </Chonk>

        {profileSlug ? (
          <Chonk
            variant="surface"
            size="sm"
            render={<Link to="/profile/$userId" params={{ userId: profileSlug }} aria-label="Me" />}
            className={TAB_BASE}
          >
            <TabBody icon={UserIcon} label="ME" active={onProfile} />
          </Chonk>
        ) : (
          <Chonk
            variant="surface"
            size="sm"
            render={<Link to="/profile" aria-label="Me" />}
            className={TAB_BASE}
          >
            <TabBody icon={UserIcon} label="ME" active={onProfile} />
          </Chonk>
        )}

        <Chonk
          variant="surface"
          size="sm"
          render={<button type="button" onClick={handleThemes} aria-label="Themes" />}
          className={TAB_BASE}
        >
          <TabBody icon={PaintBucketIcon} label="THEMES" active={false} />
        </Chonk>
      </ButtonGroup>
    </nav>
  );
}
