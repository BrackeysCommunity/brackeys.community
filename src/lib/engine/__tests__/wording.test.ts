// @vitest-environment jsdom
// Every number a person reads about hosted games is the formatted value of
// a constant: the README's hosting sections, the terms, the privacy
// notice's game paragraphs, the editor's publish wording, the save menu's
// sentences, the save notice, Settings → Game saves, the live levels copy
// (README, editor, play page, CLI) and every quota, release and save message. A number that isn't one fails here, and so does a constant no
// sentence states. A limit changes by one edit in `limits.ts` (or the
// engine's constants) plus the copy this suite points at.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ITCH_LIMITS, DEFAULT_EXPORT_BUDGET } from "@jams/engine/export";
import {
  DEFAULT_SAVE_LIMITS,
  LIVE_CHECK_AGAIN_TICKS,
  LIVE_DEFAULTS,
  MAX_BROWSER_SAVE_LIMITS,
  parseSaveFile,
  SLOT_MAX_LENGTH,
} from "@jams/engine/game";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { StoredUsage } from "@/lib/engine/usage";
import { formatBytes, formatCount } from "@/lib/format-bytes";
import { CONTACT, SITE } from "@/lib/legal-meta";

import * as LIMITS from "../limits";
import * as QUOTA from "../quota";
import * as ERRORS from "../release-errors";

vi.mock("@/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/env")>()),
  env: { VITE_DEPLOY_ENV: "staging" },
}));

vi.mock("@tanstack/react-router", () => {
  const Link = ({ to, children, ...rest }: { to: string; children?: unknown }) =>
    createElement("a", { href: to, ...rest }, children as never);
  return { Link, createLink: () => Link };
});

const { HOST_NO_SITE_SAVES_MESSAGE, HOST_THROTTLED_MESSAGE } = await import("../host-server");
const { prefsRefusal, SIGNED_IN_SAVES_DESCRIBE, SIGNED_OUT_SAVES_DESCRIBE, siteSaveRefusal } =
  await import("../local-saves");
const { emptyTrashConfirm, publishWording, removalText, USAGE_FOOTER, usageView } =
  await import("@/components/game/publish-host");
const { liveBlockedText, liveRemovalText, liveUsageText, liveWording } =
  await import("../editor-live-host");
const { sceneVersionRemoved } = await import("../live-pointers");
const { TermsDocument } = await import("@/components/legal/TermsDocument");
const GAME_SETTINGS = await import("../game-settings");
const SHOWCASE = await import("../engine-showcase");
const { GAME_SAVES_SETTINGS_RULE } = await import("@/components/settings/GameSaves");
const SAVE_API = await import("../save-api");
const { SAVE_FAILED_MESSAGE, SAVE_UNREACHABLE_MESSAGE } = await import("../save-store");
const { connectsToSentence, PREFS_SENTENCE, savesSentence } =
  await import("@/components/games/SaveNotice");
const { PrivacyDocument } = await import("@/components/legal/PrivacyDocument");
const { LIVE_REMOVED_NOTICE, LIVE_SWAP_TOAST, liveReleaseToast } =
  await import("@/components/games/PlayFrame");
const { blockedSceneLine, LiveLevelsLine } = await import("@/components/games/VersionList");

const ROOT = resolve(import.meta.dirname, "../../../..");
const readRepo = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

const b = formatBytes;
const n = formatCount;
/** itch.io states MB in decimal, as `ITCH_LIMITS` reads them. */
const decimalMb = (bytes: number): string => `${bytes / 1_000_000} MB`;
const percent = (ratio: number): string => `${n(ratio * 100)}%`;

// ─── The constants ───────────────────────────────────────

type Kind = "bytes" | "count" | "days" | "hours" | "percent" | "version";

/** A constant as copy writes it: its kind and its formatted text, the number token alone. */
type Constant = { kind: Kind; text: string };

const bytesOf = (v: number): Constant => ({ kind: "bytes", text: b(v) });
const countOf = (v: number): Constant => ({ kind: "count", text: n(v) });
const daysOf = (v: number): Constant => ({ kind: "days", text: n(v) });
const hoursOf = (v: number): Constant => ({ kind: "hours", text: n(v) });
const percentOf = (ratio: number): Constant => ({ kind: "percent", text: percent(ratio) });

/** Every leaf of `limits.ts`, by its path; the suite fails when one is missing here. */
const SITE_CONSTANTS: Record<string, Constant> = {
  "SITE_SAVE_LIMITS.maxBytes": bytesOf(LIMITS.SITE_SAVE_LIMITS.maxBytes),
  "SITE_SAVE_LIMITS.maxSlots": countOf(LIMITS.SITE_SAVE_LIMITS.maxSlots),
  SITE_SAVE_ACCOUNT_BYTES: bytesOf(LIMITS.SITE_SAVE_ACCOUNT_BYTES),
  SITE_SAVE_EXPIRY_DAYS: daysOf(LIMITS.SITE_SAVE_EXPIRY_DAYS),
  SAVE_WRITES_PER_HOUR: countOf(LIMITS.SAVE_WRITES_PER_HOUR),
  SAVE_READS_PER_HOUR: countOf(LIMITS.SAVE_READS_PER_HOUR),
  PREFS_MAX_BYTES: bytesOf(LIMITS.PREFS_MAX_BYTES),
  "PROJECT_QUOTA.assetBytes": bytesOf(LIMITS.PROJECT_QUOTA.assetBytes),
  "PROJECT_QUOTA.docs": countOf(LIMITS.PROJECT_QUOTA.docs),
  "PROJECT_QUOTA.docBytes": bytesOf(LIMITS.PROJECT_QUOTA.docBytes),
  "PROJECT_QUOTA.releaseBytes": bytesOf(LIMITS.PROJECT_QUOTA.releaseBytes),
  "PROJECT_QUOTA.releaseFiles": countOf(LIMITS.PROJECT_QUOTA.releaseFiles),
  "PROJECT_QUOTA.releaseFileBytes": bytesOf(LIMITS.PROJECT_QUOTA.releaseFileBytes),
  "PROJECT_QUOTA.releaseStorageBytes": bytesOf(LIMITS.PROJECT_QUOTA.releaseStorageBytes),
  "PROJECT_QUOTA.releasesKept": countOf(LIMITS.PROJECT_QUOTA.releasesKept),
  "PROJECT_QUOTA.jamPins": countOf(LIMITS.PROJECT_QUOTA.jamPins),
  "PROJECT_QUOTA.releasesPerDay": countOf(LIMITS.PROJECT_QUOTA.releasesPerDay),
  QUOTA_WARN_RATIO: percentOf(LIMITS.QUOTA_WARN_RATIO),
  RELEASE_GRACE_DAYS: daysOf(LIMITS.RELEASE_GRACE_DAYS),
  BLOB_GRACE_DAYS: daysOf(LIMITS.BLOB_GRACE_DAYS),
  ORPHAN_FILE_GRACE_HOURS: hoursOf(LIMITS.ORPHAN_FILE_GRACE_HOURS),
  UPLOAD_SESSION_HOURS: hoursOf(LIMITS.UPLOAD_SESSION_HOURS),
  PROJECT_PURGE_DAYS: daysOf(LIMITS.PROJECT_PURGE_DAYS),
  FRAME_TOKEN_HOURS: hoursOf(LIMITS.FRAME_TOKEN_HOURS),
  MIN_HOSTED_ENGINE: { kind: "version", text: LIMITS.MIN_HOSTED_ENGINE },
  CONNECT_ORIGINS_MAX: countOf(LIMITS.CONNECT_ORIGINS_MAX),
  RELEASE_FILE_PUTS_PER_HOUR: countOf(LIMITS.RELEASE_FILE_PUTS_PER_HOUR),
  RELEASE_BEGINS_PER_HOUR: countOf(LIMITS.RELEASE_BEGINS_PER_HOUR),
  GAME_REPORTS_PER_DAY: countOf(LIMITS.GAME_REPORTS_PER_DAY),
  RELEASE_MANIFEST_MAX_BYTES: bytesOf(LIMITS.RELEASE_MANIFEST_MAX_BYTES),
  HOST_SAVE_REQUESTS_PER_SECOND: countOf(LIMITS.HOST_SAVE_REQUESTS_PER_SECOND),
  HOST_PREFS_WRITES_PER_SECOND: countOf(LIMITS.HOST_PREFS_WRITES_PER_SECOND),
  HOST_DOWNLOAD_INTERVAL_SECONDS: countOf(LIMITS.HOST_DOWNLOAD_INTERVAL_SECONDS),
  HOST_LIVE_STATES_PER_SECOND: countOf(LIMITS.HOST_LIVE_STATES_PER_SECOND),
  "LIVE_LIMITS.versionDataBytes": bytesOf(LIMITS.LIVE_LIMITS.versionDataBytes),
  "LIVE_LIMITS.versionsPerDay": countOf(LIMITS.LIVE_LIMITS.versionsPerDay),
  "LIVE_LIMITS.keptPerScene": countOf(LIMITS.LIVE_LIMITS.keptPerScene),
  "LIVE_LIMITS.noteChars": countOf(LIMITS.LIVE_LIMITS.noteChars),
  "LIVE_LIMITS.beginsPerHour": countOf(LIMITS.LIVE_LIMITS.beginsPerHour),
  LIVE_POLL_SECONDS: countOf(LIMITS.LIVE_POLL_SECONDS),
  LIVE_STREAM_MINUTES: countOf(LIMITS.LIVE_STREAM_MINUTES),
  "LIVE_BLOCK.players": countOf(LIMITS.LIVE_BLOCK.players),
  "LIVE_BLOCK.ratio": percentOf(LIMITS.LIVE_BLOCK.ratio),
  "LIVE_BLOCK.windowMinutes": countOf(LIMITS.LIVE_BLOCK.windowMinutes),
  LIVE_CRASH_WINDOW_SECONDS: countOf(LIMITS.LIVE_CRASH_WINDOW_SECONDS),
  LIVE_REPORTS_PER_HOUR: countOf(LIMITS.LIVE_REPORTS_PER_HOUR),
  LIVE_REPORT_RETENTION_DAYS: daysOf(LIMITS.LIVE_REPORT_RETENTION_DAYS),
};

