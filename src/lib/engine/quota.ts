// The quotas a hosted project is held to, and every sentence that states
// them. Relative imports only, so canvas-sync copies it: engine values come
// through an entry's index by path, as `src/lib/scene/` reaches them.
import type {
  ProjectUsage,
  QuotaPolicy,
  QuotaVerdict,
} from "../../../packages/engine/project/index.ts";
import { makeIssue, type SceneIssue } from "../../../packages/engine/scene/index.ts";
import { formatBytes, formatCount } from "../format-bytes.ts";
import { SITE } from "../legal-meta.ts";
import {
  BLOB_GRACE_DAYS,
  LIVE_LIMITS,
  PROJECT_QUOTA,
  QUOTA_WARN_RATIO,
  RELEASE_GRACE_DAYS,
} from "./limits.ts";

export { UNLIMITED_QUOTA } from "../../../packages/engine/project/index.ts";

/**
 * The quotas a hosted project is held to, by their names in `limits.ts`'s
 * `PROJECT_QUOTA`, and the live scene versions' own from `LIVE_LIMITS`.
 */
export type QuotaName =
  | "assetBytes"
  | "docs"
  | "docBytes"
  | "releaseBytes"
  | "releaseFiles"
  | "releaseFileBytes"
  | "releaseStorageBytes"
  | "jamPins"
  | "releasesPerDay"
  | "liveVersionBytes"
  | "liveVersionsPerDay";

/** `PROJECT_QUOTA`'s shape with any numbers, for a staff-raised project. */
export type ProjectQuota = { readonly [K in keyof typeof PROJECT_QUOTA]: number };

export type QuotaOptions = {
  /** A staff-raised project's own numbers, recorded in its audit log; nobody else's change. */
  overrides?: Partial<ProjectQuota>;
};

/**
 * A refusal: the quota by name, `used` as the project holds it now (or the
 * release's own measure, for a per-release quota), `max`, and the sentence
 * for people with the hint for developers.
 */
export type SiteQuotaRefusal = {
  ok: false;
  limit: QuotaName;
  used: number;
  max: number;
  message: string;
  hint: string;
};

export type SiteQuotaVerdict = { ok: true } | SiteQuotaRefusal;

/** The engine's `QuotaPolicy`, whose refusals also carry the hint. */
export type SiteQuotaPolicy = {
  check(usage: ProjectUsage, add: Partial<ProjectUsage>): SiteQuotaVerdict;
};

const quotaOf = (opts?: QuotaOptions): ProjectQuota => ({ ...PROJECT_QUOTA, ...opts?.overrides });

// ─── The words ───────────────────────────────────────────

const site = SITE.name;

const QUOTA_LABELS: Readonly<Record<QuotaName, { label: string; bytes: boolean }>> = {
  assetBytes: { label: "asset storage", bytes: true },
  docs: { label: "documents", bytes: false },
  docBytes: { label: "document storage", bytes: true },
  releaseBytes: { label: "release size", bytes: true },
  releaseFiles: { label: "files in a release", bytes: false },
  releaseFileBytes: { label: "file size", bytes: true },
  releaseStorageBytes: { label: "release storage", bytes: true },
  jamPins: { label: "jam versions", bytes: false },
  releasesPerDay: { label: "releases today", bytes: false },
  liveVersionBytes: { label: "scene version data", bytes: true },
  liveVersionsPerDay: { label: "scene versions today", bytes: false },
};

/** A quota's name in a sentence, lower case: "asset storage", "jam versions". */
export const quotaLabel = (quota: QuotaName): string => QUOTA_LABELS[quota].label;

/** An amount of a quota, as bytes or as a count by what the quota measures. */
export const quotaAmount = (quota: QuotaName, amount: number): string =>
  QUOTA_LABELS[quota].bytes ? formatBytes(amount) : formatCount(amount);

