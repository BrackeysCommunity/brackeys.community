import { cp } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../../default-context";

/** A copy of the game `id` (`src/games/<id>`) at `to`, its tests left out. */
export async function copyGame(id: string, to: string): Promise<void> {
  await cp(join(REPO_ROOT, "src", "games", id), to, {
    recursive: true,
    filter: (src) => !src.split(/[\\/]/).includes("__tests__"),
  });
}
