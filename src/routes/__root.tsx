import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { lazy, Suspense } from "react";

import Dither from "@/components/Dither";
import { CommandPalette } from "@/components/layout/CommandPalette";

const AppHeader = lazy(() =>
  import("@/components/layout/AppHeader").then((m) => ({ default: m.AppHeader })),
);

import { Cursor } from "@/components/ui/cursor";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppThemeProvider } from "@/lib/hooks/use-app-theme";
import { CommandPaletteProvider } from "@/lib/hooks/use-command-palette";
import { PageLayoutProvider, useCurrentSidebar, useMobileMode } from "@/lib/hooks/use-page-layout";

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
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
      { name: "viewport", content: "width=device-width, initial-scale=1" },
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
    <html lang="en" className="dark" data-theme="brackeys">
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
        {/* <GridBackground /> */}
        <Dither
          waveColor={[0.2, 0.22, 0.55]}
          disableAnimation={false}
          enableMouseInteraction
          mouseRadius={0.3}
          colorNum={4}
          waveAmplitude={0.3}
          waveFrequency={3}
          waveSpeed={0.04}
        />
        {/* CRT scanline overlay */}
        <div
          className="animate-scanlines pointer-events-none fixed inset-0 z-55 opacity-10"
          style={{
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.2))",
            backgroundSize: "100% 4px",
          }}
        />
        <div className="pointer-events-none relative z-1 flex min-h-0 flex-1 flex-col overflow-hidden">
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
                    <Suspense>
                      <AppHeader />
                    </Suspense>
                    <TwoColumnShell>{children}</TwoColumnShell>
                    <TanStackDevtools
                      config={{ position: "bottom-right" }}
                      plugins={[
                        { name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> },
                        TanStackQueryDevtools,
                      ]}
                    />
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

function TwoColumnShell({ children }: { children: React.ReactNode }) {
  const sidebar = useCurrentSidebar();
  const mobileMode = useMobileMode();
  const showContentOnMobile = mobileMode === "content";

  return (
    <div
      id="main-content"
      className="pointer-events-none mx-auto flex w-full max-w-[1920px] flex-1 overflow-hidden pt-[57px]"
    >
      {/* Left column — main page content */}
      <div
        className={`flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${showContentOnMobile ? "" : "hidden lg:flex"}`}
      >
        <div className="flex min-h-full w-full flex-col justify-center p-4 selection:bg-primary selection:text-white sm:p-6 lg:p-12 xl:p-16">
          {children}
        </div>
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
