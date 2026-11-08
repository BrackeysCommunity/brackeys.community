import { sha256, type Sha256 } from "@jams/engine/project";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { engineAgentTokens } from "@/db/schema";
import type { SyncAccess } from "@/lib/canvas/token";

import { engineProjectsEnabled, isEngineStaff, liveEngineProject } from "./projects";
import { signProjectSyncToken, type ProjectSyncToken } from "./sync-token";

/** Seven days: an agent credential outlives a work session, never a week. */
export const AGENT_TOKEN_MAX_TTL_HOURS = 168;
export const AGENT_TOKEN_MAX_LABEL = 100;
/** Marks the secret as ours for secret scanners and for people pasting it. */
export const AGENT_TOKEN_PREFIX = "jat_";

/** An agent token as staff see it: never the secret, never its hash. */
export type AgentTokenSummary = {
  id: string;
  projectId: string;
  access: SyncAccess;
  label: string;
  createdById: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

const summaryColumns = {
  id: engineAgentTokens.id,
  projectId: engineAgentTokens.projectId,
  access: engineAgentTokens.access,
  label: engineAgentTokens.label,
  createdById: engineAgentTokens.createdById,
  expiresAt: engineAgentTokens.expiresAt,
  revokedAt: engineAgentTokens.revokedAt,
  lastUsedAt: engineAgentTokens.lastUsedAt,
  createdAt: engineAgentTokens.createdAt,
};

const asSummary = (row: Omit<AgentTokenSummary, "access"> & { access: string }) =>
  ({ ...row, access: row.access === "write" ? "write" : "read" }) satisfies AgentTokenSummary;

/** 32 random bytes, base64url, behind the prefix. */
export function generateAgentSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return AGENT_TOKEN_PREFIX + Buffer.from(bytes).toString("base64url");
}

/** What the table stores in place of the secret. */
export function hashAgentSecret(secret: string): Promise<Sha256> {
  return sha256(secret);
}

export class AgentTokenError extends Error {
  constructor(
    readonly code: "not-found" | "bad-input",
    message: string,
  ) {
    super(message);
    this.name = "AgentTokenError";
  }
}

/**
 * Mints a credential for one project. The secret is in the result and
 * nowhere else: the table keeps its SHA-256, so a lost secret is replaced,
 * never recovered.
 */
export async function createAgentToken(
  input: {
    projectId: string;
    createdById: string;
    access: SyncAccess;
    label: string;
    ttlHours: number;
  },
  now: Date = new Date(),
): Promise<{ token: AgentTokenSummary; secret: string }> {
  const label = input.label.trim();
  if (!label || label.length > AGENT_TOKEN_MAX_LABEL) {
    throw new AgentTokenError("bad-input", `A label is 1 to ${AGENT_TOKEN_MAX_LABEL} characters.`);
  }
  if (
    !Number.isInteger(input.ttlHours) ||
    input.ttlHours < 1 ||
    input.ttlHours > AGENT_TOKEN_MAX_TTL_HOURS
  ) {
    throw new AgentTokenError(
      "bad-input",
      `An agent token lasts 1 to ${AGENT_TOKEN_MAX_TTL_HOURS} hours.`,
    );
  }
  if (!(await liveEngineProject(input.projectId))) {
    throw new AgentTokenError("not-found", "No such project.");
  }
  const secret = generateAgentSecret();
  const [row] = await db
    .insert(engineAgentTokens)
    .values({
      projectId: input.projectId,
      createdById: input.createdById,
      access: input.access,
      label,
      tokenSha256: await hashAgentSecret(secret),
      expiresAt: new Date(now.getTime() + input.ttlHours * 3_600_000),
      createdAt: now,
    })
    .returning(summaryColumns);
  if (!row) throw new Error("The agent token wasn't stored.");
  return { token: asSummary(row), secret };
}

/** A project's agent tokens, newest first, revoked and expired ones included. */
export async function listAgentTokens(projectId: string): Promise<AgentTokenSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(engineAgentTokens)
    .where(eq(engineAgentTokens.projectId, projectId))
    .orderBy(desc(engineAgentTokens.createdAt), desc(engineAgentTokens.id));
  return rows.map(asSummary);
}

