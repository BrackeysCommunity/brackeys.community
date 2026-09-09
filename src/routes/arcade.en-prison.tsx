import { createFileRoute } from "@tanstack/react-router";

import { EnPrisonGame } from "@/arcade/en-prison/ui/EnPrisonGame";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { useFlagBlocks } from "@/lib/hooks/use-flag";

export const Route = createFileRoute("/arcade/en-prison")({
  // Client-only: the game is a canvas of state with no server render worth
  // producing, and keeping it out of SSR is what keeps its chunk off every
  // other page's critical path.
  ssr: false,
  component: EnPrison,
});

function EnPrison() {
  // `useFlagBlocks`, not `useFlag`: a visitor whose browser blocks PostHog
  // still gets the game. Only a flag someone deliberately switched off
  // closes the door. Both are read before either is judged — `||` would
  // short-circuit the second hook out of the render.
  const arcadeOff = useFlagBlocks("arcade-enabled");
  const gameOff = useFlagBlocks("arcade-en-prison");
  // Rendered, not thrown. `notFound()` raised during a component's render
  // lands in the error boundary rather than the not-found one, so throwing
  // here produced "Something went wrong!" instead of a 404. A flag is read
  // on the client and could never have changed the response status anyway,
  // so the page is the whole of what a 404 can mean here.
  if (arcadeOff || gameOff) return <NotFoundPage />;
  return <EnPrisonGame />;
}
