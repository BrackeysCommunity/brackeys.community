import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/game/")({
  component: GameLobby,
});

function GameLobby() {
  return (
    <div className="pointer-events-auto flex min-h-[50vh] flex-col items-center justify-center gap-8">
      <div className="space-y-3 text-center">
        <p className="font-mono text-xs tracking-[0.3em] text-muted-foreground uppercase">
          {"// GAME LOBBY"}
        </p>
        <h1 className="font-mono text-2xl tracking-tight text-foreground">Transformice</h1>
        <p className="max-w-md font-mono text-sm text-muted-foreground">
          A multiplayer platformer where mice work together to bring cheese back to the hole. One
          player is the shaman with special building powers.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Link
          to="/game/$roomId"
          params={{ roomId: "test-room" }}
          className="border border-primary/40 px-6 py-3 font-mono text-xs tracking-widest text-primary uppercase transition-colors hover:bg-primary/10"
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
