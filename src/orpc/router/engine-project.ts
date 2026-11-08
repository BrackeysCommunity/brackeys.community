import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import * as z from "zod";

import { publishProjectRevoke } from "@/lib/canvas-sync-publish";
import {
  AGENT_TOKEN_MAX_LABEL,
  AGENT_TOKEN_MAX_TTL_HOURS,
  AgentTokenError,
  createAgentToken as mintAgentToken,
  listAgentTokens as readAgentTokens,
  revokeAgentToken as markAgentTokenRevoked,
} from "@/lib/engine/agent-token";
import { reserveHostedProject as reserveProjectId } from "@/lib/engine/bundle";
import {
  createHostedProject as seedFromBundle,
  deleteHostedProject as softDeleteProject,
  readHostedProjectWire,
  type CreateHostedProjectInput,
} from "@/lib/engine/hosted";
import { engineProjectsEnabled, isEngineProjectId, liveEngineProject } from "@/lib/engine/projects";
import { signProjectSyncToken } from "@/lib/engine/sync-token";
import { requireStaff } from "@/orpc/middleware/auth";

/**
 * Hosted engine projects, co-edited through `canvas-sync` as `project:<id>`
 * and the project's scene and asset docs. Staff only, like hosted scenes,
 * and behind the `engine-projects` flag, which every procedure enforces.
 */
const engineStaff = os.use(requireStaff).use(async ({ context, next }) => {
  if (!(await engineProjectsEnabled(context.user.id))) {
    throw new ORPCError("NOT_FOUND", { message: "Not found." });
  }
  return next();
});

const projectIdSchema = z
  .string()
  .refine(isEngineProjectId, "A project id is lowercase letters, digits and dashes.");

const NO_PROJECT = () => new ORPCError("NOT_FOUND", { message: "No such project." });

/**
 * A 60 s token for the whole project. `formatVersion` is the scene format
 * the caller's engine reads and `layoutVersion` its collab layout; the
 * service opens docs on another version read-only.
 */
export const getProjectSyncToken = engineStaff
  .input(
    z.object({
      projectId: projectIdSchema,
      formatVersion: z.number().int().min(1),
      layoutVersion: z.number().int().min(1),
      access: z.enum(["read", "write"]).default("write"),
    }),
  )
  .handler(async ({ context, input }) => {
    if (!(await liveEngineProject(input.projectId))) throw NO_PROJECT();
    const minted = await signProjectSyncToken({
      projectId: input.projectId,
      userId: context.user.id,
      name: context.user.name || "Member",
      access: input.access,
      formatVersion: input.formatVersion,
      layoutVersion: input.layoutVersion,
    });
    if (!minted) {
      throw new ORPCError("PRECONDITION_FAILED", { message: "Live projects aren't set up here." });
    }
    return { token: minted.token, url: minted.url, access: minted.access };
  });

/** A credential an agent exchanges for sync tokens. The secret is in this answer and never again. */
export const createAgentToken = engineStaff
  .input(
    z.object({
      projectId: projectIdSchema,
      access: z.enum(["read", "write"]),
      label: z.string().trim().min(1).max(AGENT_TOKEN_MAX_LABEL),
      ttlHours: z.number().int().min(1).max(AGENT_TOKEN_MAX_TTL_HOURS),
    }),
  )
  .handler(async ({ context, input }) => {
    try {
      const { token, secret } = await mintAgentToken({ ...input, createdById: context.user.id });
      return { ...token, secret };
    } catch (error) {
      if (error instanceof AgentTokenError) {
        throw error.code === "not-found"
          ? NO_PROJECT()
          : new ORPCError("BAD_REQUEST", { message: error.message });
      }
      throw error;
    }
  });

/**
 * Revokes an agent token, then closes its creator's sockets on the project:
 * an agent's open connection outlives its 60 s sync token, and the
 * creator's own tabs reconnect on their own.
 */
export const revokeAgentToken = engineStaff
  .input(z.object({ id: z.uuid() }))
  .handler(async ({ input }) => {
    const token = await markAgentTokenRevoked(input.id);
    if (!token) throw new ORPCError("NOT_FOUND", { message: "No such agent token." });
    await publishProjectRevoke(token.projectId, token.createdById);
    return token;
  });

export const listAgentTokens = engineStaff
  .input(z.object({ projectId: projectIdSchema }))
  .handler(async ({ input }) => {
    if (!(await liveEngineProject(input.projectId))) throw NO_PROJECT();
    return readAgentTokens(input.projectId);
  });

/**
 * Holds a free id with an empty project so a push can upload its blobs
 * before `createHostedProject` seeds it; refuses an id that exists.
 */
export const createEmptyHostedProject = engineStaff
  .input(z.object({ projectId: projectIdSchema, name: z.string().trim().min(1).max(100) }))
  .handler(async ({ context, input }) => {
    const reserved = await reserveProjectId({ ...input, createdById: context.user.id });
    if (!reserved.ok) {
      throw new ORPCError("CONFLICT", { message: `Project ${input.projectId} already exists.` });
    }
    return { projectId: input.projectId };
  });

/**
 * Seeds a new project from a `ProjectBundle`, every doc laid out by the
 * server. Refuses an id that holds a project; a bundle with blobs needs a
 * reserved id with its blobs uploaded. `game` names the game whose
 * registry judges it and `code` is its code map, as the pushing client
 * read them from the game.
 */
export const createHostedProject = engineStaff
  .input(
    z.object({
      bundle: z.unknown(),
      game: projectIdSchema.nullable().optional(),
      code: z.record(z.string(), z.unknown()).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const result = await seedFromBundle({
      bundle: input.bundle,
      game: input.game,
      code: input.code as CreateHostedProjectInput["code"],
      createdById: context.user.id,
    });
    if (result.ok) {
      return { projectId: result.projectId, docs: result.docs, warnings: result.warnings };
    }
    if (result.reason === "exists") {
      throw new ORPCError("CONFLICT", { message: "That project already exists." });
    }
    if (result.reason === "quota-exceeded") {
      throw new ORPCError("FORBIDDEN", { message: result.refusal.message, data: result.refusal });
    }
    throw new ORPCError("BAD_REQUEST", {
      message: "The bundle can't be hosted as it is.",
      data: { problems: result.problems },
    });
  });

/** Soft-deletes a project and closes everyone's sockets on its docs; the id stays taken. */
export const deleteHostedProject = engineStaff
  .input(z.object({ projectId: projectIdSchema }))
  .handler(async ({ input }) => {
    if (!(await softDeleteProject(input.projectId))) throw NO_PROJECT();
    return { projectId: input.projectId };
  });

/** Every doc state (base64) and blob hash of a project, for `project pull`. */
export const getProjectBundle = engineStaff
  .input(z.object({ projectId: projectIdSchema }))
  .handler(async ({ input }) => {
    const wire = await readHostedProjectWire(input.projectId);
    if (!wire) throw NO_PROJECT();
    return wire;
  });