/** The numbers a refusal's sentence names beside `used` and `max`. */
export type QuotaWordsInput =
  | { limit: "assetBytes"; used: number; max: number; adding: number }
  | {
      limit:
        | "docs"
        | "docBytes"
        | "releaseFiles"
        | "jamPins"
        | "releasesPerDay"
        | "liveVersionBytes"
        | "liveVersionsPerDay";
      max: number;
      used: number;
    }
  | {
      limit: "releaseBytes";
      used: number;
      max: number;
      largestFile: { path: string; bytes: number };
      project?: string;
    }
  /** A live scene taking `channel` past a game's size: its release plus every live scene's new files. */
  | { limit: "releaseBytes"; used: number; max: number; channel: string }
  | { limit: "releaseFileBytes"; used: number; max: number; path: string }
  | {
      limit: "releaseStorageBytes";
      used: number;
      max: number;
      adding: number;
      /** What adds the bytes; a release unless given. */
      adds?: "release" | "scene version";
    };

/** A quota refusal's `message` and `hint`, every number formatted from what it is given. */
export function quotaWords(input: QuotaWordsInput): { message: string; hint: string } {
  switch (input.limit) {
    case "assetBytes":
      return {
        message: `This project's asset storage is full: ${formatBytes(input.used)} of ${formatBytes(input.max)} used, and this file is ${formatBytes(input.adding)}.`,
        hint: `Empty the trash or delete assets you don't use. Replaced versions free up ${BLOB_GRACE_DAYS} days after they were replaced.`,
      };
    case "docs":
      return {
        message: `This project already has ${formatCount(input.max)} documents, the most a hosted project can have.`,
        hint: "Delete scenes, prefabs or data you don't use, then empty the trash.",
      };
    case "docBytes":
      return {
        message: `This project's documents use ${formatBytes(input.used)}, the most a hosted project can store.`,
        hint: "Split or trim large scenes and tables, or delete documents you don't use.",
      };
    case "releaseBytes":
      if ("channel" in input)
        return {
          message: `With this scene the game on ${input.channel} would be ${formatBytes(input.used)}; a game on ${site} is limited to ${formatBytes(input.max)}.`,
          hint: "Publish a release instead: it replaces the live scenes, so their extra files stop counting.",
        };
      return {
        message: `This release is ${formatBytes(input.used)}; releases on ${site} are limited to ${formatBytes(input.max)}.`,
        hint: `The largest file is ${input.largestFile.path} (${formatBytes(input.largestFile.bytes)}). Shrink it, or export for itch.io instead: vp run scene game export ${input.project ?? "<project>"} --zip`,
      };
    case "releaseFiles":
      return {
        message: `This release has ${formatCount(input.used)} files; releases on ${site} are limited to ${formatCount(input.max)}.`,
        hint: "Pack small images into an atlas, or merge data tables.",
      };
    case "releaseFileBytes":
      return {
        message: `${input.path} is ${formatBytes(input.used)}; one file in a release is limited to ${formatBytes(input.max)}.`,
        hint: "Compress it (Ogg Vorbis for music) or split it.",
      };
    case "releaseStorageBytes":
      return input.adds === "scene version"
        ? {
            message: `This scene version adds ${formatBytes(input.adding)}, and the project's releases already use ${formatBytes(input.used)} of ${formatBytes(input.max)}.`,
            hint: `Releases outside the ${PROJECT_QUOTA.releasesKept} newest are removed ${RELEASE_GRACE_DAYS} days after publishing unless pinned, and ${LIVE_KEPT_RULE}. Unpin jam versions you no longer need, or wait for the next cleanup.`,
          }
        : {
            message: `This release adds ${formatBytes(input.adding)}, and the project's releases already use ${formatBytes(input.used)} of ${formatBytes(input.max)}.`,
            hint: `Releases outside the ${PROJECT_QUOTA.releasesKept} newest are removed ${RELEASE_GRACE_DAYS} days after publishing unless pinned. Unpin jam versions you no longer need, or wait for the next cleanup.`,
          };
    case "jamPins":
      return {
        message: `This project already pins ${formatCount(input.max)} jam versions, the most it can.`,
        hint: "Unlink a jam version you no longer need on the game's page.",
      };
    case "releasesPerDay":
      return {
        message: `This project has published ${formatCount(input.max)} releases today, the most per day.`,
        hint: "Try again after midnight UTC.",
      };
    case "liveVersionBytes":
      return {
        message: `This scene version is ${formatBytes(input.used)}; a live scene's data is limited to ${formatBytes(input.max)}.`,
        hint: "Split the level into sublevels, or move repeated entities into a prefab or bulk entries.",
      };
    case "liveVersionsPerDay":
      return {
        message: `This project has published ${formatCount(input.max)} scene versions today, the most per day.`,
        hint: "Try again after midnight UTC, or publish a release.",
      };
  }
}

