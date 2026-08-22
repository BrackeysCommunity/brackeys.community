import "@/polyfill";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { collabPosts, projects, teamMembers, teams } from "@/db/schema";
import { canViewReferenceDocs, isReferenceDocsPath } from "@/lib/api-reference-gate";
import { auth } from "@/lib/auth";
import { isActiveBan } from "@/lib/ban-state";
import { bestEffort, captureServerException, withErrorReporting } from "@/lib/posthog-server";
import {
  ProfileProjectImageUploadError,
  removeProfileProjectImageFromStorage,
  uploadImageToStorage,
  uploadProfileProjectImageToStorage,
} from "@/lib/profile-project-image-storage";
import {
  buildCollabPostImageObjectKey,
  buildProjectImageObjectKey,
  buildTeamAvatarObjectKey,
  buildTeamBannerObjectKey,
  buildTeamProjectImageObjectKey,
  isProjectImageKey,
} from "@/lib/profile-project-images";
import { loadProjectForEditor } from "@/lib/project-editors";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportProcedureErrors } from "@/orpc/error-reporting";
import router from "@/orpc/router";

/**
 * One shared bucket for every image-upload surface (profile covers, team
 * avatars/banners, project covers). Anti-runaway, not anti-user.
 */
async function imageUploadAllowed(userId: string): Promise<boolean> {
  return checkRateLimit("image-upload", userId, 50, 86400);
}

/**
 * These handlers sit outside the oRPC middleware chain, so the ban check
 * has to happen here too — a banned session reads as anonymous, matching
 * `authMiddleware`.
 */
async function readUploadSession(request: Request) {
  // Reported before degrading to anonymous: an auth outage would otherwise
  // read as a surge of 401s from logged-out visitors.
  const session = await auth.api.getSession({ headers: request.headers }).catch((err: unknown) => {
    captureServerException(err, { scope: "uploads.session_read" });
    return null;
  });
  if (!session || isActiveBan(session.user)) return null;
  return session;
}

const UPLOAD_LIMIT_RESPONSE = () =>
  Response.json({ message: "Too many uploads today — try again tomorrow." }, { status: 429 });

const handler = new OpenAPIHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
  clientInterceptors: [reportProcedureErrors("openapi")],
  plugins: [
    new SmartCoercionPlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
      specGenerateOptions: {
        info: {
          title: "Brackeys API",
          version: "1.0.0",
        },
        commonSchemas: {
          UndefinedError: { error: "UndefinedError" },
        },
        security: [{ bearerAuth: [] }],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
            },
          },
        },
      },
    }),
  ],
});

async function handle({ request }: { request: Request }) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/profile/project-image") {
    return handleProfileProjectImageUpload(request);
  }
  if (pathname === "/api/team/avatar") {
    return handleTeamAvatarUpload(request);
  }
  if (pathname === "/api/project/image") {
    return handleProjectImageUpload(request);
  }
  if (pathname === "/api/collab/post-image") {
    return handleCollabPostImageUpload(request);
  }
  if (isReferenceDocsPath(pathname) && !(await canViewReferenceDocs(request))) {
    return new Response("Not Found", { status: 404 });
  }

  const { response } = await handler.handle(request, {
    prefix: "/api",
    context: { headers: request.headers },
  });

  return response ?? new Response("Not Found", { status: 404 });
}

async function handleProfileProjectImageUpload(request: Request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const session = await readUploadSession(request);

  if (!session) {
    return Response.json({ message: "Authentication required." }, { status: 401 });
  }
  if (!(await imageUploadAllowed(session.user.id))) {
    return UPLOAD_LIMIT_RESPONSE();
  }

  const formData = await request.formData().catch(() => null);
  const image = formData?.get("image");
  if (!(image instanceof File)) {
    return Response.json(
      { message: 'Expected an image file in the "image" form field.' },
      { status: 400 },
    );
  }

  try {
    const uploadedImage = await uploadProfileProjectImageToStorage({
      file: image,
      userId: session.user.id,
    });

    return Response.json(uploadedImage, { status: 201 });
  } catch (error) {
    if (error instanceof ProfileProjectImageUploadError) {
      return Response.json({ message: error.message }, { status: error.status });
    }

    console.error(error);
    const message =
      error instanceof Error ? error.message : "Failed to upload profile project image.";
    return Response.json({ message }, { status: 500 });
  }
}