/** Revokes a token; revoking one twice keeps the first time. Null for an unknown id. */
export async function revokeAgentToken(
  id: string,
  now: Date = new Date(),
): Promise<AgentTokenSummary | null> {
  const [revoked] = await db
    .update(engineAgentTokens)
    .set({ revokedAt: now })
    .where(and(eq(engineAgentTokens.id, id), isNull(engineAgentTokens.revokedAt)))
    .returning(summaryColumns);
  if (revoked) return asSummary(revoked);
  const [existing] = await db
    .select(summaryColumns)
    .from(engineAgentTokens)
    .where(eq(engineAgentTokens.id, id));
  return existing ? asSummary(existing) : null;
}

export type AgentExchangeRefusal = {
  ok: false;
  status: 401 | 403 | 404 | 429 | 503;
  message: string;
};

export type AgentExchange =
  | ({ ok: true; projectId: string; agentId: string } & ProjectSyncToken)
  | AgentExchangeRefusal;

const UNKNOWN: AgentExchangeRefusal = {
  ok: false,
  status: 401,
  message: "That agent token isn't valid.",
};

/** The live token a secret names, or why it isn't one. */
export async function findAgentToken(
  secret: string,
  now: Date = new Date(),
): Promise<
  { ok: true; token: AgentTokenSummary } | { ok: false; reason: "unknown" | "revoked" | "expired" }
> {
  if (!secret.startsWith(AGENT_TOKEN_PREFIX) || secret.length > 256) {
    return { ok: false, reason: "unknown" };
  }
  const [row] = await db
    .select(summaryColumns)
    .from(engineAgentTokens)
    .where(eq(engineAgentTokens.tokenSha256, await hashAgentSecret(secret)));
  if (!row) return { ok: false, reason: "unknown" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, token: asSummary(row) };
}

/**
 * The live token a secret names, checked as every agent call needs: not
 * revoked or expired, its project live, its creator still staff with the
 * flag on. `allowed` rate-limits per token, before the other checks.
 */
export async function authorizeAgentToken(
  secret: string,
  opts: { now?: Date; allowed?: (tokenId: string) => Promise<boolean> } = {},
): Promise<{ ok: true; token: AgentTokenSummary } | AgentExchangeRefusal> {
  const found = await findAgentToken(secret, opts.now ?? new Date());
  if (!found.ok) {
    return found.reason === "unknown"
      ? UNKNOWN
      : { ok: false, status: 401, message: `That agent token is ${found.reason}.` };
  }
  const { token } = found;
  if (opts.allowed && !(await opts.allowed(token.id))) {
    return {
      ok: false,
      status: 429,
      message: "Too many sync tokens for this agent token; slow down.",
    };
  }
  if (!(await isEngineStaff(token.createdById))) {
    return { ok: false, status: 403, message: "The token's creator no longer has staff access." };
  }
  if (!(await engineProjectsEnabled(token.createdById))) {
    return { ok: false, status: 404, message: "Not found." };
  }
  if (!(await liveEngineProject(token.projectId))) {
    return { ok: false, status: 404, message: "No such project." };
  }
  return { ok: true, token };
}

/**
 * Trades an agent secret for a 60 s project sync token that acts for the
 * token's creator (`o`) as the agent (`g`, the token's id), with the
 * token's access; refused as `authorizeAgentToken` refuses.
 */
export async function exchangeAgentToken(
  secret: string,
  versions: { formatVersion: number; layoutVersion: number },
  opts: { now?: Date; allowed?: (tokenId: string) => Promise<boolean> } = {},
): Promise<AgentExchange> {
  const now = opts.now ?? new Date();
  const authorized = await authorizeAgentToken(secret, { now, allowed: opts.allowed });
  if (!authorized.ok) return authorized;
  const { token } = authorized;
  const minted = await signProjectSyncToken(
    {
      projectId: token.projectId,
      userId: token.createdById,
      name: token.label,
      access: token.access,
      formatVersion: versions.formatVersion,
      layoutVersion: versions.layoutVersion,
      agent: token.id,
    },
    now.getTime(),
  );
  if (!minted) return { ok: false, status: 503, message: "Live projects aren't set up here." };
  await db
    .update(engineAgentTokens)
    .set({ lastUsedAt: now })
    .where(eq(engineAgentTokens.id, token.id));
  return { ok: true, projectId: token.projectId, agentId: token.id, ...minted };
}
