import {
  UNLIMITED_QUOTA,
  type ProjectUsage,
  type QuotaPolicy,
  type QuotaVerdict,
} from "@jams/engine/project";
import { makeIssue, type SceneIssue } from "@jams/engine/scene";
import { count, eq, sum } from "drizzle-orm";

import { db } from "@/db";
import { engineAssetDocs, engineBlobs, sceneDocs } from "@/db/schema";

export { UNLIMITED_QUOTA };

/**
 * The policy hosted projects are held to: blob uploads and seeded docs ask
 * it. Unlimited until the storage numbers are set.
 */
export const ENGINE_QUOTA: QuotaPolicy = UNLIMITED_QUOTA;

/** What a client gets when the policy refuses: the limit by name, and how far over it the request would go. */
export type QuotaExceeded = {
  code: "quota-exceeded";
  message: string;
  limit: string;
  used: number;
  max: number;
  issue: SceneIssue;
};

/**
 * What a hosted project stores, from its rows: every scene and asset doc's
 * state and every blob it holds. The site has no registry view here, so
 * `trashBytes` (what emptying the trash would free) is 0; trashed docs and
 * blobs still count in the totals, since they are still stored.
 */
export async function storedProjectUsage(projectId: string): Promise<ProjectUsage> {
  const [[assets], [scenes], [blobs]] = await Promise.all([
    db
      .select({ n: count(), bytes: sum(engineAssetDocs.byteSize) })
      .from(engineAssetDocs)
      .where(eq(engineAssetDocs.projectId, projectId)),
    db
      .select({ n: count(), bytes: sum(sceneDocs.byteSize) })
      .from(sceneDocs)
      .where(eq(sceneDocs.projectId, projectId)),
    db
      .select({ n: count(), bytes: sum(engineBlobs.byteSize) })
      .from(engineBlobs)
      .where(eq(engineBlobs.projectId, projectId)),
  ]);
  return {
    docs: (assets?.n ?? 0) + (scenes?.n ?? 0),
    docBytes: Number(assets?.bytes ?? 0) + Number(scenes?.bytes ?? 0),
    blobs: blobs?.n ?? 0,
    blobBytes: Number(blobs?.bytes ?? 0),
    trashBytes: 0,
  };
}

/** The policy's verdict as a refusal, or null when the addition fits. */
export function checkQuota(
  policy: QuotaPolicy,
  usage: ProjectUsage,
  add: Partial<ProjectUsage>,
): QuotaExceeded | null {
  const verdict: QuotaVerdict = policy.check(usage, add);
  if (verdict.ok) return null;
  return {
    code: "quota-exceeded",
    message: verdict.message,
    limit: verdict.limit,
    used: verdict.used,
    max: verdict.max,
    issue: makeIssue("quota-exceeded", {
      message: verdict.message,
      expected: `${verdict.limit} ≤ ${verdict.max}`,
      got: String(verdict.used),
    }),
  };
}

export function quotaExceededResponse(refusal: QuotaExceeded): Response {
  return Response.json(refusal, { status: 403 });
}
