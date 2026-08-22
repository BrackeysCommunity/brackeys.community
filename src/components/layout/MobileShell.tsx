import { Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { BrackeysMark } from "@/components/ui/brackeys-mark";
import { Button } from "@/components/ui/button";
import { authClient, signInWithDiscord } from "@/lib/auth-client";
import { useHeaderShift } from "@/lib/hooks/use-header-shift";
import { useHeaderSlideTransition, useHideOnScrollDown } from "@/lib/hooks/use-hide-on-scroll-down";

// Header h-14 (3.5rem) + iOS notch / Android status bar.
const HEADER_HEIGHT = "calc(3.5rem + env(safe-area-inset-top))";
/** …and its negation, which is how far sticky content rises once it hides. */
const HEADER_SHIFT = "calc(-3.5rem - env(safe-area-inset-top))";
// Bottom nav island: 5 cells @ h-16 (4rem buttons) + 0.75rem outer padding
// + safe-area-inset-bottom. Plus a ~1rem visual buffer above the island so the
// last bit of scrollable content doesn't sit flush against the nav.
export const BOTTOM_NAV_HEIGHT = "calc(6rem + env(safe-area-inset-bottom))";

export function MobileShell({ children }: { children: React.ReactNode }) {
  const { data: session } = authClient.useSession();

  // Same auto-hide as the desktop bar. The scroller below starts at the very
  // top of the viewport and holds the bar's height as padding, so what the
  // header uncovers is page content rather than a blank strip.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hidden = useHideOnScrollDown(pathname);
  useHeaderShift(hidden, HEADER_SHIFT);
  const slide = useHeaderSlideTransition();

  return (
    <>
      <motion.header
        initial={false}
        animate={{ y: hidden ? "-100%" : "0%" }}
        transition={slide}
        inert={hidden}
        className="pointer-events-auto fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-3 border-b border-b-emboss-shadow bg-background shadow-sm"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "calc(1rem + env(safe-area-inset-left))",
          paddingRight: "calc(1rem + env(safe-area-inset-right))",
          height: HEADER_HEIGHT,
        }}
      >
        <Link to="/" className="flex items-center gap-1.5">
          <BrackeysMark className="h-7 w-7" />
          <span className="font-display text-base leading-none font-bold text-foreground">
            Brackeys
            <span className="bg-linear-to-r from-[var(--color-brackeys-yellow)] via-[var(--color-brackeys-fuscia)] to-[var(--color-brackeys-purple)] bg-clip-text text-transparent">
              Community
            </span>
          </span>
        </Link>

        {/* The cog outlives the session: theme, motion, and sound are stored
            in this browser, so signed-out visitors reach them the same way. */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Settings"
            title="Settings"
            render={<Link to="/settings/appearance" />}
          >
            <HugeiconsIcon icon={Settings02Icon} size={16} />
          </Button>
          {session?.user ? null : (
            <Button
              variant="default"
              size="sm"
              className="px-4 text-xs font-bold tracking-widest"
              onClick={() => signInWithDiscord("mobile_shell")}
            >
              LOGIN
            </Button>
          )}
        </div>
      </motion.header>

      <main
        id="main-content"
        data-scroll-root
        data-scroll-restoration-id="main-scroll"
        // `view-transition-name: page` — see the desktop shell in
        // `routes/__root.tsx`; only one of the two is ever mounted.
        className="pointer-events-auto fixed inset-x-0 top-0 bottom-0 overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [view-transition-name:page] [&::-webkit-scrollbar]:hidden"
        style={{
          // Reaches the top edge and carries the bar's height as padding
          // rather than starting below it: the padding scrolls away with the
          // content, so a hidden header reveals the page instead of a gap.
          // It also puts this scroller's *content* box under the bar, which
          // is where sticky offsets are measured from — `top: 0` on a child
          // means "just under the header", same as the desktop shell.
          paddingTop: HEADER_HEIGHT,
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <div
          className="content-pane flex w-full flex-col px-4 pt-4 selection:bg-primary selection:text-white"
          style={{ paddingBottom: `calc(${BOTTOM_NAV_HEIGHT} + 1rem)` }}
        >
          {children}
        </div>
      </main>

      {/* Bottom fade so content scrolling under the nav island remains
          legible against the island chrome. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40"
        style={{
          height: BOTTOM_NAV_HEIGHT,
          background:
            "linear-gradient(to top, var(--color-background) 35%, color-mix(in srgb, var(--color-background) 70%, transparent) 70%, transparent 100%)",
        }}
      />

      <MobileBottomNav />
    </>
  );
}
