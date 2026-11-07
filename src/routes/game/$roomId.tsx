import { createFileRoute } from "@tanstack/react-router";

import { GameCanvas } from "@/components/game/GameCanvas";

type GameSearch = { edit?: 1 };

export const Route = createFileRoute("/game/$roomId")({
  validateSearch: (search: Record<string, unknown>): GameSearch =>
    search.edit === 1 || search.edit === "1" ? { edit: 1 } : {},
  ssr: false,
  component: GameRoom,
});

function GameRoom() {
  const { roomId } = Route.useParams();
  const { edit } = Route.useSearch();
  return <GameCanvas roomId={roomId} edit={edit === 1} />;
}
