import {
  Cancel01Icon,
  Clock01Icon,
  ComputerTerminal01Icon,
  Menu01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useInterval } from "ahooks";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { UserMenu } from "@/components/layout/UserMenu";
import { Button } from "@/components/ui/button";
import { Hotkey } from "@/components/ui/hotkey";
import {
  activeUserStore,
  clearActiveUserProfile,
  fetchActiveUserProfile,
} from "@/lib/active-user-store";
import { authClient } from "@/lib/auth-client";
import { setAuthSession } from "@/lib/auth-store";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import { useMagnetic } from "@/lib/hooks/use-cursor";

const springTransition = {
  type: "spring",
  stiffness: 1000,
  damping: 30,
  mass: 0.1,
} as const;

function MagneticLink({ children, className }: { children: React.ReactNode; className?: string }) {
  const { ref, position } = useMagnetic(0.2);
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

const getUtcTime = () => {
  const now = new Date();
  return `UTC ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
};

export function AppHeader() {
  const [utcTime, setUtcTime] = useState(getUtcTime);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useInterval(() => setUtcTime(getUtcTime()), 1000);
  const { setOpen: openPalette } = useCommandPalette();
  const { data: session } = authClient.useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeProfile = useStore(activeUserStore, (s) => s.profile);
  const profileSlug = activeProfile?.urlStub ?? session?.user?.id;

  const PAGE_TITLES: Record<string, string> = {
    "/command-center": "COMMANDS",
    "/collab": "COLLAB",
    "/profile": "PROFILE",
  };
  const mobileTitle = PAGE_TITLES[pathname] ?? (pathname.startsWith("/collab/") ? "COLLAB" : null);

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
      <header className="pointer-events-none fixed top-0 right-0 left-0 z-50 flex items-start justify-between px-4 pt-4 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:-z-10 before:h-32 before:bg-gradient-to-b before:from-background before:via-background/70 before:to-transparent before:content-[''] sm:px-6 sm:pt-5 lg:px-10">
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
            <span className="leading-wide hidden font-mono text-xl font-bold text-foreground sm:inline">
              Brackeys
              <span className="bg-linear-to-r from-[var(--color-brackeys-yellow)] via-[var(--color-brackeys-fuscia)] to-[var(--color-brackeys-purple)] bg-clip-text text-transparent">
                Community
              </span>
            </span>
          </Link>
        </MagneticLink>

        {/* Desktop nav */}
        <div className="pointer-events-auto hidden items-center gap-6 lg:flex">
          <nav className="flex items-center gap-6 font-mono text-sm font-bold tracking-widest">
            <MagneticLink>
              <Link
                data-cursor-no-drift
                className="px-2 py-1 text-foreground transition-colors hover:text-primary"
                to="/command-center"
              >
                COMMANDS
              </Link>
            </MagneticLink>
            <MagneticLink>
              <Link
                data-cursor-no-drift
                className="px-2 py-1 text-foreground transition-colors hover:text-primary"
                to="/collab"
              >
                COLLAB
              </Link>
            </MagneticLink>
            <MagneticLink>
              <Link
                data-testid="desktop-profile-link"
                data-cursor-no-drift
                className="px-2 py-1 text-foreground transition-colors hover:text-primary"
                to={profileSlug ? "/profile/$userId" : "/profile"}
                {...(profileSlug ? { params: { userId: profileSlug } } : {})}
              >
                PROFILE
              </Link>
            </MagneticLink>
          </nav>

          <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <HugeiconsIcon icon={Clock01Icon} size={14} />
            <span>{utcTime}</span>
          </div>

          <Button
            variant="outline"
            size="sm"
            isMagnetic
            data-cursor-no-drift
            onClick={() => openPalette(true)}
            className="gap-2 border-muted font-mono text-xs text-muted-foreground shadow-[2px_2px_0px_var(--color-primary)] hover:border-primary hover:text-primary"
          >
            <HugeiconsIcon icon={ComputerTerminal01Icon} size={14} />
            <Hotkey value="command+k" className="hidden opacity-60 xl:inline-flex" />
          </Button>

          {session?.user ? (
            <UserMenu user={session.user} />
          ) : (
            <Button
              variant="default"
              isMagnetic
              className="px-5 font-mono text-xs font-bold tracking-widest"
              data-cursor-no-drift
              onClick={() => authClient.signIn.social({ provider: "discord" })}
            >
              LOGIN
            </Button>
          )}
        </div>

        {/* Mobile page title + menu button */}
        <div className="pointer-events-auto flex items-center gap-3 lg:hidden">
          {mobileTitle && (
            <span className="font-mono text-xs font-bold tracking-widest text-foreground/70 uppercase">
              {mobileTitle}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => openPalette(true)}
            className="h-9 w-9 border-muted p-0 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <HugeiconsIcon icon={ComputerTerminal01Icon} size={16} />
          </Button>
          <button
            type="button"
            data-testid="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-9 w-9 items-center justify-center border border-muted bg-card/40 text-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <HugeiconsIcon icon={mobileMenuOpen ? Cancel01Icon : Menu01Icon} size={18} />
          </button>
        </div>
      </header>

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
                to="/command-center"
                onClick={() => setMobileMenuOpen(false)}
                className="px-4 py-3 font-mono text-sm font-bold tracking-widest text-foreground transition-colors hover:bg-primary/5 hover:text-primary"
              >
                COMMANDS
              </Link>
              <Link
                to="/collab"
                onClick={() => setMobileMenuOpen(false)}
                className="px-4 py-3 font-mono text-sm font-bold tracking-widest text-foreground transition-colors hover:bg-primary/5 hover:text-primary"
              >
                COLLAB
              </Link>
              <Link
                data-testid="mobile-profile-link"
                to={profileSlug ? "/profile/$userId" : "/profile"}
                {...(profileSlug ? { params: { userId: profileSlug } } : {})}
                onClick={() => setMobileMenuOpen(false)}
                className="px-4 py-3 font-mono text-sm font-bold tracking-widest text-foreground transition-colors hover:bg-primary/5 hover:text-primary"
              >
                PROFILE
              </Link>
              <div className="mt-2 flex items-center justify-between border-t border-muted/20 px-4 pt-3">
                <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  <HugeiconsIcon icon={Clock01Icon} size={14} />
                  <span>{utcTime}</span>
                </div>
                {session?.user ? (
                  <UserMenu user={session.user} />
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    className="font-mono text-xs font-bold tracking-widest"
                    onClick={() => {
                      void authClient.signIn.social({
                        provider: "discord",
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
