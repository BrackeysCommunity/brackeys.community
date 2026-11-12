/**
 * The standalone editor's page: `@jams/engine/editor-ui` mounted on the
 * engine project its dev server serves, the way a game outside jams.team
 * mounts it. Everything the page needs is imported when it
 * mounts.
 */
import { ENGINE_START_SCENE } from "../../src/games/engine-editor";

/** The scene the page opens: the URL's `?scene=`, else the project's start scene. */
const sceneOf = (url: URL): string => url.searchParams.get("scene") || ENGINE_START_SCENE;

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
    // The project names no game: the page and its server judge it by the engine alone.
    game: null,
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
