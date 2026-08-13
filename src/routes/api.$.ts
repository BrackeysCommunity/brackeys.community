import "@/polyfill";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { projects, teamMembers, teams } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  ProfileProjectImageUploadError,
  removeProfileProjectImageFromStorage,
  uploadImageToStorage,
  uploadProfileProjectImageToStorage,
} from "@/lib/profile-project-image-storage";
import {
  buildProjectImageObjectKey,
  buildTeamAvatarObjectKey,
  buildTeamBannerObjectKey,
  isProjectImageKey,
} from "@/lib/profile-project-images";
import { loadProjectForEditor } from "@/lib/project-editors";
import router from "@/orpc/router";
import { TodoSchema } from "@/orpc/schema";

const handler = new OpenAPIHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
  plugins: [
    new SmartCoercionPlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
      specGenerateOptions: {
        info: {
          title: "TanStack ORPC Playground",
          version: "1.0.0",
        },
        commonSchemas: {
          Todo: { schema: TodoSchema },
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
      docsConfig: {
        authentication: {
          securitySchemes: {
            bearerAuth: {
              token: "default-token",
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

  const session = await auth.api
    .getSession({
      headers: request.headers,
    })
    .catch(() => null);

  if (!session) {
    return Response.json({ message: "Authentication required." }, { status: 401 });
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
 * Team avatar/banner upload — the wizard's TEAM step and the manage
 * flyout both post here; a `kind` form field of `banner` targets the
 * banner (default `avatar`). Owner-only: the key is team-scoped, so
 * write access is a membership check rather than a key-prefix check.
 * Replacing an image deletes the old object best-effort.
 */
async function handleTeamAvatarUpload(request: Request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const session = await auth.api
    .getSession({
      headers: request.headers,
    })
    .catch(() => null);

  if (!session) {
    return Response.json({ message: "Authentication required." }, { status: 401 });
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
  if (kindField !== "avatar" && kindField !== "banner") {
    return Response.json({ message: '"kind" must be "avatar" or "banner".' }, { status: 400 });
  }
  const kind: "avatar" | "banner" = kindField;

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) {
    return Response.json({ message: "Team not found." }, { status: 404 });
  }
  const [membership] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, session.user.id)))
    .limit(1);
  if (membership?.role !== "owner") {
    return Response.json(
      { message: `Only the team owner can change the ${kind}.` },
      { status: 403 },
    );
  }

  try {
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
      await removeProfileProjectImageFromStorage(previousKey).catch((error: unknown) => {
        console.error(`Failed to delete replaced team ${kind}`, { key: previousKey, error });
      });
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

  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session) {
    return Response.json({ message: "Authentication required." }, { status: 401 });
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
      await removeProfileProjectImageFromStorage(previous).catch((error: unknown) => {
        console.error("Failed to delete replaced project cover", { key: previous, error });
      });
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

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
