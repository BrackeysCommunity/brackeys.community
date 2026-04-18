import { createFileRoute } from "@tanstack/react-router";

import { GameCanvas } from "@/components/game/GameCanvas";

export const Route = createFileRoute("/game/$roomId")({
  ssr: false,
  component: GameRoom,
});

function GameRoom() {
  const { roomId } = Route.useParams();
  return <GameCanvas roomId={roomId} />;
}