const ENGINE_CONSTANTS: Record<string, Constant> = {
  "DEFAULT_SAVE_LIMITS.maxBytes": bytesOf(DEFAULT_SAVE_LIMITS.maxBytes),
  "DEFAULT_SAVE_LIMITS.maxSlots": countOf(DEFAULT_SAVE_LIMITS.maxSlots),
  "MAX_BROWSER_SAVE_LIMITS.maxBytes": bytesOf(MAX_BROWSER_SAVE_LIMITS.maxBytes),
  "MAX_BROWSER_SAVE_LIMITS.maxSlots": countOf(MAX_BROWSER_SAVE_LIMITS.maxSlots),
  "DEFAULT_EXPORT_BUDGET.codeBytes": bytesOf(DEFAULT_EXPORT_BUDGET.codeBytes),
  "DEFAULT_EXPORT_BUDGET.firstLoadBytes": bytesOf(DEFAULT_EXPORT_BUDGET.firstLoadBytes),
  "DEFAULT_EXPORT_BUDGET.totalBytes": bytesOf(DEFAULT_EXPORT_BUDGET.totalBytes),
  "DEFAULT_EXPORT_BUDGET.fileBytes": bytesOf(DEFAULT_EXPORT_BUDGET.fileBytes),
  "ITCH_LIMITS.maxFiles": countOf(ITCH_LIMITS.maxFiles),
  "ITCH_LIMITS.maxTotalBytes": { kind: "bytes", text: decimalMb(ITCH_LIMITS.maxTotalBytes) },
  "ITCH_LIMITS.maxFileBytes": { kind: "bytes", text: decimalMb(ITCH_LIMITS.maxFileBytes) },
  SLOT_MAX_LENGTH: countOf(SLOT_MAX_LENGTH),
  "LIVE_DEFAULTS.preloadTimeoutMs": countOf(LIVE_DEFAULTS.preloadTimeoutMs / 1000),
  "LIVE_DEFAULTS.livePlayDebounceMs": countOf(LIVE_DEFAULTS.livePlayDebounceMs),
  ...Object.fromEntries(
    LIVE_DEFAULTS.checkAt.map((at, i) => [`LIVE_DEFAULTS.checkAt.${i}`, percentOf(at)]),
  ),
  "LIVE_DEFAULTS.checkTicks": countOf(LIVE_DEFAULTS.checkTicks),
  LIVE_CHECK_AGAIN_TICKS: countOf(LIVE_CHECK_AGAIN_TICKS),
};

/** Every number `save-api.ts` exports; the suite fails when one is missing here. */
const SAVE_API_CONSTANTS: Record<string, Constant> = {
  SAVE_TITLE_MAX: countOf(SAVE_API.SAVE_TITLE_MAX),
};

const CONSTANTS: Record<string, Constant> = {
  ...SITE_CONSTANTS,
  ...ENGINE_CONSTANTS,
  ...SAVE_API_CONSTANTS,
};

/**
 * Site constants no sentence states, each with why. Rate refusals say
 * "very often" or "too many this hour" on purpose: the numbers are a
 * defence against abuse, not a promise people plan around.
 */
const UNSTATED: Record<string, string> = {
  SAVE_WRITES_PER_HOUR: "a rate defence; its refusal says the player is saving very often",
  SAVE_READS_PER_HOUR: "a rate defence; its refusal says the player is saving very often",
  RELEASE_BEGINS_PER_HOUR: "a rate defence; its refusal says too many uploads this hour",
  ORPHAN_FILE_GRACE_HOURS: "cleans up files no release lists, nothing a person published",
  RELEASE_MANIFEST_MAX_BYTES: "a request guard; the release size is the stated limit",
  HOST_SAVE_REQUESTS_PER_SECOND: "a rate defence; its refusal says too many save requests",
  HOST_PREFS_WRITES_PER_SECOND: "a rate defence against a frame flooding the page",
  HOST_DOWNLOAD_INTERVAL_SECONDS: "a rate defence against a frame flooding the page",
  HOST_LIVE_STATES_PER_SECOND: "a rate defence against a frame flooding the page",
  LIVE_REPORTS_PER_HOUR: "a rate defence; reports over it are dropped without a word",
};

/** Engine constants the hosting copy must state; the export budget is stated in README §Budgets. */
const ENGINE_STATED = [
  "DEFAULT_SAVE_LIMITS.maxBytes",
  "DEFAULT_SAVE_LIMITS.maxSlots",
  "MAX_BROWSER_SAVE_LIMITS.maxBytes",
  "MAX_BROWSER_SAVE_LIMITS.maxSlots",
  "ITCH_LIMITS.maxFiles",
  "ITCH_LIMITS.maxTotalBytes",
  "ITCH_LIMITS.maxFileBytes",
  "SLOT_MAX_LENGTH",
  "LIVE_DEFAULTS.preloadTimeoutMs",
  "LIVE_DEFAULTS.livePlayDebounceMs",
  ...LIVE_DEFAULTS.checkAt.map((_, i) => `LIVE_DEFAULTS.checkAt.${i}`),
  "LIVE_DEFAULTS.checkTicks",
  "LIVE_CHECK_AGAIN_TICKS",
];

// ─── Numbers in text ─────────────────────────────────────

type Token = { kind: Kind; text: string; raw: string };

// A number not glued to a word, path, version or id (`v7`, `SHA-256`, `WOFF2`, `@jams`), with its unit.
const NUMBER =
  /(?<![\w.@/#-])(\d+\.\d+\.\d+|\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?(?:KB|MB|B)\b|%|\s(?:days?|hours?)\b)?/g;

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const num = m[1] ?? "";
    const unit = (m[2] ?? "").trim();
    const raw = m[0];
    if (/^\d+\.\d+\.\d+$/.test(num)) out.push({ kind: "version", text: num, raw });
    else if (unit === "%") out.push({ kind: "percent", text: `${num}%`, raw });
    else if (unit.startsWith("day")) out.push({ kind: "days", text: num, raw });
    else if (unit.startsWith("hour")) out.push({ kind: "hours", text: num, raw });
    else if (unit) out.push({ kind: "bytes", text: `${num} ${unit}`, raw });
    else out.push({ kind: "count", text: num, raw });
  }
  return out;
}

