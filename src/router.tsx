import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,

    context: getContext(),

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
    defaultPreloadStaleTime: 0,
    defaultViewTransition: true,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
