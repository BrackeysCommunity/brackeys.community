import { createFileRoute } from "@tanstack/react-router";

import { GameDataSection, loadGameDataStatus } from "@/components/settings/GameDataSection";
import { PrivacySection } from "@/components/settings/PrivacySection";
import { pageTitle } from "@/lib/site-meta";

export const Route = createFileRoute("/settings/privacy")({
  loader: () => loadGameDataStatus().catch(() => ({ shown: false })),
  component: PrivacyPage,
  head: () => ({ meta: [{ title: pageTitle("Privacy · Settings") }] }),
});

function PrivacyPage() {
  const gameData = Route.useLoaderData();
  return (
    <>
      <PrivacySection />
      <GameDataSection status={gameData} index="04" />
    </>
  );
}
