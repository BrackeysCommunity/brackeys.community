import { lazy, Suspense } from "react";

import type { GrainientProps } from "./grainient-surface";

export type { GrainientProps };

/**
 * The shader surface, behind a lazy boundary.
 *
 * `ogl` and the two shaders are 16 KB gzipped, and the client entry's
 * static graph reaches every route, so importing the implementation
 * directly put them in the preload list of every page — including the ones
 * with no gradient on them. Only three surfaces mount it (the jam banner
 * backdrop, its grain overlay, and the calendar's detail modal), all of
 * them decorative and none of them able to draw before hydration anyway.
 *
 * `fallback={null}` rather than a placeholder: the surfaces underneath it
 * already carry their own background, so there is nothing to hold open.
 */
const Surface = lazy(() => import("./grainient-surface").then((m) => ({ default: m.Grainient })));

export function Grainient(props: GrainientProps) {
  return (
    <Suspense fallback={null}>
      <Surface {...props} />
    </Suspense>
  );
}
