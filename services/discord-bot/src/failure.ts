import { DiscordAPIError } from "discord.js";

import { ApiUnavailableError } from "./api.ts";
import { type Embed, embedReply, type Reply } from "./reply.ts";

/**
 * What to say when a command cannot answer. Every failure the bot can hit
 * maps to one of these kinds, and each kind gets its own line: "something
 * went wrong" tells a member nothing about whether to retry, wait, or ask
 * someone. The technical tag rides the footer so a screenshot is enough to
 * act on.
 */

export type FailureKind =
  | "timeout"
  | "unreachable"
  | "unsupported"
  | "throttled"
  | "rejected"
  | "bug";

export interface Failure {
  kind: FailureKind;
  /** Short tag for the footer — `HTTP 404`, `Discord 50035`. */
  code: string;
  /** Discord answered 403. Never retried: those count toward the
   *  invalid-request ban that took sign-in down in July. */
  forbidden?: boolean;
}

/** A muted red; failures should read as a state, not an alarm. */
export const FAILURE_COLOR = 0xc4443f;

export function classifyFailure(error: unknown): Failure {
  if (error instanceof ApiUnavailableError) {
    return error.outcome === "timeout"
      ? { kind: "timeout", code: "timeout" }
      : { kind: "unreachable", code: "unreachable" };
  }
  if (error instanceof DiscordAPIError) {
    return { kind: "bug", code: `Discord ${error.code}`, forbidden: error.status === 403 };
  }
  const status = httpStatus(error);
  if (status === 404) return { kind: "unsupported", code: "HTTP 404" };
  if (status === 429) return { kind: "throttled", code: "HTTP 429" };
  if (status != null && status >= 400 && status < 500) {
    return { kind: "rejected", code: `HTTP ${status}` };
  }
  return { kind: "bug", code: "internal" };
}

/** oRPC throws errors carrying the HTTP status; nothing else here does. */
function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** `brackeys.community` — the site as a member knows it, not the full URL. */
export function siteName(appUrl: string): string {
  try {
    return new URL(appUrl).host.replace(/^www\./, "");
  } catch {
    return appUrl;
  }
}

function copy(kind: FailureKind, site: string): { title: string; body: string } {
  switch (kind) {
    case "timeout":
      return {
        title: "Timed out",
        body: `${site} didn't answer in time — usually a cold start. Run the command again in a few seconds.`,
      };
    case "unreachable":
      return {
        title: "Site unreachable",
        body: `Couldn't reach ${site} just now. Try again in a minute.`,
      };
    case "unsupported":
      return {
        title: "Not available yet",
        body: `This one needs a newer version of ${site} than is currently deployed.`,
      };
    case "throttled":
      return {
        title: "Too many requests",
        body: `${site} is throttling requests right now. Give it a few seconds.`,
      };
    case "rejected":
      return {
        title: "Couldn't do that",
        body: `${site} turned that request down. Check the options and try again.`,
      };
    case "bug":
      return {
        title: "That's a bug on our side",
        body: "The bot couldn't build a reply for that. It's been logged — nothing you did wrong.",
      };
  }
}

export interface FailureOptions {
  appUrl: string;
  /** The command, for the footer: `member`, `collab browse`. */
  label: string;
  /** One extra line when there is something useful to try instead. */
  hint?: string;
}

export function failureEmbed(failure: Failure, options: FailureOptions): Embed {
  const { title, body } = copy(failure.kind, siteName(options.appUrl));
  return {
    title,
    description: options.hint ? `${body}\n\n${options.hint}` : body,
    color: FAILURE_COLOR,
    footer: `${failure.code} · /${options.label}`,
  };
}

/** Always ephemeral: a channel never sees the bot fail on someone's behalf. */
export function failureReply(failure: Failure, options: FailureOptions): Reply {
  return embedReply(failureEmbed(failure, options), { ephemeral: true });
}
