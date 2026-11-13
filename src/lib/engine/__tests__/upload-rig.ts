import { ORPCError } from "@orpc/client";
import { and, eq } from "drizzle-orm";

import { db as siteDb } from "@/db";
import { engineReleaseChannels } from "@/db/schema";

import {
  beginSceneVersion,
  commitSceneVersion,
  type BeginSceneInput,
  type BeginSceneResult,
} from "../live-upload";
import { promote, type ReleaseChannel } from "../release-channels";
import { ReleaseError, type ReleaseApiError } from "../release-errors";
import type { ReleaseObjectStore } from "../release-storage";
import {
  beginRelease,
  commitRelease,
  putReleaseFile,
  type Actor,
  type ReleaseDeps,
  type ReleaseTxDb,
} from "../release-upload";
import type { FixtureVersion } from "./fixtures/live/scene-versions";
import type { PlannedRelease } from "./release-fixture";

/** Upload deps on the test database that allow every call and skip the media scan; `over` changes any of them. */
export const uploadDeps = (
  store: ReleaseObjectStore,
  over: Partial<ReleaseDeps> = {},
): ReleaseDeps => ({
  db: siteDb as unknown as ReleaseTxDb,
  store,
  rateLimit: async () => true,
  scan: async () => {},
  ...over,
});

/**
 * `planned` uploaded to its project the way the CLI does it (begin, every
 * missing file, commit), then promoted to `promoteTo` when given.
 */
export async function uploadRelease(
  deps: ReleaseDeps,
  planned: PlannedRelease,
  opts: { actor: Actor; channel?: "preview" | "none"; promoteTo?: ReleaseChannel },
) {
  const { actor } = opts;
  const projectId = planned.manifest.project.id;
  const begun = await beginRelease(deps, {
    projectId,
    manifest: planned.text,
    actor,
    ...(opts.channel ? { channel: opts.channel } : {}),
  });
  for (const file of begun.missing) {
    const body = planned.files.get(file.path);
    if (!body) throw new Error(`the planned release has no bytes for "${file.path}"`);
    await putReleaseFile(deps, { uploadId: begun.uploadId, sha256: file.sha256, body, actor });
  }
  const committed = await commitRelease(deps, { uploadId: begun.uploadId, actor });
  if (opts.promoteTo)
    await promote(
      { projectId, version: committed.version, channel: opts.promoteTo, actor },
      { db: deps.db, now: deps.now },
    );
  return committed;
}

/** Sends the texts a scene upload's begin listed as missing. */
export async function putSceneTexts(
  deps: ReleaseDeps,
  v: FixtureVersion,
  begun: Pick<BeginSceneResult, "uploadId" | "missing">,
  actor: Actor,
) {
  for (const { sha256 } of begun.missing) {
    const text = v.texts.get(sha256);
    if (text === undefined) throw new Error(`the fixture version has no text ${sha256}`);
    await putReleaseFile(deps, {
      uploadId: begun.uploadId,
      sha256,
      body: new TextEncoder().encode(text),
      actor,
    });
  }
}

/** `v` uploaded to its project and committed: begin, its missing texts, commit. */
export async function uploadSceneVersion(
  deps: ReleaseDeps,
  v: FixtureVersion,
  opts: Omit<BeginSceneInput, "projectId" | "version">,
) {
  const begun = await beginSceneVersion(deps, {
    projectId: v.version.project,
    version: v.text,
    ...opts,
  });
  await putSceneTexts(deps, v, begun, opts.actor);
  const committed = await commitSceneVersion(deps, { uploadId: begun.uploadId, actor: opts.actor });
  return { begun, committed };
}

/**
 * What a call was refused with: a release refusal's body and status, an oRPC
 * error's release body, or else its oRPC code. Fails when the call went through.
 */
export async function refusal(
  run: () => Promise<unknown>,
): Promise<Partial<ReleaseApiError> & { status?: number }> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ReleaseError) return { ...error.body, status: error.status };
    if (error instanceof ORPCError) {
      const data = error.data as Partial<ReleaseApiError> | undefined;
      return data?.code ? data : { code: error.code };
    }
    throw error;
  }
  throw new Error("the call wasn't refused");
}

/** The project's `live_rev` on `channel`, or undefined before the channel has a row. */
export const liveRev = async (projectId: string, channel: ReleaseChannel) =>
  (
    await siteDb
      .select({ rev: engineReleaseChannels.liveRev })
      .from(engineReleaseChannels)
      .where(
        and(
          eq(engineReleaseChannels.projectId, projectId),
          eq(engineReleaseChannels.channel, channel),
        ),
      )
  )[0]?.rev;
