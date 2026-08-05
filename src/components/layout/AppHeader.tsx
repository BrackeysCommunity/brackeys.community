import { Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { SettingsMenu } from "@/components/layout/SettingsMenu";
import { UserMenu } from "@/components/layout/UserMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Button } from "@/components/ui/button";
import { useHeaderShift } from "@/hooks/use-header-shift";
import { useHideOnScrollDown } from "@/hooks/use-hide-on-scroll-down";
import { useTopEdgePeek } from "@/hooks/use-top-edge-peek";
import { clearActiveUserProfile, fetchActiveUserProfile } from "@/lib/active-user-store";
import { authClient, signInWithDiscord } from "@/lib/auth-client";
import { setAuthSession } from "@/lib/auth-store";
import { HEADER_MAGNET_STRENGTH, useMagnetic } from "@/lib/hooks/use-cursor";

/** Matches the `pt-14` the shell reserves for the bar — see `--app-header-shift`. */
const HEADER_SHIFT = "-3.5rem";

const springTransition = {
  type: "spring",
  stiffness: 1000,
  damping: 30,
  mass: 0.1,
} as const;

function MagneticLink({ children, className }: { children: React.ReactNode; className?: string }) {
  const { ref, position } = useMagnetic(HEADER_MAGNET_STRENGTH);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      data-cursor-corner-size="8"
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function AppHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const PAGE_TITLES: Record<string, string> = {
    "/command-center": "COMMANDS",
    "/collab": "COLLAB",
    "/teams": "TEAMS",
    "/members": "MEMBERS",
    "/profile": "PROFILE",
  };
  const mobileTitle =
    PAGE_TITLES[pathname] ??
    (pathname.startsWith("/collab/") ? "COLLAB" : pathname.startsWith("/teams/") ? "TEAMS" : null);

  // Auto-hide on scroll-down / reveal on scroll-up. Held open while the mobile
  // menu is expanded — sliding the trigger away under an open overlay strands
  // it. Navigating resets it (the new page's scroller starts at the top).
  // Parking the cursor at the very top edge summons it back without scrolling;
  // it retracts again once the pointer leaves, unless the scroll position has
  // meanwhile brought it back on its own.
  const scrolledAway = useHideOnScrollDown(pathname);
  const peeking = useTopEdgePeek(scrolledAway);
  const hidden = scrolledAway && !peeking && !mobileMenuOpen;

  useHeaderShift(hidden, HEADER_SHIFT);

  useEffect(() => {
    setAuthSession(session ?? null);
    if (session?.user) {
      // this is a promise but we don't care about awaiting the result here
      void fetchActiveUserProfile();
    } else {
      clearActiveUserProfile();
    }
  }, [session]);

  return (
    <>
      {/* The scrim is its own fixed layer rather than the bar's `before:`,
          because it outlives the bar: once the header slides away this is what
          keeps page content legible as it scrolls under the sticky page
          controls. Sits above static content but below anything parked at
          `--app-header-shift` (z-20), so a sticky toolbar lands on top of the
          fade while the list passes behind it. The mobile menu overlay is
          taller than the desktop bar, so the fade stays deeper below `lg`. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-background via-background/70 to-transparent lg:h-20"
      />

      <motion.header
        initial={false}
        animate={{ y: hidden ? "-100%" : "0%", opacity: hidden ? 0 : 1 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        inert={hidden}
        className="pointer-events-none fixed top-0 right-0 left-0 z-50 flex items-start justify-between px-4 pt-4 sm:px-6 sm:pt-5 lg:px-10"
      >
        {/* Logo */}
        <MagneticLink className="pointer-events-auto shrink-0">
          <Link to="/" className="flex items-center gap-2">
            <motion.div
              className="h-7 w-7"
              style={{
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
            <span className="leading-wide hidden font-display text-xl font-bold text-foreground sm:inline">
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
            <MagneticLink>
              <Link
                className="px-2 py-1 text-foreground transition-colors hover:text-primary"
                to="/collab"
              >
                COLLAB
              </Link>
            </MagneticLink>
            <MagneticLink>
              <Link
                className="px-2 py-1 text-foreground transition-colors hover:text-primary"
                to="/teams"
              >
                TEAMS
              </Link>
            </MagneticLink>
            {/* Where PROFILE used to sit. The viewer's own profile is one
                click away in the user menu, so the bar spends the slot on
                a destination that isn't reachable anywhere else. */}
            <MagneticLink>
              <Link
                data-testid="desktop-members-link"
                className="px-2 py-1 text-foreground transition-colors hover:text-primary"
                to="/members"
              >
                MEMBERS
              </Link>
            </MagneticLink>
          </nav>

          {session?.user ? (
            // Tighter than the nav's gap-6 — these three read as one control
            // cluster rather than three more nav destinations.
            <div className="flex items-center gap-2">
              <SettingsMenu />
              <NotificationBell />
              <UserMenu user={session.user} />
            </div>
          ) : (
            <Button
              variant="default"
              className="px-5 text-xs font-bold tracking-widest"
              onClick={() => signInWithDiscord()}
            >
              LOGIN
            </Button>
          )}
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
            className="pointer-events-auto fixed inset-x-0 top-[57px] z-40 border-b border-muted/30 bg-background/95 backdrop-blur-md"
          >
            <nav className="flex flex-col gap-1 p-4">
              <Link
                to="/collab"
                onClick={() => setMobileMenuOpen(false)}
                className="px-4 py-3 text-sm font-bold tracking-widest text-foreground transition-colors hover:bg-primary/5 hover:text-primary"
              >
                COLLAB
              </Link>
              <Link
                to="/teams"
                onClick={() => setMobileMenuOpen(false)}
                className="px-4 py-3 text-sm font-bold tracking-widest text-foreground transition-colors hover:bg-primary/5 hover:text-primary"
              >
                TEAMS
              </Link>
              <Link
                data-testid="mobile-members-link"
                to="/members"
                onClick={() => setMobileMenuOpen(false)}
                className="px-4 py-3 text-sm font-bold tracking-widest text-foreground transition-colors hover:bg-primary/5 hover:text-primary"
              >
                MEMBERS
              </Link>
              <div className="mt-2 flex items-center justify-end border-t border-muted/20 px-4 pt-3">
                {session?.user ? (
                  <UserMenu user={session.user} />
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    className="text-xs font-bold tracking-widest"
                    onClick={() => {
                      void signInWithDiscord({
                        fetchOptions: { onSuccess: () => setMobileMenuOpen(false) },
                      });
                    }}
                  >
                    LOGIN
                  </Button>
                )}
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
