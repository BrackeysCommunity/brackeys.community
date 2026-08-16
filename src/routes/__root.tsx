import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";
import { lazy, Suspense } from "react";

import { SiteFooter } from "@/components/home/SiteFooter";
import { AuthSessionSync } from "@/components/layout/AuthSessionSync";
import { BackgroundBlobs } from "@/components/layout/BackgroundBlobs";
import { CommandPalette } from "@/components/layout/CommandPalette";

const AppHeader = lazy(() =>
  import("@/components/layout/AppHeader").then((m) => ({ default: m.AppHeader })),
);

const MobileShell = lazy(() =>
  import("@/components/layout/MobileShell").then((m) => ({ default: m.MobileShell })),
);

// The three latin subsets are needed on every page, and they are only
// discoverable once fonts.css has been fetched and parsed — preload them
// alongside it so the swap happens in the first paint, not after it.
import monoLatin from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";
import sansLatin from "@fontsource-variable/rubik/files/rubik-latin-wght-normal.woff2?url";
import displayLatin from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url";

import { ConfirmPortal } from "@/components/ui/confirm";
import { Cursor } from "@/components/ui/cursor";
import { ThemedDotField } from "@/components/ui/dot-field";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { AppSettingsProvider, useReducedMotion } from "@/lib/hooks/use-app-settings";
import { AppThemeProvider } from "@/lib/hooks/use-app-theme";
import { CommandPaletteProvider } from "@/lib/hooks/use-command-palette";
import { useNotificationStream } from "@/lib/hooks/use-notification-stream";
import { PageLayoutProvider, useCurrentSidebar, useMobileMode } from "@/lib/hooks/use-page-layout";

import TanStackQueryProvider from "../integrations/tanstack-query/root-provider";

import fontsCss from "../fonts.css?url";
import appCss from "../styles.css?url";

// `as const` keeps crossOrigin narrow: React types it as CrossOrigin, and a
// mapped object literal would widen it to string.
const fontPreloads = [sansLatin, displayLatin, monoLatin].map(
  (href) =>
    ({
      rel: "preload",
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous",
      href,
    }) as const,
);

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
      ...fontPreloads,
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
          className="border border-primary/40 px-4 py-2 text-xs tracking-widest text-primary uppercase transition-colors hover:bg-primary/10"
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
      <span className="animate-pulse text-xs tracking-widest text-muted-foreground uppercase">
        Loading...
      </span>
    </div>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The pre-paint script below rewrites `data-theme` and
    // `data-reduce-motion` from storage before React hydrates, so these
    // values are the server's best guess by design — suppress the
    // mismatch warning rather than give up correcting them pre-paint.
    <html
      lang="en"
      className="dark"
      data-theme="nord"
      data-reduce-motion="false"
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
        {/* Pre-paint prefs: theme, then the effective reduced-motion value —
            the same legacy migration + coalescing as `use-app-settings`, so
            CSS keyed on `data-reduce-motion` is right on the first frame. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{var t=localStorage.getItem("brackeys-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}` +
              `try{var m=localStorage.getItem("brackeys-reduce-motion");var p=m==="1"||m==="reduced"?"reduced":m==="full"?"full":"system";var r=p==="reduced"||(p==="system"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);document.documentElement.dataset.reduceMotion=r?"true":"false"}catch(e){}`,
          }}
        />
        {/* Owns the view-transition promises the router drops on the floor.
            router-core (1.160.2) calls `document.startViewTransition(fn)` and
            discards the handle, so when the browser *skips* a transition —
            a backgrounded tab, or a second navigation landing inside the
            ~350ms window the page animation opens — its `ready`/`finished`
            promises reject with nothing attached, and each one surfaces as an
            uncaught InvalidStateError. Only that skip signature is swallowed;
            anything else is rethrown so it stays visible. Drop this once the
            router attaches its own handler. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=document,s=d.startViewTransition;if(typeof s==="function"){d.startViewTransition=function(a){var t=s.call(d,a);var k=function(e){if(!(e instanceof DOMException)||(e.name!=="InvalidStateError"&&e.name!=="AbortError"))throw e};t.ready.catch(k);t.finished.catch(k);t.updateCallbackDone.catch(k);return t}}}catch(e){}`,
          }}
        />
      </head>
      <body className="flex h-screen flex-col overflow-hidden">
        {/* AppSettingsProvider sits above the decorative layers so the
            backgrounds can read the effective reduced-motion value. */}
        <AppSettingsProvider>
          <AppMotionConfig>
            <Cursor />
            <BackgroundBlobs />
            <BackgroundDotField />
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
                className="sr-only focus:pointer-events-auto focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-9999 focus:bg-primary focus:px-4 focus:py-2 focus:text-xs focus:tracking-widest focus:text-primary-foreground focus:uppercase"
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
          </AppMotionConfig>
        </AppSettingsProvider>
        <Toaster position="bottom-right" style={{ zIndex: 9999 }} />
        <ConfirmPortal />
        <Scripts />
      </body>
    </html>
  );
}