const refuse = (input: QuotaWordsInput): SiteQuotaRefusal => ({
  ok: false,
  limit: input.limit,
  used: input.used,
  max: input.max,
  ...quotaWords(input),
});

/** The notice under the usage lines once any of them is nearly full or full; null while all are ok. */
export function usageNotice(level: UsageLine["level"]): string | null {
  switch (level) {
    case "ok":
      return null;
    case "warn":
      return `Nearly full. Releases outside your ${PROJECT_QUOTA.releasesKept} newest are removed ${RELEASE_GRACE_DAYS} days after publishing unless pinned; unpin jam versions you no longer need.`;
    case "full":
      return "Full. New releases are refused until releases are removed or unpinned.";
  }
}

// ─── The policy ──────────────────────────────────────────

/**
 * The policy every hosted project is held to: asset storage (every stored
 * blob, the trash and replaced versions included) on blob upload, and the
 * document count and bytes when a doc is created. Document bytes are never
 * checked on a store, so a collaborator's edit is never dropped for the
 * project's total.
 */
export function siteQuotaPolicy(opts?: QuotaOptions): SiteQuotaPolicy {
  const quota = quotaOf(opts);
  return {
    check(usage, add) {
      const blobBytes = add.blobBytes ?? 0;
      if (
        (add.blobBytes !== undefined || (add.blobs ?? 0) > 0) &&
        usage.blobBytes + blobBytes > quota.assetBytes
      )
        return refuse({
          limit: "assetBytes",
          used: usage.blobBytes,
          max: quota.assetBytes,
          adding: blobBytes,
        });
      const docs = add.docs ?? 0;
      if (docs > 0 && usage.docs + docs > quota.docs)
        return refuse({ limit: "docs", used: usage.docs, max: quota.docs });
      if (
        (docs > 0 || add.docBytes !== undefined) &&
        usage.docBytes + (add.docBytes ?? 0) > quota.docBytes
      )
        return refuse({ limit: "docBytes", used: usage.docBytes, max: quota.docBytes });
      return { ok: true };
    },
  };
}

/** The policy hosted projects are held to: blob uploads and seeded docs ask it. */
export const ENGINE_QUOTA: QuotaPolicy = siteQuotaPolicy();

/** What `checkReleaseQuota` reads of a project's stored usage. */
export type StoredReleaseUsage = { releaseStorageBytes: number };

export type ReleaseQuotaInput = {
  /** Every file plus `release.json`. */
  totalBytes: number;
  files: number;
  largestFile: { path: string; bytes: number };
  /** What storing the release adds: its files the project doesn't hold yet. */
  addsBytes: number;
  /** Releases the project has published today (UTC), before this one. */
  today: number;
  /** The project id, for the export command a too-large release's hint names. */
  project?: string;
};

/**
 * A release against the per-release quotas (size, file count, largest file),
 * then what it adds to the project's release storage, then the day's count.
 * The first that refuses answers.
 */
