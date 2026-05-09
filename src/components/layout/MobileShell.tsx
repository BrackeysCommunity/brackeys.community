import { Link } from "@tanstack/react-router";

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { UserMenu } from "@/components/layout/UserMenu";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

// Header h-14 (3.5rem) + iOS notch / Android status bar.
const HEADER_HEIGHT = "calc(3.5rem + env(safe-area-inset-top))";
// Bottom nav island: 5 cells @ h-14 (3.5rem buttons) + 0.75rem outer padding
// + safe-area-inset-bottom. Plus a ~1rem visual buffer above the island so the
// last bit of scrollable content doesn't sit flush against the nav.
const BOTTOM_NAV_HEIGHT = "calc(5.5rem + env(safe-area-inset-bottom))";

export function MobileShell({ children }: { children: React.ReactNode }) {
  const { data: session } = authClient.useSession();

  return (
    <>
      <header
        className="pointer-events-auto fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-3 border-b border-muted/30 bg-background"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "calc(1rem + env(safe-area-inset-left))",
          paddingRight: "calc(1rem + env(safe-area-inset-right))",
          height: HEADER_HEIGHT,
        }}
      >
        <Link to="/" className="flex items-center gap-2">
          <div
            className="h-6 w-6"
            style={{
              maskImage: "url(/brackeys-logo.svg)",
              maskSize: "contain",
              maskRepeat: "no-repeat",
              maskPosition: "center",
              WebkitMaskImage: "url(/brackeys-logo.svg)",
              WebkitMaskSize: "contain",
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              background:
                "linear-gradient(135deg, var(--color-brackeys-yellow), var(--color-brackeys-fuscia), var(--color-brackeys-purple))",
            }}
          />
          <span className="font-mono text-sm leading-none font-bold text-foreground">
            Brackeys
            <span className="bg-linear-to-r from-[var(--color-brackeys-yellow)] via-[var(--color-brackeys-fuscia)] to-[var(--color-brackeys-purple)] bg-clip-text text-transparent">
              Community
            </span>
          </span>
        </Link>

        {session?.user ? (
          <UserMenu user={session.user} />
        ) : (
          <Button
            variant="default"
            size="sm"
            className="px-4 font-mono text-xs font-bold tracking-widest"
            onClick={() => authClient.signIn.social({ provider: "discord" })}
          >
            LOGIN
          </Button>
        )}
      </header>

      <main
        id="main-content"
        className="pointer-events-auto fixed inset-x-0 bottom-0 overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          top: HEADER_HEIGHT,
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <div
          className="bk-page-transition flex w-full flex-col px-4 pt-16 selection:bg-primary selection:text-white"
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
