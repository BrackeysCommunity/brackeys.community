import type { AssetUrl } from "../../index";
import { createKindRegistry, type ProjectId } from "../../project/index";
import type { EditorHost, HocuspocusModule, SceneHome } from "../host";
import { blobContentStore, projectBlobs } from "./blobs";
import { hocuspocusTransport } from "./hocuspocus";
import { connectProjectSession } from "./project-session";

/**
 * Where `./vite`'s dev server co-edits projects. Mirrors its
 * `SCENE_COLLAB_PATH` and `PROJECT_ROUTE`, from a node entry the browser
 * can't import; `connect-dev.test.ts` keeps them in step.
 */
export const SCENE_COLLAB_PATH = "/__scene-collab";

/** The dev server's project routes, blob uploads among them. */
export const PROJECT_ROUTE = "/__project";

/** The dev server's scene listing (`GET`, every project's scene ids) and each scene's JSON. */
export const SCENE_ROUTE = "/__scene";

type PageOrigin = Pick<Location, "protocol" | "host">;

const pageOrigin = (origin?: string): PageOrigin | null => {
  if (origin !== undefined) return new URL(origin);
  const loc = (globalThis as { location?: PageOrigin }).location;
  return loc ?? null;
};

const isSecure = (protocol: string) => protocol === "https:" || protocol === "wss:";

/** The dev server's collab socket on `origin` (an `http(s)://` or `ws(s)://` origin), else the page's own. */
export function devCollabUrl(origin?: string | PageOrigin): string {
  const loc = typeof origin === "object" ? origin : pageOrigin(origin);
  if (!loc) throw new Error("The dev server's collab URL needs an origin outside a browser.");
  return `${isSecure(loc.protocol) ? "wss" : "ws"}://${loc.host}${SCENE_COLLAB_PATH}`;
}

/** `/__project/<id>/blob`, under `origin` when one is given. */
export function devBlobRoute(project: ProjectId, origin = ""): string {
  return `${origin.replace(/\/$/, "")}${PROJECT_ROUTE}/${encodeURIComponent(project)}/blob`;
}

/** The dev server's project route for an asset loader: `/__project/<id>/blob/<sha256>`. */
export const devAssetUrl =
  (origin = ""): AssetUrl =>
  (project, entry) =>
    `${devBlobRoute(project, origin)}/${entry.sha256}`;

type Fetch = (url: string) => Promise<Pick<Response, "ok" | "json">>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Which of the dev server's projects holds `scene`, by id or by name: the
 * scene's JSON names its game (none for the engine's primitives), and the
 * project listing says which project plays that game. Null when no scene
 * matches, when two projects play the game, or when the server can't say.
 */
export async function findDevScene(
  scene: string,
  opts: { base?: string; fetch?: Fetch } = {},
): Promise<SceneHome | null> {
  const base = opts.base ?? "";
  const get = async (path: string): Promise<unknown> => {
    try {
      const res = await (opts.fetch ?? globalThis.fetch)(`${base}${path}`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  const [listing, served] = await Promise.all([get(SCENE_ROUTE), get(PROJECT_ROUTE)]);
  const ids = isRecord(listing) && Array.isArray(listing.scenes) ? listing.scenes : [];
  const projects = isRecord(served) && Array.isArray(served.projects) ? served.projects : [];
  const read = async (id: string) => {
    const doc = await get(`${SCENE_ROUTE}/${encodeURIComponent(id)}`);
    return isRecord(doc) ? doc : null;
  };
  const candidates = ids.filter((id): id is string => typeof id === "string");
  let found: { id: string; doc: Record<string, unknown> } | null = null;
  if (candidates.includes(scene)) {
    const doc = await read(scene);
    if (doc) found = { id: scene, doc };
  }
  if (!found) {
    // Read together, matched in listing order so the same name always resolves to the same scene.
    const docs = await Promise.all(candidates.map(read));
    const at = docs.findIndex((doc) => doc?.name === scene);
    const doc = docs[at];
    if (doc) found = { id: candidates[at]!, doc };
  }
  if (!found) return null;
  const game = typeof found.doc.game === "string" ? found.doc.game : null;
  const homes = projects.filter(
    (p): p is { id: string } =>
      isRecord(p) && typeof p.id === "string" && (p.game ?? null) === game,
  );
  if (homes.length !== 1) return null;
  const name = typeof found.doc.name === "string" ? found.doc.name : found.id;
  return { project: homes[0]!.id, id: found.id, name };
}

/**
 * The dev server's project session and asset route, on the paths `./vite`
 * serves: one Hocuspocus socket for the project doc and every scene and
 * prefab doc it opens, with the project's blob route as its content store
 * and import target, and its scene listing to say which project holds a
 * scene. The dev server takes no tokens.
 */
export function devProjectHost(opts: {
  hocuspocus: HocuspocusModule;
  /**
   * The dev server's origin when it isn't the page's (`http(s)://` or
   * `ws(s)://`, any path ignored); default the page's own, read when a
   * project connects.
   */
  origin?: string;
  /** When the host's build was made; the dev server stamps with the same VITE_BUILD_AT. */
  buildAt?: number;
}): Pick<EditorHost, "connect" | "assetUrl" | "findScene"> {
  const transport = hocuspocusTransport(opts.hocuspocus);
  const page = opts.origin === undefined ? undefined : new URL(opts.origin);
  // Blobs go over http(s) on the same host, whichever scheme the origin was given in.
  const base = page ? `${isSecure(page.protocol) ? "https" : "http"}://${page.host}` : "";
  const url = page ? devCollabUrl(page) : undefined;
  return {
    assetUrl: devAssetUrl(base),
    findScene: (scene) => findDevScene(scene, { base }),
    connect({ project, registry, origin }) {
      const blobs = projectBlobs(devBlobRoute(project, base));
      const link = connectProjectSession({
        project,
        registry,
        kinds: createKindRegistry(registry.game),
        origin,
        store: blobContentStore(blobs),
        transport,
        url: url ?? devCollabUrl(),
        ...(opts.buildAt !== undefined ? { buildAt: opts.buildAt } : {}),
      });
      return { ...link, blobs };
    },
  };
}