const tidy = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Markdown as read: no table pipes or rules, emphasis or code marks. */
const plainMarkdown = (md: string): string =>
  tidy(
    md
      .split("\n")
      .filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line))
      .join("\n")
      .replace(/^#+\s.*$/gm, "")
      .replace(/[|`]/g, " ")
      .replace(/\*\*/g, ""),
  );

/**
 * One text people read. `given` are the example inputs a message was
 * rendered with (sizes, counts, dates); `prose` are exact phrases whose
 * numbers aren't limits.
 */
type Source = { name: string; text: string; given?: readonly string[]; prose?: readonly string[] };

/** Every way an example input can appear: as a size and as a count. */
const givenOf = (...values: number[]): string[] => values.flatMap((v) => [b(v), n(v)]);

const ALLOWED = new Set(Object.values(CONSTANTS).map((c) => `${c.kind}:${c.text}`));

/** Each number in a source that is neither a constant's formatted value nor an example input. */
function straysIn(source: Source): string[] {
  let text = source.text;
  for (const phrase of source.prose ?? []) text = text.replace(phrase, " ");
  const given = new Set(source.given ?? []);
  return tokens(text)
    .filter((t) => !ALLOWED.has(`${t.kind}:${t.text}`) && !given.has(t.text))
    .map((t) => `${source.name}: "${t.raw}"`);
}

// ─── The sources ─────────────────────────────────────────

const README = readRepo("packages/engine/README.md");

function readmeSection(heading: string, until?: string): string {
  const start = README.indexOf(`\n${heading}\n`);
  expect(start, `README has ${heading}`).toBeGreaterThanOrEqual(0);
  const body = README.slice(start + heading.length + 2);
  const level = heading.match(/^#+/)?.[0] ?? "##";
  const next = body.search(new RegExp(`^#{1,${level.length}}\\s`, "m"));
  const section = next === -1 ? body : body.slice(0, next);
  if (until === undefined) return section;
  const cut = section.indexOf(until);
  expect(cut, `README ${heading} has "${until}"`).toBeGreaterThan(0);
  return section.slice(0, cut);
}

function readmeParagraph(opening: string): string {
  const at = README.indexOf(`\n${opening}`);
  expect(at, `README has the paragraph "${opening}"`).toBeGreaterThanOrEqual(0);
  const end = README.indexOf("\n\n", at + 1);
  return README.slice(at, end === -1 ? undefined : end);
}

const MB = 1_048_576;
const KB = 1_024;
const DATE = new Date("2026-12-03T10:00:00Z");
const DATE_GIVEN = ["3", "2026"];

const SAMPLE_USAGE: StoredUsage = {
  blobBytes: 41 * MB,
  liveBlobBytes: 30 * MB,
  trashBytes: 6 * MB,
  trashAssets: 12,
  historyBytes: 5 * MB,
  docs: 212,
  docBytes: 3.1 * MB,
  releases: 9,
  keptReleases: 6,
  pinned: { channels: 2, jams: 1 },
  releaseStorageBytes: 120 * MB,
  largestRelease: { version: 7, bytes: 38 * MB },
  releasesToday: 3,
  liveVersions: { kept: 12, bytes: 409_600 },
  liveToday: 6,
  nextCollection: [],
};

const Q = LIMITS.PROJECT_QUOTA;

/** Every quota a refusal can name, with example inputs at the shipped maxima. */
const QUOTA_INPUTS: QUOTA.QuotaWordsInput[] = [
  { limit: "assetBytes", used: 251 * MB, max: Q.assetBytes, adding: 12 * MB },
  { limit: "docs", used: Q.docs, max: Q.docs },
  { limit: "docBytes", used: Q.docBytes, max: Q.docBytes },
  {
    limit: "releaseBytes",
    used: 131 * MB,
    max: Q.releaseBytes,
    largestFile: { path: "assets/theme.ogg", bytes: 88 * MB },
    project: "tactics",
  },
  { limit: "releaseFiles", used: 2_412, max: Q.releaseFiles },
  { limit: "releaseFileBytes", used: 48 * MB, max: Q.releaseFileBytes, path: "assets/theme.ogg" },
  { limit: "releaseStorageBytes", used: 498 * MB, max: Q.releaseStorageBytes, adding: 30 * MB },
  { limit: "jamPins", used: Q.jamPins, max: Q.jamPins },
  { limit: "releasesPerDay", used: Q.releasesPerDay, max: Q.releasesPerDay },
  { limit: "liveVersionBytes", used: 2.4 * MB, max: LIMITS.LIVE_LIMITS.versionDataBytes },
  {
    limit: "liveVersionsPerDay",
    used: LIMITS.LIVE_LIMITS.versionsPerDay,
    max: LIMITS.LIVE_LIMITS.versionsPerDay,
  },
  { limit: "releaseBytes", used: 104 * MB, max: Q.releaseBytes, channel: "production" },
  {
    limit: "releaseStorageBytes",
    used: 498 * MB,
    max: Q.releaseStorageBytes,
    adding: 30 * MB,
    adds: "scene version",
  },
];

const QUOTA_GIVEN = givenOf(
  251 * MB,
  12 * MB,
  131 * MB,
  88 * MB,
  2_412,
  48 * MB,
  498 * MB,
  30 * MB,
  2.4 * MB,
  104 * MB,
);

/** Every message `release-errors.ts` writes, by its function's name. */
const RELEASE_MESSAGES: Record<string, () => ERRORS.ReleaseApiError[]> = {
  releaseEngineOld: () => [ERRORS.releaseEngineOld("0.14.0")],
  releaseNotCanonical: () => [ERRORS.releaseNotCanonical()],
  releaseProjectMismatch: () => [
    ERRORS.releaseProjectMismatch("project", "tactics", "lanes"),
    ERRORS.releaseProjectMismatch("game", "tactics", "lanes"),
  ],
  releaseFileType: () => [ERRORS.releaseFileType("assets/x.svg")],
  releaseFilesMissing: () => [ERRORS.releaseFilesMissing(1), ERRORS.releaseFilesMissing(3)],
  releaseUploadExpired: () => [ERRORS.releaseUploadExpired()],
  releaseRateLimited: () => [
    ERRORS.releaseRateLimited("files"),
    ERRORS.releaseRateLimited("begins"),
  ],
  releaseForbidden: () => [
    ERRORS.releaseForbidden("agent-production", "https://example.test/games/tactics/play"),
    ERRORS.releaseForbidden("role"),
    ERRORS.releaseForbidden("team-personal"),
  ],
  releaseHidden: () => [
    ERRORS.releaseHidden(2, "Breaks the rules."),
    ERRORS.releaseHidden(2, null),
  ],
  releaseRemoved: () => [ERRORS.releaseRemoved(2, DATE)],
  releaseUnchangeable: () => [ERRORS.releaseUnchangeable()],
};

/** Every `game-settings-invalid` message `game-settings.ts` writes, by its function's name. */
const GAME_SETTINGS_MESSAGES: Record<string, () => ERRORS.ReleaseApiError[]> = {
  connectOriginsTooMany: () => [
    GAME_SETTINGS.connectOriginsTooMany(LIMITS.CONNECT_ORIGINS_MAX + 1),
  ],
  connectOriginInvalid: () => [GAME_SETTINGS.connectOriginInvalid("http://api.example.com/v")],
  connectOriginIsSite: () => [GAME_SETTINGS.connectOriginIsSite(`https://${SITE.domain}`)],
  ownSavesNeedOrigin: () => [GAME_SETTINGS.ownSavesNeedOrigin()],
};

/** What `game-settings.ts` exports besides its messages. */
const GAME_SETTINGS_RULES = ["checkConnectOrigins", "readGameSettings", "setGameSettings"];

/** Every message `engine-showcase.ts` writes, by its function's name. */
const SHOWCASE_MESSAGES: Record<string, () => ERRORS.ReleaseApiError[]> = {
  showcaseNotFound: () => [SHOWCASE.showcaseNotFound("lanes")],
  showcaseNotEditable: () => [SHOWCASE.showcaseNotEditable("Lanes")],
  showcaseTaken: () => [SHOWCASE.showcaseTaken("Lanes")],
  showcaseAlreadyLinked: () => [SHOWCASE.showcaseAlreadyLinked("Lanes")],
};

const notASave = parseSaveFile("{}");
const NOT_A_SAVE_ISSUE = notASave.ok ? undefined : notASave.issues[0];

/** Every message `save-api.ts` writes, by its function's name. */
const SAVE_API_MESSAGES: Record<string, () => ERRORS.ReleaseApiError[]> = {
  saveSignedOut: () => [SAVE_API.saveSignedOut()],
  saveNotSite: () => [SAVE_API.saveNotSite()],
  saveUnplayable: () => [SAVE_API.saveUnplayable()],
  saveWritesRateLimited: () => [SAVE_API.saveWritesRateLimited()],
  saveReadsRateLimited: () => [SAVE_API.saveReadsRateLimited()],
  saveAccountFull: () => [SAVE_API.saveAccountFull(LIMITS.SITE_SAVE_ACCOUNT_BYTES - 20 * KB)],
  saveNotASaveFile: () => (NOT_A_SAVE_ISSUE ? [SAVE_API.saveNotASaveFile(NOT_A_SAVE_ISSUE)] : []),
  saveOtherGame: () => [SAVE_API.saveOtherGame("tactics", "lanes")],
  saveOtherSlot: () => [SAVE_API.saveOtherSlot("slot-a", "slot-b")],
  saveBadSlot: () => [SAVE_API.saveBadSlot("Slot A")],
  saveTitleTooLong: () => [SAVE_API.saveTitleTooLong(SAVE_API.SAVE_TITLE_MAX + 1)],
};

/** What `save-api.ts` exports besides its messages. */
const SAVE_API_RULES = ["saveAccess", "saveWriteBucket"];

const words = (m: { message: string; hint?: string }): string =>
  [m.message, m.hint ?? ""].join(" ");

let terms = "";
let privacy = "";
let liveLevels = "";

beforeAll(() => {
  const { container } = render(createElement(TermsDocument));
  const section = container.querySelector("section#games");
  expect(section, "the terms' games section renders with the guard on").not.toBeNull();
  terms = tidy([...section!.querySelectorAll("p")].map((p) => p.textContent ?? "").join("\n"));

  const notice = render(createElement(PrivacyDocument)).container;
  const games = [...notice.querySelectorAll("[data-engine-games]")];
  expect(games.length, "the privacy notice's game paragraphs render with the guard on").toBe(8);
  privacy = tidy(games.map((el) => el.textContent ?? "").join("\n"));

  const since = new Date(Date.now() - 12.5 * 60_000).toISOString();
  const row = render(
    createElement(LiveLevelsLine, {
      scenes: [{ scene: "ford", title: "The ford", number: 4, since }],
    }),
  ).container;
  liveLevels = tidy(row.textContent ?? "");
});

afterAll(cleanup);

async function sources(): Promise<Source[]> {
  const wording = publishWording("tactics" as never, "Lanes");
  const live = liveWording();
  const usage = usageView({ usage: SAMPLE_USAGE, lines: QUOTA.usageLines(SAMPLE_USAGE) }, [
    "production",
    "preview",
  ]);
  const tooBig = await siteSaveRefusal(
    { slot: "a", text: "x".repeat(LIMITS.SITE_SAVE_LIMITS.maxBytes + 9 * KB) },
    async () => [],
  );
  const tooMany = await siteSaveRefusal({ slot: "new", text: "{}" }, async () =>
    Array.from({ length: LIMITS.SITE_SAVE_LIMITS.maxSlots }, (_, i) => `s${i}`),
  );
  // Two bytes short: the JSON quotes make it exactly 2 KB over.
  const prefs = prefsRefusal("x".repeat(LIMITS.PREFS_MAX_BYTES + 2 * KB - 2));
  expect(tooBig && tooMany && prefs).toBeTruthy();

  return [
    {
      name: "README §Saves",
      text: plainMarkdown(readmeSection("## Saves", "A save is a `save:v1` file")),
      prose: [
        // An illustration of a small save, not a limit.
        "a progress save is usually under 1 KB",
        // The unit the sizes count in.
        "Sizes in this README count in 1,024s: a KB is 1,024 bytes and an MB is 1,024 KB.",
      ],
    },
    {
      name: "README §Publishing on jams.team",
      text: plainMarkdown(readmeSection(`## Publishing on ${SITE.name}`)),
    },
    {
      name: "README §Live levels",
      text: plainMarkdown(readmeSection("## Live levels", "```text")),
      // The status line's example, not a limit.
      prose: ["Live update applied: 1 entity changed"],
    },
    {
      name: "README §Export's itch.io line",
      text: plainMarkdown(readmeParagraph("itch.io takes at most")),
    },
    { name: "the terms' games section", text: terms },
    {
      name: "the publish wording",
      text: tidy(
        [
          wording.noRelease,
          wording.token,
          ...Object.values(wording.visibility),
          ...Object.values(wording.saveModes),
          wording.connectsTo,
          wording.privateLinks,
          USAGE_FOOTER,
        ].join("\n"),
      ),
    },
    {
      name: "the usage rows",
      text: tidy(
        [
          ...usage.lines.flatMap((l) => [l.text, l.detail ?? ""]),
          usage.trash?.confirm ?? "",
          usage.footer,
          emptyTrashConfirm(1, 512 * KB),
          removalText(2, DATE),
        ].join("\n"),
      ),
      given: [
        ...givenOf(
          41 * MB,
          30 * MB,
          6 * MB,
          12,
          5 * MB,
          212,
          3.1 * MB,
          6,
          120 * MB,
          38 * MB,
          3,
          1,
          512 * KB,
          409_600,
        ),
        ...DATE_GIVEN,
      ],
    },
    {
      name: "the live scenes wording",
      text: tidy(
        [
          live.notePlaceholder,
          live.data(200 * KB),
          live.today(4),
          live.stopConfirm({ release: 8, scene: "The ford", timing: "next-load" }),
          liveUsageText(SAMPLE_USAGE.liveVersions),
          liveRemovalText("ford" as never, 5, DATE),
          liveBlockedText({ by: "system", reason: null }, { ok: 9, failed: 3 }),
          liveBlockedText({ by: "user", reason: "Softlock at the bridge" }, { ok: 0, failed: 0 }),
          words(sceneVersionRemoved("level-1@3", DATE)),
        ].join("\n"),
      ),
      given: [...givenOf(200 * KB, 4, 8, 409_600, 12, 5, 3), ...DATE_GIVEN],
    },
    {
      name: "the play page and the game page",
      text: tidy(
        [
          LIVE_SWAP_TOAST,
          liveReleaseToast("Lanes"),
          LIVE_REMOVED_NOTICE,
          liveLevels,
          blockedSceneLine({
            title: "The ford",
            reason: liveBlockedText({ by: "system", reason: null }, { ok: 9, failed: 3 }),
          }),
          blockedSceneLine({ title: "The ford", reason: null }),
        ].join("\n"),
      ),
      given: givenOf(12, 3),
    },
    {
      name: "the save menu and the host's refusals",
      text: tidy(
        [
          SIGNED_OUT_SAVES_DESCRIBE,
          HOST_NO_SITE_SAVES_MESSAGE,
          HOST_THROTTLED_MESSAGE,
          words(tooBig!),
          words(tooMany!),
          words(prefs!),
        ].join("\n"),
      ),
      given: givenOf(LIMITS.SITE_SAVE_LIMITS.maxBytes + 9 * KB, LIMITS.PREFS_MAX_BYTES + 2 * KB),
    },
    { name: "the privacy notice's game paragraphs", text: privacy },
    {
      name: "the signed-in save menu",
      text: tidy(
        [SIGNED_IN_SAVES_DESCRIBE, SAVE_UNREACHABLE_MESSAGE, SAVE_FAILED_MESSAGE].join("\n"),
      ),
    },
    {
      name: "the save notice",
      text: tidy(
        [
          savesSentence("own", ["https://saves.example.com"], false),
          savesSentence("none", [], false),
          PREFS_SENTENCE,
          connectsToSentence(["https://saves.example.com"]) ?? "",
        ].join("\n"),
      ),
    },
    { name: "Settings → Game saves", text: tidy(GAME_SAVES_SETTINGS_RULE) },
    {
      name: "quota.ts's messages",
      text: tidy(
        [
          ...QUOTA_INPUTS.map((input) => words(QUOTA.quotaWords(input))),
          QUOTA.usageNotice("warn") ?? "",
          QUOTA.usageNotice("full") ?? "",
        ].join("\n"),
      ),
      given: QUOTA_GIVEN,
    },
    {
      name: "release-errors.ts's messages",
      text: tidy(
        Object.values(RELEASE_MESSAGES)
          .flatMap((make) => make())
          .map(words)
          .join("\n"),
      ),
      given: ["0.14.0", "1", "3", ...DATE_GIVEN],
    },
    {
      name: "game-settings.ts's messages",
      text: tidy(
        Object.values(GAME_SETTINGS_MESSAGES)
          .flatMap((make) => make())
          .map(words)
          .join("\n"),
      ),
      given: givenOf(LIMITS.CONNECT_ORIGINS_MAX + 1),
    },
    {
      name: "save-api.ts's messages",
      text: tidy(
        Object.values(SAVE_API_MESSAGES)
          .flatMap((make) => make())
          .map(words)
          .join("\n"),
      ),
      given: givenOf(SAVE_API.SAVE_TITLE_MAX + 1),
      // A slot name's shortest length, which no constant holds.
      prose: ["digits and dashes, 1–"],
    },
    {
      name: "engine-showcase.ts's messages",
      text: tidy(
        Object.values(SHOWCASE_MESSAGES)
          .flatMap((make) => make())
          .map(words)
          .join("\n"),
      ),
    },
  ];
}

// ─── The statements ──────────────────────────────────────

const C = (key: string): string => {
  const c = CONSTANTS[key];
  if (!c) throw new Error(`no constant ${key}`);
  return c.text;
};

/** Where each constant is said, as the phrase that says it, by source name. */
const STATEMENTS: { states: string[]; source: string; phrase: string }[] = [
  // README §Saves
  {
    states: ["DEFAULT_SAVE_LIMITS.maxBytes", "DEFAULT_SAVE_LIMITS.maxSlots"],
    source: "README §Saves",
    phrase: `Engine default (any store) ${C("DEFAULT_SAVE_LIMITS.maxBytes")} ${C("DEFAULT_SAVE_LIMITS.maxSlots")}`,
  },
  {
    states: ["MAX_BROWSER_SAVE_LIMITS.maxBytes", "MAX_BROWSER_SAVE_LIMITS.maxSlots"],
    source: "README §Saves",
    phrase: `The browser (raised by a game) up to ${C("MAX_BROWSER_SAVE_LIMITS.maxBytes")} up to ${C("MAX_BROWSER_SAVE_LIMITS.maxSlots")}`,
  },
  {
    states: [
      "SITE_SAVE_LIMITS.maxBytes",
      "SITE_SAVE_LIMITS.maxSlots",
      "SITE_SAVE_EXPIRY_DAYS",
      "SITE_SAVE_ACCOUNT_BYTES",
    ],
    source: "README §Saves",
    phrase: `${SITE.name}, signed in ${C("SITE_SAVE_LIMITS.maxBytes")} ${C("SITE_SAVE_LIMITS.maxSlots")} ${C("SITE_SAVE_EXPIRY_DAYS")} days after last use; ${C("SITE_SAVE_ACCOUNT_BYTES")} per player across games`,
  },
  {
    states: ["SITE_SAVE_LIMITS.maxBytes", "SITE_SAVE_LIMITS.maxSlots"],
    source: "README §Saves",
    phrase: `${SITE.name}, signed out ${C("SITE_SAVE_LIMITS.maxBytes")} ${C("SITE_SAVE_LIMITS.maxSlots")} in that browser`,
  },
  {
    states: ["SITE_SAVE_LIMITS.maxBytes"],
    source: "README §Saves",
    phrase: `on ${SITE.name} a save over ${C("SITE_SAVE_LIMITS.maxBytes")} is refused with save-too-large`,
  },
  // README §Publishing on jams.team
  {
    states: [
      "PROJECT_QUOTA.releaseBytes",
      "PROJECT_QUOTA.releaseFiles",
      "PROJECT_QUOTA.releaseFileBytes",
    ],
    source: "README §Publishing on jams.team",
    phrase: `Release size ${C("PROJECT_QUOTA.releaseBytes")}, ${C("PROJECT_QUOTA.releaseFiles")} files, ${C("PROJECT_QUOTA.releaseFileBytes")} per file`,
  },
  {
    states: ["PROJECT_QUOTA.releaseStorageBytes"],
    source: "README §Publishing on jams.team",
    phrase: `Release storage ${C("PROJECT_QUOTA.releaseStorageBytes")} across the project's releases`,
  },
  {
    states: ["PROJECT_QUOTA.releasesKept", "PROJECT_QUOTA.jamPins"],
    source: "README §Publishing on jams.team",
    phrase: `Releases kept the ${C("PROJECT_QUOTA.releasesKept")} newest, plus the live preview and production releases and up to ${C("PROJECT_QUOTA.jamPins")} jam versions`,
  },
  {
    states: ["PROJECT_QUOTA.releasesPerDay"],
    source: "README §Publishing on jams.team",
    phrase: `Releases per day ${C("PROJECT_QUOTA.releasesPerDay")}`,
  },
  {
    states: ["PROJECT_QUOTA.assetBytes"],
    source: "README §Publishing on jams.team",
    phrase: `Asset storage ${C("PROJECT_QUOTA.assetBytes")} of uploaded assets`,
  },
  {
    states: ["PROJECT_QUOTA.docs", "PROJECT_QUOTA.docBytes"],
    source: "README §Publishing on jams.team",
    phrase: `Documents ${C("PROJECT_QUOTA.docs")} documents and ${C("PROJECT_QUOTA.docBytes")} of document data`,
  },
  {
    states: ["QUOTA_WARN_RATIO"],
    source: "README §Publishing on jams.team",
    phrase: `with a warning at ${C("QUOTA_WARN_RATIO")}`,
  },
  {
    states: ["PROJECT_QUOTA.releasesKept", "RELEASE_GRACE_DAYS"],
    source: "README §Publishing on jams.team",
    phrase: `neither among the ${C("PROJECT_QUOTA.releasesKept")} newest nor pinned (live on a channel, or a jam version) is removed ${C("RELEASE_GRACE_DAYS")} days after it was published`,
  },
  {
    states: ["BLOB_GRACE_DAYS"],
    source: "README §Publishing on jams.team",
    phrase: `A replaced version of an asset is deleted ${C("BLOB_GRACE_DAYS")} days after it was replaced`,
  },
  {
    states: ["CONNECT_ORIGINS_MAX"],
    source: "README §Publishing on jams.team",
    phrase: `up to ${C("CONNECT_ORIGINS_MAX")} origins you list under "Connects to"`,
  },
  {
    states: ["MIN_HOSTED_ENGINE"],
    source: "README §Publishing on jams.team",
    phrase: `Builds need @jams/engine ${C("MIN_HOSTED_ENGINE")} or newer`,
  },
  {
    states: ["ITCH_LIMITS.maxFiles", "ITCH_LIMITS.maxTotalBytes", "ITCH_LIMITS.maxFileBytes"],
    source: "README §Export's itch.io line",
    phrase: `itch.io takes at most ${C("ITCH_LIMITS.maxFiles")} files, ${C("ITCH_LIMITS.maxTotalBytes")} extracted and ${C("ITCH_LIMITS.maxFileBytes")} per file`,
  },
  // README §Live levels
  {
    states: ["LIVE_LIMITS.versionDataBytes"],
    source: "README §Live levels",
    phrase: `Data per version ${C("LIVE_LIMITS.versionDataBytes")}: the scene, its prefabs, the docs they use and the version file`,
  },
  {
    states: ["LIVE_LIMITS.versionsPerDay"],
    source: "README §Live levels",
    phrase: `Versions per day ${C("LIVE_LIMITS.versionsPerDay")}`,
  },
  {
    states: ["LIVE_LIMITS.keptPerScene"],
    source: "README §Live levels",
    phrase: `Versions kept the ${C("LIVE_LIMITS.keptPerScene")} newest of each scene, plus every version a channel points at`,
  },
  {
    states: ["PROJECT_QUOTA.releaseStorageBytes"],
    source: "README §Live levels",
    phrase: `Storage part of the project's ${C("PROJECT_QUOTA.releaseStorageBytes")} of release storage`,
  },
  {
    states: ["PROJECT_QUOTA.releaseBytes"],
    source: "README §Live levels",
    phrase: `the release plus its live levels' new files stay within ${C("PROJECT_QUOTA.releaseBytes")}`,
  },
  {
    states: ["LIVE_LIMITS.keptPerScene", "RELEASE_GRACE_DAYS"],
    source: "README §Live levels",
    phrase: `A version that is neither among its scene's ${C("LIVE_LIMITS.keptPerScene")} newest nor on a channel is removed ${C("RELEASE_GRACE_DAYS")} days after it was published.`,
  },
  {
    states: ["LIVE_POLL_SECONDS", "LIVE_STREAM_MINUTES", "LIVE_DEFAULTS.preloadTimeoutMs"],
    source: "README §Live levels",
    phrase: `checks every ${C("LIVE_POLL_SECONDS")} seconds while it is visible, in case its live connection dropped or stopped hearing (it reconnects every ${C("LIVE_STREAM_MINUTES")} minutes anyway). The game has ${C("LIVE_DEFAULTS.preloadTimeoutMs")} seconds to download, check and prepare a version`,
  },
  {
    states: [
      "LIVE_BLOCK.players",
      "LIVE_BLOCK.windowMinutes",
      "LIVE_CRASH_WINDOW_SECONDS",
      "LIVE_BLOCK.ratio",
    ],
    source: "README §Live levels",
    phrase: `If ${C("LIVE_BLOCK.players")} signed-in players' games fail after an update within ${C("LIVE_BLOCK.windowMinutes")} minutes of it going live (failing includes crashing within ${C("LIVE_CRASH_WINDOW_SECONDS")} seconds of the swap), and that is at least ${C("LIVE_BLOCK.ratio")} of the signed-in players who reported`,
  },
  {
    states: ["LIVE_DEFAULTS.preloadTimeoutMs"],
    source: "README §Live levels",
    phrase: `its bundle preloaded within ${C("LIVE_DEFAULTS.preloadTimeoutMs")} seconds`,
  },
  {
    states: [
      ...LIVE_DEFAULTS.checkAt.map((_, i) => `LIVE_DEFAULTS.checkAt.${i}`),
      "LIVE_DEFAULTS.checkTicks",
      "LIVE_CHECK_AGAIN_TICKS",
    ],
    source: "README §Live levels",
    phrase: `at ${C("LIVE_DEFAULTS.checkAt.0")}, ${C("LIVE_DEFAULTS.checkAt.1")} and ${C("LIVE_DEFAULTS.checkAt.2")} of each run, steps ${C("LIVE_DEFAULTS.checkTicks")} more ticks, and runs live.check right after each swap and ${C("LIVE_CHECK_AGAIN_TICKS")} ticks later`,
  },
  {
    states: ["LIVE_DEFAULTS.livePlayDebounceMs"],
    source: "README §Live levels",
    phrase: `once ${C("LIVE_DEFAULTS.livePlayDebounceMs")} ms pass without another`,
  },
  // The terms
  {
    states: [
      "PROJECT_QUOTA.releaseBytes",
      "PROJECT_QUOTA.releaseStorageBytes",
      "PROJECT_QUOTA.assetBytes",
      "PROJECT_QUOTA.docs",
    ],
    source: "the terms' games section",
    phrase: `${C("PROJECT_QUOTA.releaseBytes")} per release, ${C("PROJECT_QUOTA.releaseStorageBytes")} for all of its releases, ${C("PROJECT_QUOTA.assetBytes")} of assets and ${C("PROJECT_QUOTA.docs")} documents`,
  },
  {
    states: ["PROJECT_QUOTA.releasesKept"],
    source: "the terms' games section",
    phrase: `We keep each game's ${C("PROJECT_QUOTA.releasesKept")} newest releases`,
  },
  {
    states: ["RELEASE_GRACE_DAYS"],
    source: "the terms' games section",
    phrase: `Other releases are deleted ${C("RELEASE_GRACE_DAYS")} days after they were published`,
  },
  {
    states: ["BLOB_GRACE_DAYS"],
    source: "the terms' games section",
    phrase: `replaced versions of assets are deleted ${C("BLOB_GRACE_DAYS")} days after they were replaced`,
  },
  {
    states: ["PROJECT_PURGE_DAYS"],
    source: "the terms' games section",
    phrase: `a deleted game is erased ${C("PROJECT_PURGE_DAYS")} days after deletion`,
  },
  {
    states: [
      "SITE_SAVE_LIMITS.maxSlots",
      "SITE_SAVE_LIMITS.maxBytes",
      "SITE_SAVE_ACCOUNT_BYTES",
      "SITE_SAVE_EXPIRY_DAYS",
    ],
    source: "the terms' games section",
    phrase: `keep up to ${C("SITE_SAVE_LIMITS.maxSlots")} saves of ${C("SITE_SAVE_LIMITS.maxBytes")} per game on ${SITE.name}, ${C("SITE_SAVE_ACCOUNT_BYTES")} in all; a save not used for ${C("SITE_SAVE_EXPIRY_DAYS")} days is deleted`,
  },
  {
    states: ["LIVE_LIMITS.keptPerScene", "RELEASE_GRACE_DAYS"],
    source: "the terms' games section",
    phrase: `We keep each level's ${C("LIVE_LIMITS.keptPerScene")} newest updates and any update that is live; others are deleted ${C("RELEASE_GRACE_DAYS")} days after they were published.`,
  },
  // The editor's publish wording
  {
    states: ["SITE_SAVE_LIMITS.maxSlots", "SITE_SAVE_LIMITS.maxBytes", "SITE_SAVE_EXPIRY_DAYS"],
    source: "the publish wording",
    phrase: `players who sign in get ${C("SITE_SAVE_LIMITS.maxSlots")} saves of ${C("SITE_SAVE_LIMITS.maxBytes")}, deleted after ${C("SITE_SAVE_EXPIRY_DAYS")} days unused`,
  },
  {
    states: ["CONNECT_ORIGINS_MAX"],
    source: "the publish wording",
    phrase: `Origins this game may contact, up to ${C("CONNECT_ORIGINS_MAX")}.`,
  },
  {
    states: ["FRAME_TOKEN_HOURS"],
    source: "the publish wording",
    phrase: `a link that works for ${C("FRAME_TOKEN_HOURS")} hours`,
  },
  {
    states: ["RELEASE_GRACE_DAYS", "PROJECT_QUOTA.releasesKept", "BLOB_GRACE_DAYS"],
    source: "the publish wording",
    phrase: `releases outside the ${C("PROJECT_QUOTA.releasesKept")} newest ${C("RELEASE_GRACE_DAYS")} days after publishing, replaced asset versions after ${C("BLOB_GRACE_DAYS")} days`,
  },
  // The editor's live scenes wording
  {
    states: ["LIVE_LIMITS.noteChars"],
    source: "the live scenes wording",
    phrase: `What changed, for your team (up to ${C("LIVE_LIMITS.noteChars")} characters)`,
  },
  {
    states: ["LIVE_LIMITS.versionDataBytes"],
    source: "the live scenes wording",
    phrase: `Data: ${b(200 * KB)} of ${C("LIVE_LIMITS.versionDataBytes")}`,
  },
  {
    states: ["LIVE_LIMITS.versionsPerDay"],
    source: "the live scenes wording",
    phrase: `Today: ${n(4)} of ${C("LIVE_LIMITS.versionsPerDay")} versions`,
  },
  {
    states: ["LIVE_LIMITS.keptPerScene", "RELEASE_GRACE_DAYS"],
    source: "the live scenes wording",
    phrase: `Each scene keeps its ${C("LIVE_LIMITS.keptPerScene")} newest versions plus those on a channel; others go ${C("RELEASE_GRACE_DAYS")} days after publishing.`,
  },
  // The save menu and the host
  {
    states: ["SITE_SAVE_LIMITS.maxBytes"],
    source: "the save menu and the host's refusals",
    phrase: `saves on ${SITE.name} are limited to ${C("SITE_SAVE_LIMITS.maxBytes")}`,
  },
  {
    states: ["SITE_SAVE_LIMITS.maxSlots"],
    source: "the save menu and the host's refusals",
    phrase: `You have ${C("SITE_SAVE_LIMITS.maxSlots")} saves for this game, the most ${SITE.name} keeps`,
  },
  {
    states: ["PREFS_MAX_BYTES"],
    source: "the save menu and the host's refusals",
    phrase: `keeps at most ${C("PREFS_MAX_BYTES")} of them in this browser`,
  },
  // Settings → Game saves
  {
    states: [
      "SITE_SAVE_LIMITS.maxSlots",
      "SITE_SAVE_LIMITS.maxBytes",
      "SITE_SAVE_ACCOUNT_BYTES",
      "SITE_SAVE_EXPIRY_DAYS",
    ],
    source: "Settings → Game saves",
    phrase: `Games on ${SITE.name} can save to your account: up to ${C("SITE_SAVE_LIMITS.maxSlots")} saves of ${C("SITE_SAVE_LIMITS.maxBytes")} per game, ${C("SITE_SAVE_ACCOUNT_BYTES")} in all. A save you don't load, overwrite or open the game's save menu for in ${C("SITE_SAVE_EXPIRY_DAYS")} days is deleted. Saves made while signed out stay in that browser and aren't listed here.`,
  },
  // The privacy notice
  {
    states: ["SITE_SAVE_LIMITS.maxBytes", "SITE_SAVE_LIMITS.maxSlots", "SITE_SAVE_ACCOUNT_BYTES"],
    source: "the privacy notice's game paragraphs",
    phrase: `we store each save (up to ${C("SITE_SAVE_LIMITS.maxBytes")}; at most ${C("SITE_SAVE_LIMITS.maxSlots")} per game and ${C("SITE_SAVE_ACCOUNT_BYTES")} in all)`,
  },
  {
    states: ["SITE_SAVE_EXPIRY_DAYS"],
    source: "the privacy notice's game paragraphs",
    phrase: `until ${C("SITE_SAVE_EXPIRY_DAYS")} days after you last used them`,
  },
  {
    states: ["LIVE_REPORT_RETENTION_DAYS"],
    source: "the privacy notice's game paragraphs",
    phrase: `When a game on ${SITE.name} updates a level while you play, your browser tells us whether the update worked, so that a broken update can be stopped. If you are signed in, this is linked to your account and deleted after ${C("LIVE_REPORT_RETENTION_DAYS")} days; if you aren't, we only count it.`,
  },
  {
    states: ["LIVE_REPORT_RETENTION_DAYS"],
    source: "the privacy notice's game paragraphs",
    phrase: `Reports of level updates — ${C("LIVE_REPORT_RETENTION_DAYS")} days.`,
  },
  // The signed-in save menu, which the save notice repeats
  {
    states: ["SITE_SAVE_LIMITS.maxSlots", "SITE_SAVE_LIMITS.maxBytes", "SITE_SAVE_EXPIRY_DAYS"],
    source: "the signed-in save menu",
    phrase: `Saved to your ${SITE.name} account: up to ${C("SITE_SAVE_LIMITS.maxSlots")} saves of ${C("SITE_SAVE_LIMITS.maxBytes")} for this game. Saves you don't use for ${C("SITE_SAVE_EXPIRY_DAYS")} days are deleted.`,
  },
  // The save API
  {
    states: ["SITE_SAVE_ACCOUNT_BYTES"],
    source: "save-api.ts's messages",
    phrase: `Your saves on ${SITE.name} have reached ${C("SITE_SAVE_ACCOUNT_BYTES")} across all games.`,
  },
  {
    states: ["SAVE_TITLE_MAX"],
    source: "save-api.ts's messages",
    phrase: `${SITE.name} keeps titles of up to ${C("SAVE_TITLE_MAX")}.`,
  },
  {
    states: ["SLOT_MAX_LENGTH"],
    source: "save-api.ts's messages",
    phrase: `A slot is lowercase letters, digits and dashes, 1–${C("SLOT_MAX_LENGTH")} characters`,
  },
  // Quota and release messages
  {
    states: ["PROJECT_QUOTA.releasesPerDay"],
    source: "quota.ts's messages",
    phrase: `published ${C("PROJECT_QUOTA.releasesPerDay")} releases today, the most per day`,
  },
  {
    states: ["LIVE_LIMITS.versionsPerDay"],
    source: "quota.ts's messages",
    phrase: `published ${C("LIVE_LIMITS.versionsPerDay")} scene versions today, the most per day`,
  },
  {
    states: ["LIVE_LIMITS.versionDataBytes"],
    source: "quota.ts's messages",
    phrase: `a live scene's data is limited to ${C("LIVE_LIMITS.versionDataBytes")}`,
  },
  {
    states: ["LIVE_LIMITS.keptPerScene"],
    source: "quota.ts's messages",
    phrase: `each scene keeps its ${C("LIVE_LIMITS.keptPerScene")} newest versions plus those on a channel`,
  },
  {
    states: ["PROJECT_QUOTA.jamPins"],
    source: "quota.ts's messages",
    phrase: `already pins ${C("PROJECT_QUOTA.jamPins")} jam versions, the most it can`,
  },
  {
    states: ["RELEASE_GRACE_DAYS", "PROJECT_QUOTA.releasesKept"],
    source: "quota.ts's messages",
    phrase: `Releases outside the ${C("PROJECT_QUOTA.releasesKept")} newest are removed ${C("RELEASE_GRACE_DAYS")} days after publishing unless pinned`,
  },
  {
    states: ["CONNECT_ORIGINS_MAX"],
    source: "game-settings.ts's messages",
    phrase: `A game can connect to at most ${C("CONNECT_ORIGINS_MAX")} origins`,
  },
  {
    states: ["UPLOAD_SESSION_HOURS"],
    source: "release-errors.ts's messages",
    phrase: `This upload started more than ${C("UPLOAD_SESSION_HOURS")} hours ago and expired.`,
  },
  {
    states: ["RELEASE_FILE_PUTS_PER_HOUR"],
    source: "release-errors.ts's messages",
    phrase: `You've uploaded ${C("RELEASE_FILE_PUTS_PER_HOUR")} release files this hour`,
  },
  {
    states: ["MIN_HOSTED_ENGINE"],
    source: "release-errors.ts's messages",
    phrase: `${SITE.name} needs ${C("MIN_HOSTED_ENGINE")} or newer`,
  },
];

/** Constants a message states by name, where rendering the message needs a database. */
const STATED_IN_SOURCE: { states: string; file: string; template: string }[] = [
  {
    states: "GAME_REPORTS_PER_DAY",
    file: "src/lib/engine/release-moderation.ts",
    template: "You've sent ${GAME_REPORTS_PER_DAY} reports today.",
  },
  {
    states: "LIVE_LIMITS.beginsPerHour",
    file: "src/lib/engine/release-errors.ts",
    template:
      "You've started ${formatCount(LIVE_LIMITS.beginsPerHour)} scene publishes this hour, the most per hour.",
  },
  {
    states: "LIVE_LIMITS.noteChars",
    file: "src/lib/engine/live-upload.ts",
    template: "a scene version's note is at most ${formatCount(LIVE_LIMITS.noteChars)}.",
  },
  // The CLI's publish summary prints the maxima the site's usage carries (`usageLines`).
  {
    states: "LIVE_LIMITS.versionsPerDay",
    file: "scripts/scene/tools/game-live.ts",
    template: "${formatCount(versions.used)} of ${formatCount(versions.max)} scene versions",
  },
];

// ─── Typed numbers in the code ───────────────────────────

/** The files every hosted-game message is written in; numbers there are interpolated, never typed. */
const MESSAGE_FILES = [
  "src/lib/engine/quota.ts",
  "src/lib/engine/release-errors.ts",
  "src/lib/engine/local-saves.ts",
  "src/lib/engine/host-server.ts",
  "src/components/game/publish-host.ts",
  "src/lib/engine/game-settings.ts",
  "src/lib/engine/engine-showcase.ts",
  "src/components/settings/GameSaves.tsx",
  "src/lib/engine/save-api.ts",
  "src/lib/engine/save-store.ts",
  "src/components/games/SaveNotice.tsx",
  "src/lib/engine/editor-live-host.ts",
  "src/lib/engine/live-upload.ts",
  "src/lib/engine/live-pointers.ts",
  "scripts/scene/tools/game-live.ts",
  "src/components/games/PlayFrame.tsx",
  "src/components/games/VersionList.tsx",
];

/** The literal parts of every string in a file that reads as a sentence. */
function sentenceLiterals(path: string): { at: number; text: string }[] {
  const file = ts.createSourceFile(path, readRepo(path), ts.ScriptTarget.Latest, true);
  const out: { at: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    let parts: string[] | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) parts = [node.text];
    else if (ts.isTemplateExpression(node))
      parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
    else if (ts.isJsxText(node)) parts = [node.text];
    if (parts) {
      const text = parts.join(" … ");
      if (/[A-Za-z]{2,}[,;:]? [A-Za-z]{2,}/.test(text)) {
        out.push({ at: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

// ─── The tests ───────────────────────────────────────────

describe("the wording suite", () => {
  it("knows every constant in limits.ts", () => {
    const leaves: string[] = [];
    for (const [name, value] of Object.entries(LIMITS)) {
      if (typeof value === "object" && value !== null)
        leaves.push(...Object.keys(value).map((key) => `${name}.${key}`));
      else leaves.push(name);
    }
    expect(leaves.sort()).toEqual(Object.keys(SITE_CONSTANTS).sort());
  });

  it("knows every leaf of the engine's LIVE_DEFAULTS", () => {
    const leaves = Object.entries(LIVE_DEFAULTS).flatMap(([key, value]) =>
      Array.isArray(value)
        ? value.map((_, i) => `LIVE_DEFAULTS.${key}.${i}`)
        : [`LIVE_DEFAULTS.${key}`],
    );
    expect(leaves.sort()).toEqual(
      Object.keys(ENGINE_CONSTANTS)
        .filter((key) => key.startsWith("LIVE_DEFAULTS."))
        .sort(),
    );
  });

  it("gives the CLI's publish summary the live maxima from limits.ts", () => {
    const lines = QUOTA.usageLines(SAMPLE_USAGE);
    expect(lines.find((l) => l.quota === "liveVersionsPerDay")?.max).toBe(
      LIMITS.LIVE_LIMITS.versionsPerDay,
    );
    expect(lines.find((l) => l.quota === "releaseStorageBytes")?.max).toBe(
      LIMITS.PROJECT_QUOTA.releaseStorageBytes,
    );
  });

  it("knows every number save-api.ts exports", () => {
    const numbers = Object.entries(SAVE_API)
      .filter(([, value]) => typeof value === "number")
      .map(([name]) => name);
    expect(numbers.sort()).toEqual(Object.keys(SAVE_API_CONSTANTS).sort());
  });

  it("reads numbers as copy writes them, and flags one no constant has", () => {
    expect(tokens("v7, SHA-256, WOFF2, @jams/engine 0.14.1").map((t) => t.text)).toEqual([
      "0.14.1",
    ]);
    expect(tokens("32 KB, 1,000 files, 80%, 14 days, 12 hours").map((t) => t.kind)).toEqual([
      "bytes",
      "count",
      "percent",
      "days",
      "hours",
    ]);
    expect(straysIn({ name: "copy", text: "up to 9 saves of 33 KB, kept 180 days" })).toEqual([
      'copy: "9"',
      'copy: "33 KB"',
    ]);
  });

  it("finds a number in every source only as a constant's formatted value", async () => {
    const strays: string[] = [];
    for (const source of await sources()) {
      expect(source.text.length, `${source.name} has text`).toBeGreaterThan(0);
      for (const phrase of source.prose ?? [])
        expect(source.text, `${source.name} still says "${phrase}"`).toContain(phrase);
      strays.push(...straysIn(source));
    }
    expect(strays).toEqual([]);
  });

  it("states every constant somewhere, each in its own words", async () => {
    const byName = new Map((await sources()).map((s) => [s.name, s.text]));
    const missing: string[] = [];
    for (const statement of STATEMENTS) {
      const text = byName.get(statement.source);
      expect(text, `a source named ${statement.source}`).toBeDefined();
      if (!text?.includes(tidy(statement.phrase)))
        missing.push(`${statement.source}: "${statement.phrase}"`);
    }
    for (const statement of STATED_IN_SOURCE) {
      if (!readRepo(statement.file).includes(statement.template))
        missing.push(`${statement.file}: "${statement.template}"`);
    }
    expect(missing).toEqual([]);

    const stated = new Set([
      ...STATEMENTS.flatMap((s) => s.states),
      ...STATED_IN_SOURCE.map((s) => s.states),
    ]);
    for (const key of stated) expect(CONSTANTS, `a constant named ${key}`).toHaveProperty([key]);
    const required = [
      ...Object.keys(SITE_CONSTANTS).filter((key) => !(key in UNSTATED)),
      ...ENGINE_STATED,
    ];
    expect(required.filter((key) => !stated.has(key))).toEqual([]);
    expect(Object.keys(UNSTATED).filter((key) => stated.has(key))).toEqual([]);
  });

  it("renders every message release-errors.ts writes", () => {
    const writers = Object.entries(ERRORS)
      .filter(([name, value]) => typeof value === "function" && /^release[A-Z]/.test(name))
      .map(([name]) => name);
    expect(writers.sort()).toEqual(Object.keys(RELEASE_MESSAGES).sort());
  });

  it("renders every message game-settings.ts and engine-showcase.ts write", () => {
    const writers = (module: Record<string, unknown>, skip: readonly string[]) =>
      Object.entries(module)
        .filter(([name, value]) => typeof value === "function" && !skip.includes(name))
        .map(([name]) => name)
        .sort();
    expect(writers(GAME_SETTINGS, GAME_SETTINGS_RULES)).toEqual(
      Object.keys(GAME_SETTINGS_MESSAGES).sort(),
    );
    for (const message of Object.values(GAME_SETTINGS_MESSAGES).flatMap((make) => make()))
      expect(message.code).toBe("game-settings-invalid");
    expect(writers(SHOWCASE, ["linkShowcase", "createShowcase", "unlinkShowcase"])).toEqual(
      Object.keys(SHOWCASE_MESSAGES).sort(),
    );
  });

  it("renders every message save-api.ts writes", () => {
    const writers = Object.entries(SAVE_API)
      .filter(
        ([name, value]) =>
          typeof value === "function" && /^save[A-Z]/.test(name) && !SAVE_API_RULES.includes(name),
      )
      .map(([name]) => name);
    expect(writers.sort()).toEqual(Object.keys(SAVE_API_MESSAGES).sort());
    expect(NOT_A_SAVE_ISSUE, "an empty object isn't a save file").toBeDefined();
  });

  it("renders a refusal for every quota", () => {
    const named = [
      ...Object.keys(Q).filter((key) => key !== "releasesKept"),
      "liveVersionBytes",
      "liveVersionsPerDay",
    ];
    expect([...new Set(QUOTA_INPUTS.map((input) => input.limit))].sort()).toEqual(named.sort());
  });

  it("never types a number into a message: every one is interpolated", () => {
    const typed: string[] = [];
    for (const path of MESSAGE_FILES) {
      const literals = sentenceLiterals(path);
      expect(literals.length, `${path} has sentences`).toBeGreaterThan(0);
      for (const literal of literals) {
        for (const token of tokens(literal.text))
          typed.push(`${path}:${literal.at}: "${token.raw}"`);
      }
    }
    expect(typed).toEqual([]);
  });

  it("names the abuse address for appeals in the terms", () => {
    expect(terms).toContain(`You may appeal to ${CONTACT.abuse}.`);
  });
});
