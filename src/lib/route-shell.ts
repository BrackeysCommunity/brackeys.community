import { useRouterState } from "@tanstack/react-router";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /**
     * `"takeover"`: the page owns the whole window. The root renders it with
     * no header, footer, content pane or mobile shell (canvases, notes).
     */
    shell?: "takeover";
  }
}

/**
 * Whether a matched route asked for the whole window. A 404 or an error on
 * that route keeps the site's shell, so the way out stays where it always is.
 */
export function useTakeoverShell(): boolean {
  return useRouterState({
    select: (s) =>
      s.matches.some(
        (m) =>
          m.staticData?.shell === "takeover" && m.status !== "notFound" && m.status !== "error",
      ),
  });
}
