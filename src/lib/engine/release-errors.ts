import type { SceneIssue } from "@jams/engine/scene";
import { ORPCError } from "@orpc/client";

import { formatCount } from "@/lib/format-bytes";
import { releaseDay } from "@/lib/jam-links";
import { SITE } from "@/lib/legal-meta";

import {
  MIN_HOSTED_ENGINE,
  PROJECT_QUOTA,
  RELEASE_FILE_PUTS_PER_HOUR,
  RELEASE_GRACE_DAYS,
  UPLOAD_SESSION_HOURS,
} from "./limits";

/** The codes only the site's release API answers with; engine codes pass through beside them. */
export const RELEASE_ERROR_CODES = [
  "release-engine-old",
  "release-not-canonical",
  "release-project-mismatch",
  "release-file-type",
  "release-files-missing",
  "release-upload-expired",
  "release-rate-limited",
] as const;

export type ReleaseErrorCode = (typeof RELEASE_ERROR_CODES)[number];

/**
 * The body of every refusal the release API sends, from an oRPC procedure
 * and an HTTP route alike: `message` for people, `hint` for developers
 * (the CLI prints it, the editor shows it under Details), and a quota's
 * `limit`, `used` and `max`. `code` is a site code or an engine issue code.
 */
export type ReleaseApiError = {
  code: string;
  message: string;
  hint?: string;
  limit?: string;
  used?: number;
  max?: number;
};

/** A refusal with the HTTP status it goes out with. */
export class ReleaseError extends Error {
  readonly body: ReleaseApiError;
  readonly status: number;
  constructor(body: ReleaseApiError, status = statusOf(body.code)) {
    super(body.message);
    this.name = "ReleaseError";
    this.body = body;
    this.status = status;
  }
}

const STATUS: Readonly<Record<string, number>> = {
  "release-engine-old": 422,
  "release-not-canonical": 400,
  "release-project-mismatch": 409,
  "release-file-type": 415,
  "release-files-missing": 409,
  "release-upload-expired": 410,
  "release-rate-limited": 429,
  "release-forbidden": 403,
  "release-immutable": 409,
  "quota-exceeded": 413,
};

/** The status a code goes out with; an engine issue from the manifest checks is a 400. */
export function statusOf(code: string): number {
  return STATUS[code] ?? 400;
}

const ORPC_CODE: Readonly<Record<number, string>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "GONE",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "UNPROCESSABLE_CONTENT",
  429: "TOO_MANY_REQUESTS",
};

type Refusal = ReleaseError | ReleaseApiError;

const bodyOf = (err: Refusal): ReleaseApiError => (err instanceof ReleaseError ? err.body : err);

/** The HTTP answer: the error's body as JSON. */
export function apiErrorResponse(err: Refusal, status?: number): Response {
  const body = bodyOf(err);
  const code = status ?? (err instanceof ReleaseError ? err.status : statusOf(body.code));
  return Response.json(body, { status: code });
}

/** The oRPC answer: the same body as the error's `data`, its message as the message. */
export function toOrpcError(err: Refusal, status?: number): ORPCError<string, ReleaseApiError> {
  const body = bodyOf(err);
  const code = status ?? (err instanceof ReleaseError ? err.status : statusOf(body.code));
  return new ORPCError(ORPC_CODE[code] ?? "BAD_REQUEST", {
    status: code,
    message: body.message,
    data: body,
  });
}

/** An engine issue (from `checkReleaseManifest`, say) as the API's error, its code kept. */
export function issueError(issue: SceneIssue): ReleaseApiError {
  return {
    code: issue.code,
    message: issue.message,
    ...(issue.hint !== undefined ? { hint: issue.hint } : {}),
  };
}

// ─── The messages ────────────────────────────────────────

const site = SITE.name;

export function releaseEngineOld(built: string): ReleaseApiError {
  return {
    code: "release-engine-old",
    message: `This build was made with @jams/engine ${built}; ${site} needs ${MIN_HOSTED_ENGINE} or newer.`,
    hint: "Update the engine and build again.",
  };
}

