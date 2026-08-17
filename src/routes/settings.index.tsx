import { createFileRoute, redirect } from "@tanstack/react-router";

/** Bare `/settings` has no pane of its own — appearance is the landing. */
export const Route = createFileRoute("/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/appearance", replace: true });
  },
});
