import { createFileRoute } from "@tanstack/react-router";

import { GameCanvas } from "@/components/game/GameCanvas";

/** `scene` names the project scene `?edit=1` opens, by id. */
type GameSearch = { edit?: 1; scene?: string };

const SCENE_ID = /^[A-Za-z0-9][\w.-]{0,127}$/;

export const Route = createFileRoute("/game/$roomId")({
  staticData: { shell: "takeover" },
  validateSearch: (search: Record<string, unknown>): GameSearch => ({
    ...(search.edit === 1 || search.edit === "1" ? { edit: 1 as const } : {}),
    ...(typeof search.scene === "string" && SCENE_ID.test(search.scene)
      ? { scene: search.scene }
      : {}),
  }),
  ssr: false,
  component: GameRoom,
});

function GameRoom() {
  const { roomId } = Route.useParams();
  const { edit, scene } = Route.useSearch();
  return <GameCanvas roomId={roomId} edit={edit === 1} scene={scene} />;
}
