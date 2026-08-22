import { Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import { AttentionMenu } from "@/components/attention/AttentionMenu";
import { SettingsMenu } from "@/components/layout/SettingsMenu";
import { UserMenu } from "@/components/layout/UserMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Button } from "@/components/ui/button";
import { authClient, signInWithDiscord } from "@/lib/auth-client";
import { HEADER_MAGNET_STRENGTH, useMagnetic } from "@/lib/hooks/use-cursor";
import { useHeaderShift } from "@/lib/hooks/use-header-shift";
import { useHeaderSlideTransition, useHideOnScrollDown } from "@/lib/hooks/use-hide-on-scroll-down";
import { useTopEdgePeek } from "@/lib/hooks/use-top-edge-peek";
import { HOVER_CUE, NAV_LINK_CUES } from "@/lib/sound";
import { cn } from "@/lib/utils";

const HEADER_SHIFT = "calc(var(--app-header-height) * -1)";

const springTransition = {
  type: "spring",
  stiffness: 1000,
  damping: 30,
  mass: 0.1,
} as const;

// The wrapper carries the cues rather than the `Link` inside it: cuelume
// delegates via `closest()`, so a hover or click anywhere in the magnet's box
// resolves here.
function MagneticLink({
  children,
  className,
  cues = NAV_LINK_CUES,
}: {
  children: React.ReactNode;
  className?: string;
  cues?: Record<string, string | undefined>;
}) {
  const { ref, position } = useMagnetic(HEADER_MAGNET_STRENGTH);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      data-cursor-corner-size="8"
      {...cues}
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const NAV_ITEMS = [
  { to: "/collab", label: "COLLAB", slug: "collab" },
  { to: "/jams", label: "JAMS", slug: "jams" },
  { to: "/teams", label: "TEAMS", slug: "teams" },
  // Where PROFILE used to sit. The viewer's own profile is one click away in
  // the user menu, so the bar spends the slot on a destination that isn't
  // reachable anywhere else.
  { to: "/members", label: "MEMBERS", slug: "members" },
] as const;

/** A section stays lit on its detail pages — `/jams/foo` is still JAMS. */
function isActivePath(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AppHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const PAGE_TITLES: Record<string, string> = {
    "/command-center": "COMMANDS",
    "/collab": "COLLAB",
    "/jams": "JAMS",
    "/teams": "TEAMS",
    "/members": "MEMBERS",
    "/profile": "PROFILE",
  };
  const mobileTitle =
    PAGE_TITLES[pathname] ??
    (pathname.startsWith("/collab/")
      ? "COLLAB"
      : pathname.startsWith("/jams/")
        ? "JAMS"
        : pathname.startsWith("/teams/")
          ? "TEAMS"
          : null);

  // Auto-hide on scroll-down / reveal on scroll-up. Held open while the mobile
  // menu is expanded — sliding the trigger away under an open overlay strands
  // it. Navigating resets it (the new page's scroller starts at the top).
  // Parking the cursor at the very top edge summons it back without scrolling;
  // it retracts again once the pointer leaves, unless the scroll position has
  // meanwhile brought it back on its own.
  const scrolledAway = useHideOnScrollDown(pathname);
  const peeking = useTopEdgePeek(scrolledAway);
  const hidden = scrolledAway && !peeking && !mobileMenuOpen;
  const slide = useHeaderSlideTransition();

  useHeaderShift(hidden, HEADER_SHIFT);

  return (
    <>
      {/* Height pinned to the inset the shell reserves, so the bar's bottom edge
          lands where the mobile menu overlay starts. */}
      <motion.header
        initial={false}
        animate={{ y: hidden ? "-100%" : "0%" }}
        transition={slide}
        inert={hidden}
        data-cursor-occlude=""
        className="pointer-events-none fixed top-0 right-0 left-0 z-50 flex h-[var(--app-header-height)] items-center justify-between border-b border-b-emboss-shadow bg-background px-4 shadow-sm sm:px-6 lg:px-10"
      >
        {/* Logo */}
        <MagneticLink className="pointer-events-auto shrink-0">
          <Link to="/" className="flex items-center gap-2">
            <motion.div
              className="h-7 w-7"
              style={{
                // The gradient sweep below repaints every frame; its own layer
                // keeps the bar's hide/reveal a pure composited transform.
                transform: "translateZ(0)",
                maskImage: "url(/brackeys-logo.svg)",
                maskSize: "contain",
                maskRepeat: "no-repeat",
                maskPosition: "center",
                WebkitMaskImage: "url(/brackeys-logo.svg)",
                WebkitMaskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
              }}
              initial={{
                backgroundImage:
                  "linear-gradient(to bottom, var(--color-brackeys-yellow), var(--color-brackeys-fuscia), var(--color-brackeys-purple), var(--color-brackeys-fuscia), var(--color-brackeys-yellow))",
                backgroundPosition: "0 0%",
                backgroundSize: "100% 500%",
              }}
              animate={{
                backgroundPosition: ["0 0%", "0 0%", "0 100%", "0 100%", "0 0%"],
              }}
              transition={{
                duration: 6,
                times: [0, 0.2, 0.4, 0.6, 0.8],
                repeat: Infinity,
                ease: "linear",
              }}
            />
            <span className="leading-wide hidden font-sans text-xl font-bold text-foreground sm:inline">
              Brackeys
              <span className="bg-linear-to-r from-[var(--color-brackeys-yellow)] via-[var(--color-brackeys-fuscia)] to-[var(--color-brackeys-purple)] bg-clip-text text-transparent">
                Community
              </span>
            </span>
          </Link>
        </MagneticLink>

        {/* Desktop nav */}
        <div className="pointer-events-auto hidden items-center gap-6 lg:flex">
          <nav className="flex items-center gap-6 text-sm font-bold tracking-widest">
            {NAV_ITEMS.map((item) => {
              const active = isActivePath(pathname, item.to);
              return (
                // The active item keeps the hover tick but drops the page
                // toggle: nothing is about to tear down.
                <MagneticLink key={item.to} cues={active ? HOVER_CUE : NAV_LINK_CUES}>
                  <Link
                    data-testid={`desktop-${item.slug}-link`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative px-2 py-1 transition-colors after:absolute after:inset-x-2 after:-bottom-0.5 after:h-0.5 after:origin-center after:rounded-full after:bg-primary after:transition-transform after:content-['']",
                      active
                        ? "cursor-default text-primary after:scale-x-100"
                        : "text-foreground after:scale-x-0 hover:text-primary",
                    )}
                    to={item.to}
                    onClick={(e) => {
                      // Re-navigating to where you already are restarts the
                      // page transition for no reason.
                      if (active) e.preventDefault();
                    }}
                  >
                    {item.label}
                  </Link>
                </MagneticLink>
              );
            })}
          </nav>

          {/* Tighter than the nav's gap-6 — these read as one control cluster
              rather than more nav destinations. The cog sits outside the
              session branch: theme, motion, and sound are browser-local, so
              signed-out visitors get the same one-click access to them. */}
          <div className="flex items-center gap-2">
            <SettingsMenu />
            {session?.user ? (
              <>
                {/* Before the bell: an outstanding decision outranks an unread
                    event, and this one renders only when there is one. */}
                <AttentionMenu />
                <NotificationBell />
                <UserMenu user={session.user} compact />
              </>
            ) : (
              <Button
                variant="default"
                className="px-5 text-xs font-bold tracking-widest"
                onClick={() => signInWithDiscord("header")}
              >
                LOGIN
              </Button>
            )}
          </div>
        </div>

        {/* Mobile page title + menu button */}
        <div className="pointer-events-auto flex items-center gap-3 lg:hidden">
          {mobileTitle && (
            <span className="text-xs font-bold tracking-widest text-foreground/70 uppercase">
              {mobileTitle}
            </span>
          )}
          <Button
            variant="outline"
            size="icon-lg"
            data-testid="mobile-menu-toggle"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            title={mobileMenuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <HugeiconsIcon icon={mobileMenuOpen ? Cancel01Icon : Menu01Icon} size={18} />
          </Button>
        </div>
      </motion.header>

      {/* Mobile menu overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-auto fixed inset-x-0 top-16 z-40 border-b border-muted/30 bg-background/95 backdrop-blur-md"
          >
            <nav className="flex flex-col gap-1 p-4">
              {NAV_ITEMS.map((item) => {
                const active = isActivePath(pathname, item.to);
                return (
                  <Link
                    key={item.to}
                    data-testid={`mobile-${item.slug}-link`}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    onClick={(e) => {
                      if (active) e.preventDefault();
                      setMobileMenuOpen(false);
                    }}
                    {...(active ? HOVER_CUE : NAV_LINK_CUES)}
                    className={cn(
                      "border-l-2 px-4 py-3 text-sm font-bold tracking-widest transition-colors",
                      active
                        ? "cursor-default border-primary bg-primary/10 text-primary"
                        : "border-transparent text-foreground hover:bg-primary/5 hover:text-primary",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <div className="mt-2 flex items-center justify-end gap-2 border-t border-muted/20 px-4 pt-3">
                {session?.user ? (
                  // The full user menu already carries a settings row; the
                  // cog would be a second door to the same place.
                  <UserMenu user={session.user} />
                ) : (
                  <>
                    <SettingsMenu />
                    <Button
                      variant="default"
                      size="sm"
                      className="text-xs font-bold tracking-widest"
                      onClick={() => {
                        void signInWithDiscord("header_menu", {
                          fetchOptions: { onSuccess: () => setMobileMenuOpen(false) },
                        });
                      }}
                    >
                      LOGIN
                    </Button>
                  </>
                )}
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
