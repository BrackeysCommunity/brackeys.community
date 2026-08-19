import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { captureEvent, initAnalytics } from "@/lib/posthog";

import { NotFoundPage } from "./components/layout/NotFoundPage";
import { PageSkeleton } from "./components/layout/PageSkeleton";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,

    context: getContext(),

    // Every `notFound()` a loader throws lands on the same page unless the
    // route names its own copy — see `@/components/layout/NotFoundPage`.
    defaultNotFoundComponent: () => <NotFoundPage />,

    // Without a *default* pending component only the root route had one,
    // so a route whose loader was in flight (the jam, project and post
    // pages all load server-side) held the page the user was leaving,
    // motionless, until the data landed. Any route that can't commit
    // immediately now says so.
    defaultPendingComponent: () => <PageSkeleton />,
    // Router defaults are 1000/500: a whole second of the previous page
    // before the placeholder is allowed to appear, which is most of the
    // "clicking does nothing" window. 120ms is past the point where a
    // fast navigation would flash a skeleton it doesn't need, and well
    // inside the ~200ms an interaction has to acknowledge a click.
    defaultPendingMs: 120,
    defaultPendingMinMs: 220,

    scrollRestoration: true,
    // The document body is `h-screen overflow-hidden`; the real scroller is
    // the shell's `[data-scroll-root]` element (see `__root.tsx` /
    // `MobileShell`). Router scroll restoration only resets `window` unless
    // told otherwise, so without this a forward navigation left the previous
    // page's scroll offset in place. Exactly one scroll root is mounted at a
    // time — the desktop shell picks one of its two branches, and the touch
    // shell replaces both — so a single selector is enough.
    scrollToTopSelectors: ["[data-scroll-root]"],
    defaultPreload: "intent",
    // Scaffold default was 0, which makes a preloaded match stale the
    // instant it lands — so every hover over a `<Link>` re-runs that
    // route's loader. The jam modal's title is the jam permalink, and
    // that loader is three requests deep; a user reading the modal
    // crossed it repeatedly and paid for it each time.
    defaultPreloadStaleTime: 30_000,
    // A cursor merely crossing a link on its way elsewhere shouldn't
    // preload at all.
    defaultPreloadDelay: 50,
    defaultViewTransition: true,
  });

  // Pageviews are captured here rather than by posthog-js, whose SPA
  // heuristics watch the History API: with `defaultViewTransition` the URL
  // changes before the route resolves, so autocapture would time pageviews
  // against a page that isn't up yet. `onResolved` is the moment the new
  // route is actually settled.
  //
  // Initialising in here (rather than in a provider effect) keeps analytics
  // ready before the first of those fires.
  if (typeof window !== "undefined") {
    initAnalytics();

    // Whether `onResolved` also fires for the initial load depends on how
    // the app was entered (fresh SSR vs. a client-side transition), so the
    // first pageview is sent outright and repeats of the same href are
    // dropped — one pageview per URL, entered either way.
    let lastHref: string | null = null;
    const capturePageview = () => {
      const href = window.location.href;
      if (href === lastHref) return;
      lastHref = href;
      captureEvent("$pageview");
    };

    capturePageview();
    router.subscribe("onResolved", capturePageview);
  }

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
