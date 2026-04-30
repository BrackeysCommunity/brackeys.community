import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { SiteFooter } from "@/components/home/SiteFooter";
import { BackgroundBlobs } from "@/components/layout/BackgroundBlobs";
import { CommandPalette } from "@/components/layout/CommandPalette";

const AppHeader = lazy(() =>
  import("@/components/layout/AppHeader").then((m) => ({ default: m.AppHeader })),
);

const MobileShell = lazy(() =>
  import("@/components/layout/MobileShell").then((m) => ({ default: m.MobileShell })),
);

import { Cursor } from "@/components/ui/cursor";
import { ThemedDotField } from "@/components/ui/dot-field";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsTouchDevice } from "@/hooks/use-touch-device";
import { AppThemeProvider } from "@/lib/hooks/use-app-theme";
import { CommandPaletteProvider } from "@/lib/hooks/use-command-palette";
import { PageLayoutProvider, useCurrentSidebar, useMobileMode } from "@/lib/hooks/use-page-layout";

import TanStackQueryProvider from "../integrations/tanstack-query/root-provider";

import fontsCss from "../fonts.css?url";
import appCss from "../styles.css?url";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: async () => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("lang", "en");
    }
  },

  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Brackeys Community" },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/brackeys-logo.svg",
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/brackeys-logo-inverted.svg",
        media: "(prefers-color-scheme: dark)",
      },
      { rel: "stylesheet", href: fontsCss },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootDocument,
  errorComponent: RouteErrorBoundary,
  pendingComponent: RoutePendingFallback,
});

function RouteErrorBoundary({ error }: { error: Error }) {
  return (
    <div className="pointer-events-auto flex flex-1 items-center justify-center p-12">
      <div className="max-w-md space-y-4 text-center">
        <p className="font-mono text-sm tracking-[0.2em] text-destructive uppercase">
          {"// SYSTEM ERROR"}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="border border-primary/40 px-4 py-2 font-mono text-xs tracking-widest text-primary uppercase transition-colors hover:bg-primary/10"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

function RoutePendingFallback() {
  return (
    <div className="flex flex-1 items-center justify-center p-12">
      <span className="animate-pulse font-mono text-xs tracking-widest text-muted-foreground uppercase">
        Loading...
      </span>
    </div>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" data-theme="nord">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("brackeys-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
      </head>
      <body className="flex h-screen flex-col overflow-hidden">
        <Cursor />
        <BackgroundBlobs />
        <ThemedDotField
          dotRadius={1}
          dotSpacing={20}
          bulgeStrength={20}
          glowRadius={60}
          waveAmplitude={1}
          cursorRadius={500}
          cursorForce={0.0075}
          bulgeOnly={false}
          className="pointer-events-none fixed inset-0 z-0"
        />
        {/* CRT scanline overlay */}
        <div
          className="animate-scanlines pointer-events-none fixed inset-0 z-10 opacity-7"
          style={{
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.2))",
            backgroundSize: "100% 4px",
          }}
        />
        <div className="relative z-1 flex min-h-0 flex-1 flex-col overflow-hidden">
          <a
            href="#main-content"
            className="sr-only focus:pointer-events-auto focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-9999 focus:bg-primary focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:tracking-widest focus:text-primary-foreground focus:uppercase"
          >
            Skip to content
          </a>
          <TanStackQueryProvider>
            <AppThemeProvider>
              <TooltipProvider>
                <CommandPaletteProvider>
                  <PageLayoutProvider>
                    <CommandPalette />
                    <ResponsiveShell>{children}</ResponsiveShell>
                  </PageLayoutProvider>
                </CommandPaletteProvider>
              </TooltipProvider>
            </AppThemeProvider>
          </TanStackQueryProvider>
        </div>
        <Toaster position="bottom-right" style={{ zIndex: 9999 }} />
        <Scripts />
      </body>
    </html>
  );
}

function ResponsiveShell({ children }: { children: React.ReactNode }) {
  const isTouch = useIsTouchDevice();

  if (isTouch) {
    return (
      <Suspense>
        <MobileShell>{children}</MobileShell>
      </Suspense>
    );
  }

  return (
    <>
      <Suspense>
        <AppHeader />
      </Suspense>
      <TwoColumnShell>{children}</TwoColumnShell>
    </>
  );
}

function TwoColumnShell({ children }: { children: React.ReactNode }) {
  const sidebar = useCurrentSidebar();
  const mobileMode = useMobileMode();
  const showContentOnMobile = mobileMode === "content";
  const hasSidebar = sidebar != null;

  // When a page doesn't register a sidebar, it owns the full width and handles
  // its own internal layout (e.g. the redesigned HomePage).
  if (!hasSidebar) {
    return (
      <div
        id="main-content"
        className="mx-auto flex w-full max-w-480 flex-1 overflow-x-hidden pt-14"
      >
        <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div
            className="bk-page-transition flex w-full shrink-0 flex-col p-4 selection:bg-primary selection:text-white sm:px-6 sm:pt-6 lg:px-10 lg:pt-10 xl:px-14 xl:pt-14"
            style={{ minHeight: "100%" }}
          >
            {children}
          </div>
          <SiteFooter />
        </div>
      </div>
    );
  }

  return (
    <div
      id="main-content"
      className="mx-auto flex w-full max-w-480 flex-1 overflow-hidden pt-14.25"
    >
      {/* Left column — main page content */}
      <div
        className={`flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${showContentOnMobile ? "" : "hidden lg:flex"}`}
      >
        <div
          className="bk-page-transition flex w-full shrink-0 flex-col justify-center p-4 selection:bg-primary selection:text-white sm:px-6 sm:pt-6 lg:px-12 lg:pt-12 xl:px-16 xl:pt-16"
          style={{ minHeight: "100%" }}
        >
          {children}
        </div>
        <SiteFooter />
      </div>

      {/* Right column — page-specific sidebar */}
      <aside
        className={`flex w-full flex-1 shrink-0 justify-center overflow-hidden ${showContentOnMobile ? "hidden lg:flex" : ""}`}
      >
        <div className="flex h-full w-full max-w-2xl min-w-0 flex-col xl:min-w-xl">{sidebar}</div>
      </aside>
    </div>
  );
}
