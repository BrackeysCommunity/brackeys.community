import type { PuzzleLayout } from "../api.ts";
import type { Model, Scene, SceneHost } from "./kit.ts";

/**
 * What a party version's scene is given: the family host, for this
 * screen's seat. layout is the seat's dealt part, model the merged model
 * started on it, and move() stamps the seat as well as the ms.
 */
export interface PartySceneHost extends SceneHost {
  readonly seat: number;
  readonly seats: number;
  /** The next seat's dealt part, for a seat whose practice gives the glimpse. */
  readonly glimpse: PuzzleLayout | undefined;
}

/**
 * One puzzles.party row played by several hands on one machine: the merged model of sim/puzzle's
 * PartyRule, and a scene with each seat's gesture.
 */
export interface PartyVersion {
  readonly id: string;
  readonly family: string;
  readonly hintMs?: number;
  /** The merged model on a layout: the whole one, or a seat's dealt part with Unseen in it. */
  start(layout: PuzzleLayout): Model;
  mount(host: PartySceneHost): Scene;
}

// Every folder under src/party is a version; adding one edits nothing here.
const found = import.meta.glob<{ default: PartyVersion }>("../party/*/index.ts", { eager: true });

const versions = new Map<string, PartyVersion>();
for (const [path, mod] of Object.entries(found)) {
  const folder = path.split("/").at(-2)!;
  const version = mod.default;
  if (version.id !== folder)
    throw new Error(`the version in src/party/${folder} names itself ${version.id}`);
  versions.set(version.id, version);
}

export function versionOf(id: string): PartyVersion | undefined {
  return versions.get(id);
}

/** Every registered version id, sorted. */
export function partyRegistered(): string[] {
  return [...versions.keys()].sort();
}