/** App-level framer defaults. `"always"` (not `"user"`) because the
 * effective value already coalesces the native query with the in-app
 * pref — an explicit "On" must override an OS-level reduce. */
function AppMotionConfig({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return <MotionConfig reducedMotion={reduced ? "always" : "never"}>{children}</MotionConfig>;
}

function BackgroundDotField() {
  const reduced = useReducedMotion();
  return (
    <ThemedDotField
      dotRadius={1}
      dotSpacing={20}
      bulgeStrength={20}
      glowRadius={60}
      waveAmplitude={2}
      cursorRadius={500}
      cursorForce={0.0075}
      bulgeOnly={false}
      static={reduced}
      className="pointer-events-none fixed inset-0 z-0 opacity-50"
    />
  );
}

function NotificationStreamMount() {
  useNotificationStream();
  return null;
}

function ResponsiveShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  return (
    <>
      <AuthSessionSync />
      <NotificationStreamMount />
      {isMobile ? (
        <Suspense>
          <MobileShell>{children}</MobileShell>
        </Suspense>
      ) : (
        <>
          <Suspense>
            <AppHeader />
          </Suspense>
          <TwoColumnShell>{children}</TwoColumnShell>
        </>
      )}
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
    // Scrolling lives on the outer (full-width) container so SiteFooter can
    // sit as a full-bleed sibling of the max-w-480 content wrapper. The
    // content wrapper deliberately *does not* set `overflow-x-hidden` —
    // doing so would auto-promote overflow-y to `auto` and capture the
    // scroll inside the wrapper, leaving the footer pinned to the viewport
    // bottom. A great-grandparent (`overflow-hidden` at the root shell)
    // still clips horizontally so we don't risk a page-level scrollbar.
    return (
      <div
        id="main-content"
        data-scroll-root
        // Stable key for router scroll restoration. Without it the router
        // falls back to a generated `nth-child` path, which breaks once the
        // lazy `AppHeader` resolves and shifts the sibling indices.
        data-scroll-restoration-id="main-scroll"
        // `overscroll-y-none` suppresses the rubber band. Chrome clips the
        // scrolling contents to the scroll extent, so nothing the footer paints
        // reaches the bounce gutter — the fixed dot field behind the scroller
        // shows through instead.
        // `view-transition-name: page` scopes the cross-route fade+rise to
        // the scroller (see `styles.css`). Exactly one shell branch is
        // mounted at a time, so the name is never duplicated in a snapshot.
        className="flex flex-1 flex-col overflow-y-auto overscroll-y-none pt-14 [-ms-overflow-style:none] [scrollbar-width:none] [view-transition-name:page] [&::-webkit-scrollbar]:hidden"
      >
        {/* `grow shrink-0` rather than a `min-h-full` on the inner box: the
            wrapper is a flex item of an auto-height column, so a percentage
            min-height has nothing definite to resolve against and collapses
            to the content height — which is what let the footer ride up
            mid-viewport on tall screens with a short page. Growing to the
            scroller's leftover space pins it to the bottom; `shrink-0`
            keeps a long page from being squeezed back into one screen. */}
        <div className="mx-auto flex w-full max-w-7xl shrink-0 grow flex-col">
          {/* The fade width tracks this column's own horizontal padding at
              each breakpoint, so the pane ends exactly where the content
              does. */}
          {/* The footer's separation is this column's bottom padding rather
              than a margin on the footer, so the pane covers it — a margin
              sits outside the pane and reads as a band of bare dot field
              between the content and the footer rule. */}
          <div className="content-pane flex w-full grow flex-col p-4 pb-16 selection:bg-primary selection:text-white sm:px-6 sm:pt-6 sm:[--content-pane-fade:1.5rem] lg:px-10 lg:pt-10 lg:[--content-pane-fade:2.5rem] xl:px-14 xl:pt-14 xl:[--content-pane-fade:3.5rem]">
            {children}
          </div>
        </div>
        <SiteFooter />
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
        data-scroll-root
        data-scroll-restoration-id="main-scroll"
        // The header inset lives on the parent here, outside the scroller, so
        // a hidden bar leaves nothing for sticky content to reclaim.
        style={{ "--app-header-shift": "0px" } as React.CSSProperties}
        className={`flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-none [-ms-overflow-style:none] [scrollbar-width:none] [view-transition-name:page] [&::-webkit-scrollbar]:hidden ${showContentOnMobile ? "" : "hidden lg:flex"}`}
      >
        <div
          className="content-pane flex w-full shrink-0 flex-col justify-center p-4 pb-16 selection:bg-primary selection:text-white sm:px-6 sm:pt-6 sm:[--content-pane-fade:1.5rem] lg:px-12 lg:pt-12 lg:[--content-pane-fade:3rem] xl:px-16 xl:pt-16 xl:[--content-pane-fade:4rem]"
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