export function releaseNotCanonical(): ReleaseApiError {
  return {
    code: "release-not-canonical",
    message:
      "This release.json isn't the text the engine writes for it, so its release id can't be checked.",
    hint: "Upload the build's own release.json unchanged; build again if it was edited.",
  };
}

export function releaseProjectMismatch(
  field: "project" | "game",
  want: string,
  got: string,
): ReleaseApiError {
  return {
    code: "release-project-mismatch",
    message:
      field === "project"
        ? `This build is of the project "${got}", not "${want}".`
        : `This build plays the game "${got}"; the project "${want}" hosts another game.`,
    hint: "Build from the project's own repository, or upload to the project the build names.",
  };
}

export function releaseFileType(path: string): ReleaseApiError {
  return {
    code: "release-file-type",
    message: `${path} can't be published: ${site} doesn't serve that kind of file.`,
    hint: "Allowed: images (PNG, JPEG, WebP, GIF), audio (Ogg, MP3, WAV, M4A, FLAC, WebM), fonts (WOFF2, WOFF, TTF, OTF), JSON and the build's own code.",
  };
}

export function releaseFilesMissing(missing: number): ReleaseApiError {
  return {
    code: "release-files-missing",
    message: `${formatCount(missing)} ${missing === 1 ? "file of this upload hasn't" : "files of this upload haven't"} arrived yet.`,
    hint: "Send every file the upload listed as missing, then commit again.",
  };
}

export function releaseUploadExpired(): ReleaseApiError {
  return {
    code: "release-upload-expired",
    message: `This upload started more than ${UPLOAD_SESSION_HOURS} hours ago and expired.`,
    hint: "Run the release command again; files already uploaded aren't sent twice.",
  };
}

export function releaseRateLimited(what: "files" | "begins"): ReleaseApiError {
  return what === "files"
    ? {
        code: "release-rate-limited",
        message: `You've uploaded ${formatCount(RELEASE_FILE_PUTS_PER_HOUR)} release files this hour, the most per hour.`,
        hint: "Wait a few minutes and run the release command again; files already uploaded aren't sent twice.",
      }
    : {
        code: "release-rate-limited",
        message: "This project has started too many uploads this hour.",
        hint: "Wait a few minutes, then run the release command again.",
      };
}

export function releaseForbidden(
  why: "agent-production" | "role" | "team-personal",
  playUrl?: string,
): ReleaseApiError {
  switch (why) {
    case "agent-production":
      return {
        code: "release-forbidden",
        message: "Production releases are moved by a person on the game's page.",
        ...(playUrl !== undefined ? { hint: playUrl } : {}),
      };
    case "role":
      return {
        code: "release-forbidden",
        message: "Only the game's publishers can do this.",
        hint: "Publishers are the project's creator and its team's owners.",
      };
    case "team-personal":
      return {
        code: "release-forbidden",
        message: "Only a team's game can be team-only.",
        hint: "Move the project to a team first, or pick another visibility.",
      };
  }
}

/** A hidden release can't be promoted or linked; its reason is the one staff gave. */
export function releaseHidden(version: number, reason: string | null): ReleaseApiError {
  return {
    code: "release-forbidden",
    message: `v${version} is hidden${reason ? `: ${reason}` : "."}`,
    hint: "Hidden releases can't be promoted or linked to a jam until staff unhide them.",
  };
}

export function releaseRemoved(version: number, removedAt: Date): ReleaseApiError {
  return {
    code: "release-immutable",
    message: `v${version} was removed on ${releaseDay(removedAt)}; its files are gone.`,
    hint: `Releases outside the ${PROJECT_QUOTA.releasesKept} newest are removed ${RELEASE_GRACE_DAYS} days after publishing unless pinned.`,
  };
}

export function releaseUnchangeable(): ReleaseApiError {
  return {
    code: "release-immutable",
    message: "A release can't be changed once published.",
    hint: "Publish a new version instead.",
  };
}

/** Runs a release call for an oRPC procedure, its refusals turned into `toOrpcError`'s answer. */
export async function orpcRefusals<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ReleaseError) throw toOrpcError(error);
    throw error;
  }
}
