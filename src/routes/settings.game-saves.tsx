import { createFileRoute } from "@tanstack/react-router";

import { GameSavesPage } from "@/components/settings/GameSaves";
import { pageTitle } from "@/lib/site-meta";

export const Route = createFileRoute("/settings/game-saves")({
  component: GameSavesPage,
  head: () => ({ meta: [{ title: pageTitle("Game saves · Settings") }] }),
});
