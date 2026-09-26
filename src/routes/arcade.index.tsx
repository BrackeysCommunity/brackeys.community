import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { useFlagBlocks } from "@/lib/hooks/use-flag";

const arcadeRoute = getRouteApi("/arcade");

export const Route = createFileRoute("/arcade/")({
  component: ArcadeLanding,
});

function ArcadeLanding() {
  const arcadeOff = useFlagBlocks("arcade-enabled");
  const enPrisonBlocked = useFlagBlocks("arcade-en-prison");
  const { enPrison } = arcadeRoute.useLoaderData();
  const enPrisonOff = enPrisonBlocked || !enPrison;
  // Rendered, not thrown — see the note in `arcade.en-prison.tsx`.
  if (arcadeOff) return <NotFoundPage />;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
      <div>
        <MicroLabel>arcade</MicroLabel>
        <Heading as="h1">Games</Heading>
      </div>
      {enPrisonOff ? (
        <Text className="opacity-70">Nothing is open right now.</Text>
      ) : (
        <Link to="/arcade/en-prison" className="rounded-lg border p-4">
          <Heading as="h2" size="xl">
            En Prison
          </Heading>
          <Text className="opacity-70">
            Roulette where the wheel is your build. Real bets, real odds, one bankroll, and a loan
            shark who wants a number by the eighth spin.
          </Text>
          <Text className="mt-2 text-xs opacity-60">
            No real money in, nothing out. Chips are never purchasable.
          </Text>
        </Link>
      )}
    </main>
  );
}
