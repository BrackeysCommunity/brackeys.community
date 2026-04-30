import { Link } from "@tanstack/react-router";

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

// Header h-14 (3.5rem) + iOS notch / Android status bar.
const HEADER_HEIGHT = "calc(3.5rem + env(safe-area-inset-top))";
// Bottom nav island: 5 cells @ h-14 (3.5rem buttons) + 0.75rem outer padding
// + safe-area-inset-bottom. Plus a ~1rem visual buffer above the island so the
// last bit of scrollable content doesn't sit flush against the nav.
const BOTTOM_NAV_HEIGHT = "calc(5.5rem + env(safe-area-inset-bottom))";

export function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header
        className="pointer-events-auto fixed inset-x-0 top-0 z-40 flex items-center border-b border-muted/30 bg-background"
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
            <span className="ml-1 text-[10px] tracking-widest text-muted-foreground">MOBILE</span>
          </span>
        </Link>
      </header>

      <main
        id="main-content"
        className="pointer-events-auto fixed inset-x-0 overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          top: HEADER_HEIGHT,
          bottom: BOTTOM_NAV_HEIGHT,
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <div className="bk-page-transition flex w-full flex-col px-4 py-6 selection:bg-primary selection:text-white">
          {children}
        </div>
      </main>

      <MobileBottomNav />
    </>
  );
}
