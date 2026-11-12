// The client-safe half of which hosted games may be shared outside the site;
// `./game.ts` holds the database half. Route heads import this one.
import { engineGamesAllowed } from "@/lib/engine/guard";

export function gamePagePath(projectId: string): string {
  return `/games/${encodeURIComponent(projectId)}`;
}

export function gamePlayPath(projectId: string): string {
  return `${gamePagePath(projectId)}/play`;
}

/** Only public games are shared, and none where this deployment hosts no games. */
export function isShareableVisibility(visibility: string): boolean {
  return engineGamesAllowed() && visibility === "public";
}