export function checkReleaseQuota(
  stored: StoredReleaseUsage,
  release: ReleaseQuotaInput,
  opts?: QuotaOptions,
): SiteQuotaVerdict {
  const quota = quotaOf(opts);
  if (release.totalBytes > quota.releaseBytes)
    return refuse({
      limit: "releaseBytes",
      used: release.totalBytes,
      max: quota.releaseBytes,
      largestFile: release.largestFile,
      ...(release.project !== undefined ? { project: release.project } : {}),
    });
  if (release.files > quota.releaseFiles)
    return refuse({ limit: "releaseFiles", used: release.files, max: quota.releaseFiles });
  if (release.largestFile.bytes > quota.releaseFileBytes)
    return refuse({
      limit: "releaseFileBytes",
      used: release.largestFile.bytes,
      max: quota.releaseFileBytes,
      path: release.largestFile.path,
    });
  if (stored.releaseStorageBytes + release.addsBytes > quota.releaseStorageBytes)
    return refuse({
      limit: "releaseStorageBytes",
      used: stored.releaseStorageBytes,
      max: quota.releaseStorageBytes,
      adding: release.addsBytes,
    });
  if (release.today + 1 > quota.releasesPerDay)
    return refuse({ limit: "releasesPerDay", used: release.today, max: quota.releasesPerDay });
  return { ok: true };
}

/** What `checkLiveQuota` reads of a project's stored usage (`usage.ts`'s `StoredUsage`). */
export type StoredLiveUsage = { releaseStorageBytes: number };

export type LiveQuotaInput = {
  /** `sceneVersionDataBytes`: the version file and every doc it carries (the scene, its prefabs and the docs they use). */
  dataBytes: number;
  /** What storing the version adds: its texts the project doesn't hold yet. */
  addsBytes: number;
  /** Scene versions the project has published today (UTC), before this one; null for one already stored, which adds none. */
  today: number | null;
};

/**
 * A scene version against its data cap, then what it adds to the project's
 * release storage, then the day's count. The first that refuses answers.
 */
export function checkLiveQuota(
  stored: StoredLiveUsage,
  version: LiveQuotaInput,
  opts?: QuotaOptions,
): SiteQuotaVerdict {
  const quota = quotaOf(opts);
  if (version.dataBytes > LIVE_LIMITS.versionDataBytes)
    return refuse({
      limit: "liveVersionBytes",
      used: version.dataBytes,
      max: LIVE_LIMITS.versionDataBytes,
    });
  if (stored.releaseStorageBytes + version.addsBytes > quota.releaseStorageBytes)
    return refuse({
      limit: "releaseStorageBytes",
      used: stored.releaseStorageBytes,
      max: quota.releaseStorageBytes,
      adding: version.addsBytes,
      adds: "scene version",
    });
  if (version.today !== null && version.today + 1 > LIVE_LIMITS.versionsPerDay)
    return refuse({
      limit: "liveVersionsPerDay",
      used: version.today,
      max: LIVE_LIMITS.versionsPerDay,
    });
  return { ok: true };
}

/**
 * A channel's size with its live scenes: `bytes` is its release's
 * `total_bytes` plus every scene pointer's `extra_bytes` once the move is
 * made, held to a release's size.
 */
export function checkLiveChannelQuota(
  channel: string,
  bytes: number,
  opts?: QuotaOptions,
): SiteQuotaVerdict {
  const quota = quotaOf(opts);
  return bytes > quota.releaseBytes
    ? refuse({ limit: "releaseBytes", used: bytes, max: quota.releaseBytes, channel })
    : { ok: true };
}

/** A jam link against the project's pins: one more must fit. */
export function checkJamPinQuota(pinned: number, opts?: QuotaOptions): SiteQuotaVerdict {
  const quota = quotaOf(opts);
  return pinned + 1 > quota.jamPins
    ? refuse({ limit: "jamPins", used: pinned, max: quota.jamPins })
    : { ok: true };
}

// ─── Usage lines ─────────────────────────────────────────

