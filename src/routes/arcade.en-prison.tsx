import { createFileRoute, notFound } from "@tanstack/react-router";

import { arcadeAccessQueryOptions } from "@/arcade/access";
import { EnPrisonGame } from "@/arcade/en-prison/ui/EnPrisonGame";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { useFlagBlocks } from "@/lib/hooks/use-flag";

export const Route = createFileRoute("/arcade/en-prison")({
  // Client-only: the game is a canvas of state with no server render worth
  // producing, and keeping it out of SSR is what keeps its chunk off every
  // other page's critical path.
  ssr: false,
  loader: async ({ context: { queryClient } }) => {
    const access = await queryClient.ensureQueryData(arcadeAccessQueryOptions());
    if (!access.enPrison) throw notFound();
  },
  component: EnPrison,
});

function EnPrison() {
  // The loader is the gate; these cover a flag switched off mid-visit.
  // Both are read before either is judged — `||` would short-circuit the
  // second hook out of the render.
  const arcadeOff = useFlagBlocks("arcade-enabled");
  const gameOff = useFlagBlocks("arcade-en-prison");
  // Rendered, not thrown: `notFound()` raised during render lands in the
  // error boundary, not the not-found one.
  if (arcadeOff || gameOff) return <NotFoundPage />;
  return <EnPrisonGame />;
}
