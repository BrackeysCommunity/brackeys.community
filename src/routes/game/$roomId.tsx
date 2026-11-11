import { createFileRoute } from "@tanstack/react-router";

import { GameCanvasLoading } from "@/components/game/game-canvas-loading";
import { GameCanvas } from "@/components/game/GameCanvas";

/**
 * `game` names the hosted game the room plays, by project id (default the
 * platformer); `project` names the project `?edit=1` opens, by id, and
 * `scene` its scene, by id or name.
 */
type GameSearch = { game?: string; edit?: 1; project?: string; scene?: string };

const SCENE_ID = /^[A-Za-z0-9][\w.-]{0,127}$/;
// The engine's ID_PATTERN, spelled out: this module loads with every page, the engine with none.
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const Route = createFileRoute("/game/$roomId")({
  staticData: { shell: "takeover" },
  validateSearch: (search: Record<string, unknown>): GameSearch => ({
    ...(typeof search.game === "string" && PROJECT_ID.test(search.game)
      ? { game: search.game }
      : {}),
    ...(search.edit === 1 || search.edit === "1" ? { edit: 1 as const } : {}),
    ...(typeof search.project === "string" && PROJECT_ID.test(search.project)
      ? { project: search.project }
      : {}),
    ...(typeof search.scene === "string" && SCENE_ID.test(search.scene)
      ? { scene: search.scene }
      : {}),
  }),
  ssr: false,
  pendingComponent: GameRoomPending,
  component: GameRoom,
});

function GameRoomPending() {
  const { roomId } = Route.useParams();
  const { edit } = Route.useSearch();
  return <GameCanvasLoading roomId={roomId} edit={edit === 1} />;
}

function GameRoom() {
  const { roomId } = Route.useParams();
  const { game, edit, project, scene } = Route.useSearch();
  return (
    <GameCanvas roomId={roomId} gameId={game} edit={edit === 1} project={project} scene={scene} />
  );
}
