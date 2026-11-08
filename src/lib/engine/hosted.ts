import type { ContentStore, QuotaPolicy } from "@jams/engine/project";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { engineProjects } from "@/db/schema";
import { publishProjectRevoke } from "@/lib/canvas-sync-publish";
import { bytesToBase64 } from "@/lib/canvas/encoding";

import {
  parseProjectBundle,
  readHostedProject,
  seedHostedProject,
  type BundleOptions,
  type HostedDoc,
  type HostedProjectBundle,
  type SeedHostedProjectResult,
} from "./bundle";
import { minioContentStore } from "./content-store";
import { ENGINE_QUOTA } from "./quota";

export type CreateHostedProjectInput = {
  /** A `ProjectBundle`, as the client sent it. */
  bundle: unknown;
  game?: string | null;
  code?: BundleOptions["code"];
  createdById: string;
  /** The project's content store; its bucket by default. */
  store?: (projectId: string) => ContentStore;
  quota?: QuotaPolicy;
};

/**
 * Seeds a hosted project from a bundle, its blobs read from the project's
 * bucket and its docs counted against the engine quota. A bundle with
 * blobs needs its id reserved and the blobs uploaded first.
 */
export async function createHostedProject(
  input: CreateHostedProjectInput,
): Promise<SeedHostedProjectResult> {
  const parsed = parseProjectBundle(input.bundle);
  if (!parsed.ok) return { ok: false, reason: "invalid", problems: parsed.problems };
  const projectId = parsed.bundle.project.id;
  return seedHostedProject({
    bundle: parsed.bundle,
    store: (input.store ?? minioContentStore)(projectId),
    game: input.game ?? null,
    code: input.code,
    createdById: input.createdById,
    quota: input.quota ?? ENGINE_QUOTA,
  });
}

/**
 * Soft-deletes a hosted project, then closes every socket on its docs. The
 * rows stay (the id stays taken); the service and the site read them as
 * gone. False when there is no live project of that id.
 */
export async function deleteHostedProject(projectId: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .update(engineProjects)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt)))
    .returning({ projectId: engineProjects.projectId });
  if (!row) return false;
  await publishProjectRevoke(projectId);
  return true;
}

/** `HostedProjectBundle` for JSON: Yjs states as base64. */
export type HostedProjectWire = Omit<HostedProjectBundle, "project" | "docs"> & {
  project: string;
  docs: (Omit<HostedDoc, "state"> & { state: string | null })[];
};

export function hostedProjectWire(bundle: HostedProjectBundle): HostedProjectWire {
  return {
    ...bundle,
    project: bytesToBase64(bundle.project),
    docs: bundle.docs.map((doc) => ({
      ...doc,
      state: doc.state ? bytesToBase64(doc.state) : null,
    })),
  };
}

/** A live project's doc states and blob hashes, for `project pull`; null when there is none. */
export async function readHostedProjectWire(projectId: string): Promise<HostedProjectWire | null> {
  const bundle = await readHostedProject(projectId);
  return bundle ? hostedProjectWire(bundle) : null;
}
