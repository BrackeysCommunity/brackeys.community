// @vitest-environment jsdom
// Every number a person reads about hosted games is the formatted value of
// a constant: the README's hosting sections, the terms, the editor's
// publish wording, the save menu's sentences and every quota and release
// message. A number that isn't one fails here, and so does a constant no
// sentence states. A limit changes by one edit in `limits.ts` (or the
// engine's constants) plus the copy this suite points at.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ITCH_LIMITS, DEFAULT_EXPORT_BUDGET } from "@jams/engine/export";
import { DEFAULT_SAVE_LIMITS, MAX_BROWSER_SAVE_LIMITS } from "@jams/engine/game";
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

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: unknown }) =>
    createElement("a", { href: to, ...rest }, children as never),
}));

const { HOST_NO_SITE_SAVES_MESSAGE, HOST_THROTTLED_MESSAGE } = await import("../host-server");
const { prefsRefusal, SIGNED_OUT_SAVES_DESCRIBE, siteSaveRefusal } = await import("../local-saves");
const { emptyTrashConfirm, publishWording, removalText, USAGE_FOOTER, usageView } =
  await import("@/components/game/publish-host");
const { TermsDocument } = await import("@/components/legal/TermsDocument");

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
  QUOTA_WARN_RATIO: { kind: "percent", text: percent(LIMITS.QUOTA_WARN_RATIO) },
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
};

const CONSTANTS: Record<string, Constant> = { ...SITE_CONSTANTS, ...ENGINE_CONSTANTS };

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

const words = (m: { message: string; hint?: string }): string =>
  [m.message, m.hint ?? ""].join(" ");

let terms = "";

beforeAll(() => {
  const { container } = render(createElement(TermsDocument));
  const section = container.querySelector("section#games");
  expect(section, "the terms' games section renders with the guard on").not.toBeNull();
  terms = tidy([...section!.querySelectorAll("p")].map((p) => p.textContent ?? "").join("\n"));
});

afterAll(cleanup);

async function sources(): Promise<Source[]> {
  const wording = publishWording("tactics" as never, "Lanes");
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
        ),
        ...DATE_GIVEN,
      ],
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
  // Quota and release messages
  {
    states: ["PROJECT_QUOTA.releasesPerDay"],
    source: "quota.ts's messages",
    phrase: `published ${C("PROJECT_QUOTA.releasesPerDay")} releases today, the most per day`,
  },
  {
    states: ["PROJECT_QUOTA.jamPins"],
    source: "quota.ts's messages",
    phrase: `already pins ${C("PROJECT_QUOTA.jamPins")} jam versions, the most it can`,
  },
  {
    states: ["RELEASE_GRACE_DAYS", "PROJECT_QUOTA.releasesKept"],
    source: "quota.ts's messages",
    phrase: `Releases outside your ${C("PROJECT_QUOTA.releasesKept")} newest are removed ${C("RELEASE_GRACE_DAYS")} days after publishing unless pinned`,
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
];

// ─── Typed numbers in the code ───────────────────────────

/** The files every hosted-game message is written in; numbers there are interpolated, never typed. */
const MESSAGE_FILES = [
  "src/lib/engine/quota.ts",
  "src/lib/engine/release-errors.ts",
  "src/lib/engine/local-saves.ts",
  "src/lib/engine/host-server.ts",
  "src/components/game/publish-host.ts",
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
    expect(straysIn({ name: "copy", text: "up to 5 saves of 33 KB, kept 180 days" })).toEqual([
      'copy: "5"',
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

  it("renders a refusal for every quota", () => {
    const named = Object.keys(Q).filter((key) => key !== "releasesKept");
    expect(QUOTA_INPUTS.map((input) => input.limit).sort()).toEqual(named.sort());
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
