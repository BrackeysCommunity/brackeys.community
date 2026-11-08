import type { AssetUrl } from "../../index";
import { createKindRegistry, type ProjectId } from "../../project/index";
import type { EditorHost, HocuspocusModule } from "../host";
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

type PageOrigin = Pick<Location, "protocol" | "host">;

const pageOrigin = (origin?: string): PageOrigin | null => {
  if (origin !== undefined) return new URL(origin);
  const loc = (globalThis as { location?: PageOrigin }).location;
  return loc ?? null;
};

/** The dev server's collab socket on `origin` (an `http(s)://` origin), else the page's own. */
export function devCollabUrl(origin?: string | PageOrigin): string {
  const loc = typeof origin === "object" ? origin : pageOrigin(origin);
  if (!loc) throw new Error("The dev server's collab URL needs an origin outside a browser.");
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}${SCENE_COLLAB_PATH}`;
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

/**
 * The dev server's project session and asset route, on the paths `./vite`
 * serves: one Hocuspocus socket for the project doc and every scene and
 * prefab doc it opens, with the project's blob route as its content store
 * and import target. The dev server takes no tokens.
 */
export function devProjectHost(opts: {
  hocuspocus: HocuspocusModule;
  /** Default: same origin, with `./vite`'s collab path and project route. */
  origin?: string;
  /** When the host's build was made; the dev server stamps with the same VITE_BUILD_AT. */
  buildAt?: number;
}): Pick<EditorHost, "connect" | "assetUrl"> {
  const transport = hocuspocusTransport(opts.hocuspocus);
  const base = opts.origin === undefined ? "" : new URL(opts.origin).origin;
  return {
    assetUrl: devAssetUrl(base),
    connect({ project, registry, origin }) {
      const blobs = projectBlobs(devBlobRoute(project, base));
      const link = connectProjectSession({
        project,
        registry,
        kinds: createKindRegistry(registry.game),
        origin,
        store: blobContentStore(blobs),
        transport,
        url: devCollabUrl(opts.origin),
        ...(opts.buildAt !== undefined ? { buildAt: opts.buildAt } : {}),
      });
      return { ...link, blobs };
    },
  };
}