/**
 * Team image upload — the wizard's TEAM step and the manage flyout both
 * post here; the `kind` form field picks the target (default `avatar`).
 * The key is team-scoped, so write access is a membership check rather
 * than a key-prefix check: avatar/banner are owner-only and land on the
 * `teams` row (replacing deletes the old object best-effort); `project`
 * is member-level and only mints an object — the key is attached to a
 * showcase row via `addTeamProject`/`updateTeamProject`.
 */
async function handleTeamAvatarUpload(request: Request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const session = await readUploadSession(request);

  if (!session) {
    return Response.json({ message: "Authentication required." }, { status: 401 });
  }
  if (!(await imageUploadAllowed(session.user.id))) {
    return UPLOAD_LIMIT_RESPONSE();
  }

  const formData = await request.formData().catch(() => null);
  const image = formData?.get("image");
  const teamId = formData?.get("teamId");
  const kindField = formData?.get("kind") ?? "avatar";
  if (!(image instanceof File)) {
    return Response.json(
      { message: 'Expected an image file in the "image" form field.' },
      { status: 400 },
    );
  }
  if (typeof teamId !== "string" || !teamId) {
    return Response.json({ message: 'Expected a "teamId" form field.' }, { status: 400 });
  }
  if (kindField !== "avatar" && kindField !== "banner" && kindField !== "project") {
    return Response.json(
      { message: '"kind" must be "avatar", "banner", or "project".' },
      { status: 400 },
    );
  }
  const kind: "avatar" | "banner" | "project" = kindField;

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) {
    return Response.json({ message: "Team not found." }, { status: 404 });
  }
  const [membership] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, session.user.id)))
    .limit(1);
  if (kind === "project" ? !membership : membership?.role !== "owner") {
    return Response.json(
      kind === "project"
        ? { message: "Only team members can upload showcase images." }
        : { message: `Only the team owner can change the ${kind}.` },
      { status: 403 },
    );
  }

  try {
    if (kind === "project") {
      const uploaded = await uploadImageToStorage({
        file: image,
        objectKey: buildTeamProjectImageObjectKey(teamId, image.name),
      });
      return Response.json(uploaded, { status: 201 });
    }

    const uploaded = await uploadImageToStorage({
      file: image,
      objectKey:
        kind === "banner"
          ? buildTeamBannerObjectKey(teamId, image.name)
          : buildTeamAvatarObjectKey(teamId, image.name),
    });

    const previousKey = kind === "banner" ? team.bannerKey : team.avatarKey;
    await db
      .update(teams)
      .set({
        ...(kind === "banner" ? { bannerKey: uploaded.key } : { avatarKey: uploaded.key }),
        updatedAt: new Date(),
      })
      .where(eq(teams.id, teamId));

    if (previousKey && previousKey !== uploaded.key) {
      await bestEffort(
        "storage.image_cleanup",
        { key: previousKey, on: `team_${kind}_upload` },
        () => removeProfileProjectImageFromStorage(previousKey),
      );
    }

    return Response.json(uploaded, { status: 201 });
  } catch (error) {
    if (error instanceof ProfileProjectImageUploadError) {
      return Response.json({ message: error.message }, { status: error.status });
    }

    console.error(error);
    const message = error instanceof Error ? error.message : `Failed to upload team ${kind}.`;
    return Response.json({ message }, { status: 500 });
  }
}

/**
 * A canonical project's cover.
 *
 * The key is **project-scoped** (`project-images/<projectId>/…`), not the
 * uploader's: the per-user namespace is wiped on account deletion, which
 * would blank this cover on every page that renders the project — a profile
 * showcase, a team page, a jam entry card. Write access is therefore the
 * project's editor check (§1.3), the same shape as the team-avatar handler
 * above, and never a key-prefix check.
 *
 * Replacing a cover deletes the old object best-effort, and only when it was
 * one of ours: a legacy row pointing at a user-scoped key must not have that
 * user's object deleted out from under their own placement.
 */