/** One quota as the Usage section and the Publish panel show it. */
export type UsageLine = {
  quota: QuotaName;
  used: number;
  max: number;
  ratio: number;
  level: "ok" | "warn" | "full";
};

/** What `usageLines` reads of a project's stored usage (`usage.ts`'s `StoredUsage`). */
export type StoredUsageCounts = {
  blobBytes: number;
  docs: number;
  docBytes: number;
  releaseStorageBytes: number;
  largestRelease: { version: number; bytes: number } | null;
  pinned: { channels: number; jams: number };
  releasesToday: number;
  /** Scene versions published since midnight UTC. */
  liveToday: number;
};

/** Which scene versions cleanup keeps, as a clause: "each scene keeps its 10 newest versions plus those on a channel". */
export const LIVE_KEPT_RULE = `each scene keeps its ${formatCount(LIVE_LIMITS.keptPerScene)} newest versions plus those on a channel`;

/** "full" once nothing more fits, "warn" from `QUOTA_WARN_RATIO`. */
export function usageLevel(ratio: number): UsageLine["level"] {
  if (ratio >= 1) return "full";
  return ratio >= QUOTA_WARN_RATIO ? "warn" : "ok";
}

const line = (quota: QuotaName, used: number, max: number): UsageLine => {
  const ratio = max > 0 ? used / max : 1;
  return { quota, used, max, ratio, level: usageLevel(ratio) };
};

/**
 * One line per quota a project's stored usage measures: asset storage,
 * documents and their bytes, the largest kept release, release storage,
 * jam pins, today's releases and today's scene versions. The per-file and
 * per-version quotas are checked at upload only.
 */
export function usageLines(stored: StoredUsageCounts, opts?: QuotaOptions): UsageLine[] {
  const quota = quotaOf(opts);
  return [
    line("assetBytes", stored.blobBytes, quota.assetBytes),
    line("docs", stored.docs, quota.docs),
    line("docBytes", stored.docBytes, quota.docBytes),
    line("releaseBytes", stored.largestRelease?.bytes ?? 0, quota.releaseBytes),
    line("releaseStorageBytes", stored.releaseStorageBytes, quota.releaseStorageBytes),
    line("jamPins", stored.pinned.jams, quota.jamPins),
    line("releasesPerDay", stored.releasesToday, quota.releasesPerDay),
    line("liveVersionsPerDay", stored.liveToday, LIVE_LIMITS.versionsPerDay),
  ];
}

// ─── Refusals as answers ─────────────────────────────────

/** What a client gets when the policy refuses: the limit by name, how far over it the request would go, and the words. */
export type QuotaExceeded = {
  code: "quota-exceeded";
  message: string;
  hint?: string;
  limit: string;
  used: number;
  max: number;
  issue: SceneIssue;
};

/** A refusing verdict as the API's body, with the engine issue beside it. */
export function quotaExceeded(
  verdict: Extract<QuotaVerdict, { ok: false }> & { hint?: string },
): QuotaExceeded {
  const hint = verdict.hint;
  return {
    code: "quota-exceeded",
    message: verdict.message,
    ...(hint !== undefined ? { hint } : {}),
    limit: verdict.limit,
    used: verdict.used,
    max: verdict.max,
    issue: makeIssue("quota-exceeded", {
      message: verdict.message,
      expected: `${verdict.limit} ≤ ${verdict.max}`,
      got: String(verdict.used),
      ...(hint !== undefined ? { hint } : {}),
    }),
  };
}

/** The policy's verdict as a refusal, or null when the addition fits. */
export function checkQuota(
  policy: QuotaPolicy,
  usage: ProjectUsage,
  add: Partial<ProjectUsage>,
): QuotaExceeded | null {
  const verdict = policy.check(usage, add);
  return verdict.ok ? null : quotaExceeded(verdict);
}

export function quotaExceededResponse(refusal: QuotaExceeded): Response {
  return Response.json(refusal, { status: 403 });
}
