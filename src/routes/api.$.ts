import "@/polyfill";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { teamMembers, teams } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  ProfileProjectImageUploadError,
  removeProfileProjectImageFromStorage,
  uploadImageToStorage,
  uploadProfileProjectImageToStorage,
} from "@/lib/profile-project-image-storage";
import { buildTeamAvatarObjectKey } from "@/lib/profile-project-images";
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
 * Team avatar upload — the wizard's TEAM step and the manage flyout
 * both post here. Owner-only: the key is team-scoped, so write access
 * is a membership check rather than a key-prefix check. Replacing an
 * avatar deletes the old object best-effort.
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
  if (!(image instanceof File)) {
    return Response.json(
      { message: 'Expected an image file in the "image" form field.' },
      { status: 400 },
    );
  }
  if (typeof teamId !== "string" || !teamId) {
    return Response.json({ message: 'Expected a "teamId" form field.' }, { status: 400 });
  }

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
      { message: "Only the team owner can change the avatar." },
      { status: 403 },
    );
  }

  try {
    const uploaded = await uploadImageToStorage({
      file: image,
      objectKey: buildTeamAvatarObjectKey(teamId, image.name),
    });

    await db
      .update(teams)
      .set({ avatarKey: uploaded.key, updatedAt: new Date() })
      .where(eq(teams.id, teamId));

    if (team.avatarKey && team.avatarKey !== uploaded.key) {
      await removeProfileProjectImageFromStorage(team.avatarKey).catch((error: unknown) => {
        console.error("Failed to delete replaced team avatar", { key: team.avatarKey, error });
      });
    }

    return Response.json(uploaded, { status: 201 });
  } catch (error) {
    if (error instanceof ProfileProjectImageUploadError) {
      return Response.json({ message: error.message }, { status: error.status });
    }

    console.error(error);
    const message = error instanceof Error ? error.message : "Failed to upload team avatar.";
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
