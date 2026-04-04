import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/game/")({
  component: GameLobby,
});

function GameLobby() {
  return (
    <div className="flex flex-col items-center justify-center gap-8 min-h-[50vh] pointer-events-auto">
      <div className="text-center space-y-3">
        <p className="font-mono text-xs tracking-[0.3em] text-muted-foreground uppercase">
          {"// GAME LOBBY"}
        </p>
        <h1 className="font-mono text-2xl tracking-tight text-foreground">Transformice</h1>
        <p className="font-mono text-sm text-muted-foreground max-w-md">
          A multiplayer platformer where mice work together to bring cheese back to the hole. One
          player is the shaman with special building powers.
        </p>
      </div>

      <div className="flex flex-col gap-3 items-center">
        <Link
          to="/game/$roomId"
          params={{ roomId: "test-room" }}
          className="font-mono text-xs tracking-widest uppercase border border-primary/40 px-6 py-3 hover:bg-primary/10 transition-colors text-primary"
        >
          Enter Test Room →
        </Link>
        <p className="font-mono text-[10px] text-muted-foreground/50">
          Development build — single-player sandbox
        </p>
      </div>
    </div>
  );
}
