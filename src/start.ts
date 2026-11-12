import { createMiddleware, createStart } from "@tanstack/react-start";

import { playHostRefusal } from "@/lib/engine/frame-route-rules";

/** On the play host (`ENGINE_PLAY_ORIGIN`), every route but the frames answers 404. */
export const playHostOnlyFrames = createMiddleware({ type: "request" }).server(
  ({ request, next }) => playHostRefusal(request) ?? next(),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [playHostOnlyFrames],
}));
