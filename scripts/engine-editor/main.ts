/**
 * The standalone editor's page: `@jams/engine/editor-ui` mounted on the
 * engine project its dev server serves, the way a game outside jams.team
 * mounts it. This module is also read by the server for `engineEditorGame`,
 * so everything the page needs beyond that is imported when it mounts.
 */
import { defineGame } from "@jams/engine/game";
import { z } from "zod";

/** The scene the editor opens when the URL names none. */
export const DEFAULT_SCENE = "kitchen-sink";

/**
 * The engine project's game: no types, actions or settings of its own, so
 * its scenes hold only the engine's primitives, and the one data table the
 * project's `data/` holds. The server judges the project by it too, so the
 * build stamps both sides write agree.
 */
export const engineEditorGame = defineGame<null>({
  id: "engine-editor",
  types: [],
  actions: [],
  tables: {
    card: {
      description: "Cards a deck holds.",
      row: {
        cost: z.number().int().min(0).describe("What playing it costs."),
        damage: z.number().int().min(0).default(0).describe("What it deals; default 0."),
      },
    },
  },
  createRuntime: () => ({ snapshot: () => null }),
});

const sceneOf = (url: URL): string => url.searchParams.get("scene") || DEFAULT_SCENE;

/** Mounts the editor in `element`; the URL's `?scene=` follows the scene it opens. */
export async function mountEngineEditor(element: HTMLElement) {
  const [hocuspocus, { buildAtFrom }, { devProjectHost, mountSceneEditor }] = await Promise.all([
    import("@hocuspocus/provider"),
    import("@jams/engine/collab"),
    import("@jams/engine/editor-ui"),
    import("@fontsource-variable/rubik"),
    import("@jams/engine/editor-ui/style.css"),
  ]);
  const scene = sceneOf(new URL(location.href));
  document.title = `${scene} · engine editor`;
  return mountSceneEditor(element, {
    host: {
      ...devProjectHost({ hocuspocus, buildAt: buildAtFrom(import.meta.env.VITE_BUILD_AT) }),
      onSceneChange(id) {
        const url = new URL(location.href);
        url.searchParams.set("scene", id);
        history.replaceState(null, "", url);
        document.title = `${id} · engine editor`;
      },
    },
    game: engineEditorGame,
    project: "engine",
    scene,
    rapier: () => import("@dimforge/rapier2d"),
    debug: () => import("@jams/engine/debug").then((m) => ({ overlay: m.createDebugOverlay })),
  });
}

/** Replaces the page's loading line with why the editor couldn't open. */
export function showMountFailure(element: HTMLElement, error: unknown): void {
  console.error("[engine editor] couldn't open", error);
  const line = document.createElement("p");
  line.className = "boot";
  line.dataset.failed = "";
  line.setAttribute("role", "alert");
  const reason = error instanceof Error ? error.message : String(error);
  line.textContent = `The editor couldn't open: ${reason}`;
  element.replaceChildren(line);
}

const root = typeof document === "undefined" ? null : document.getElementById("editor");
if (root) mountEngineEditor(root).catch((error: unknown) => showMountFailure(root, error));
