import { SYNC_LIMITS } from "@/lib/canvas/limits";
import { documentName } from "@/lib/canvas/sync-channels";
import { signCanvasToken, type SyncAccess } from "@/lib/canvas/token";

export type ProjectSyncToken = {
  token: string;
  url: string;
  access: SyncAccess;
  /** Epoch milliseconds. */
  expiresAt: number;
};

/**
 * A project-scoped sync token: it opens `project:<id>` and every scene and
 * asset doc of the project. `agent` marks a token minted for an agent
 * credential, acting for `userId`. Null when live sync isn't configured.
 */
export async function signProjectSyncToken(
  claims: {
    projectId: string;
    userId: string;
    name: string;
    access: SyncAccess;
    formatVersion: number;
    layoutVersion: number;
    agent?: string;
  },
  now: number = Date.now(),
): Promise<ProjectSyncToken | null> {
  const secret = process.env.CANVAS_SYNC_SECRET;
  const url = process.env.CANVAS_SYNC_URL;
  if (!secret || !url) return null;
  const token = await signCanvasToken(
    {
      c: documentName("project", claims.projectId),
      u: claims.userId,
      a: claims.access,
      k: "project",
      s: "project",
      f: claims.formatVersion,
      l: claims.layoutVersion,
      n: claims.name,
      ...(claims.agent !== undefined ? { g: claims.agent, o: claims.userId } : {}),
    },
    secret,
    now,
  );
  return { token, url, access: claims.access, expiresAt: now + SYNC_LIMITS.tokenTtlMs };
}