async function handleProjectImageUpload(request: Request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const session = await readUploadSession(request);
  if (!session) {
    return Response.json({ message: "Authentication required." }, { status: 401 });
  }
  if (!(await imageUploadAllowed(session.user.id))) {
    return UPLOAD_LIMIT_RESPONSE();
  }

  const formData = await request.formData().catch(() => null);
  const image = formData?.get("image");
  const projectId = formData?.get("projectId");
  if (!(image instanceof File)) {
    return Response.json(
      { message: 'Expected an image file in the "image" form field.' },
      { status: 400 },
    );
  }
  if (typeof projectId !== "string" || !projectId) {
    return Response.json({ message: 'Expected a "projectId" form field.' }, { status: 400 });
  }

  const loaded = await loadProjectForEditor(projectId, session.user.id);
  if (!loaded) {
    return Response.json({ message: "Project not found." }, { status: 404 });
  }
  if (!loaded.canEdit) {
    return Response.json(
      { message: "Only the people credited on this project can change its cover." },
      { status: 403 },
    );
  }

  try {
    const uploaded = await uploadImageToStorage({
      file: image,
      objectKey: buildProjectImageObjectKey(projectId, image.name),
    });

    await db
      .update(projects)
      .set({ imageKey: uploaded.key, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    const previous = loaded.project.imageKey;
    if (previous && previous !== uploaded.key && isProjectImageKey(projectId, previous)) {
      await bestEffort("storage.image_cleanup", { key: previous, on: "project_cover_upload" }, () =>
        removeProfileProjectImageFromStorage(previous),
      );
    }

    return Response.json(uploaded, { status: 201 });
  } catch (error) {
    if (error instanceof ProfileProjectImageUploadError) {
      return Response.json({ message: error.message }, { status: error.status });
    }

    console.error(error);
    const message = error instanceof Error ? error.message : "Failed to upload project cover.";
    return Response.json({ message }, { status: 500 });
  }
}

/**
 * A collab post's gallery image. The key is **post-scoped**
 * (`collab-post-images/<postId>/…`) so the objects live and die with the
 * post rather than the uploader — `removePostImage`/`deletePost` sweep the
 * namespace, and account deletion (which only clears the uploader's own
 * `profile-projects/` keys) leaves a live post's gallery intact. Author-only,
 * matching `addPostImage`, which is where the returned key gets attached.
 */
async function handleCollabPostImageUpload(request: Request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const session = await readUploadSession(request);
  if (!session) {
    return Response.json({ message: "Authentication required." }, { status: 401 });
  }
  if (!(await imageUploadAllowed(session.user.id))) {
    return UPLOAD_LIMIT_RESPONSE();
  }

  const formData = await request.formData().catch(() => null);
  const image = formData?.get("image");
  const postIdField = formData?.get("postId");
  if (!(image instanceof File)) {
    return Response.json(
      { message: 'Expected an image file in the "image" form field.' },
      { status: 400 },
    );
  }
  const postId = typeof postIdField === "string" ? Number(postIdField) : NaN;
  if (!Number.isInteger(postId)) {
    return Response.json({ message: 'Expected a numeric "postId" form field.' }, { status: 400 });
  }

  const [post] = await db
    .select({ authorId: collabPosts.authorId })
    .from(collabPosts)
    .where(eq(collabPosts.id, postId))
    .limit(1);
  if (!post) {
    return Response.json({ message: "Post not found." }, { status: 404 });
  }
  if (post.authorId !== session.user.id) {
    return Response.json({ message: "Only the post owner can upload images." }, { status: 403 });
  }

  try {
    const uploaded = await uploadImageToStorage({
      file: image,
      objectKey: buildCollabPostImageObjectKey(postId, image.name),
    });

    return Response.json(uploaded, { status: 201 });
  } catch (error) {
    if (error instanceof ProfileProjectImageUploadError) {
      return Response.json({ message: error.message }, { status: error.status });
    }

    console.error(error);
    const message = error instanceof Error ? error.message : "Failed to upload post image.";
    return Response.json({ message }, { status: 500 });
  }
}

/** Reports an unhandled throw before it becomes an opaque 500. */
const reportedHandle = withErrorReporting("/api/$", handle);

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      HEAD: reportedHandle,
      GET: reportedHandle,
      POST: reportedHandle,
      PUT: reportedHandle,
      PATCH: reportedHandle,
      DELETE: reportedHandle,
    },
  },
});
