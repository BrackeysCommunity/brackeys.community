import * as cheerio from "cheerio";

import type { ItchJamHost, ItchJamStatus } from "../../../../src/db/schema.ts";
import { fetchHtml } from "../http.ts";

export type ScrapedJam = {
  jamId: number;
  slug: string;
  title: string;
  bannerUrl: string | null;
  hashtag: string | null;
  hosts: ItchJamHost[];
  status: ItchJamStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  votingEndsAt: Date | null;
  joinedCount: number | null;
  entriesCount: number | null;
  ratingsCount: number | null;
  contentHtml: string | null;
  themeColor: string | null;
};

/**
 * Host-chosen page background from the jam page's generated theme CSS
 * (`body{background-color: …}` inside a `<style>` block). Strictly
 * validated — the value ends up inside inline `style` attributes on the
 * web app, so anything that isn't a plain hex/rgb() literal is dropped
 * rather than stored.
 */
export function parseThemeColor(html: string): string | null {
  const match = html.match(/body\s*\{\s*background-color:\s*([^;}]+)[;}]/);
  const raw = match?.[1]?.trim();
  if (!raw) return null;
  const isSafe =
    /^#[0-9a-fA-F]{3}$/.test(raw) ||
    /^#[0-9a-fA-F]{6}$/.test(raw) ||
    /^#[0-9a-fA-F]{8}$/.test(raw) ||
    /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/.test(raw);
  return isSafe ? raw : null;
}

function parseCount(raw: string | undefined, title: string | undefined): number | null {
  // Prefer the exact count in the `title` attribute ("31,777") over the
  // abbreviated visible value ("31.7k").
  const source = title ?? raw;
  if (!source) return null;
  const digits = source.replace(/[^\d]/g, "");
  return digits ? Number.parseInt(digits, 10) : null;
}

type ViewJamPayload = {
  id: number;
  startsAt: Date | null;
  endsAt: Date | null;
  votingEndsAt: Date | null;
};

function parseIsoMaybe(raw: string | undefined): Date | null {
  if (!raw) return null;
  // itch serializes these as UTC naive strings like "2026-02-15 11:00:00".
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The object literal a jam page's bootstrap constructor is called with.
 * Scanned brace-by-brace rather than matched with `\{[^}]*\}`: the raw-jam
 * variant embeds a `status_html` string of markup, and a brace anywhere in it
 * would truncate a lazy match mid-object.
 */
function extractBootstrapObject(html: string): string | null {
  // `I.ViewJam('#view_jam_NN', { … })` on modern pages, `I.ViewRawJam(…)` on
  // the legacy ones — both bootstrap the same payload shape.
  const opener = html.match(/I\.View(?:Raw)?Jam\(\s*'[^']*'\s*,\s*\{/);
  if (opener?.index == null) return null;

  const start = opener.index + opener[0].length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return html.slice(start, i + 1);
  }
  return null;
}

function parseViewJamPayload(html: string): ViewJamPayload | null {
  // Every jam page bootstraps a `new I.ViewJam('#view_jam_NN', { ... })`
  // constructor — regardless of status — and the JSON object always carries
  // the numeric id, start/end, and (when applicable) voting_end_date. This
  // is the most reliable source we have across upcoming / running / over,
  // and it is the *only* one on a raw jam page.
  const raw = extractBootstrapObject(html);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      id?: number;
      start_date?: string;
      end_date?: string;
      voting_end_date?: string;
    };
    if (typeof parsed.id !== "number") return null;
    return {
      id: parsed.id,
      startsAt: parseIsoMaybe(parsed.start_date),
      endsAt: parseIsoMaybe(parsed.end_date),
      votingEndsAt: parseIsoMaybe(parsed.voting_end_date),
    };
  } catch {
    return null;
  }
}

function parseEmbeddedJamIdFallback(html: string): number | null {
  // Used only if the ViewJam constructor can't be parsed. Covers state-specific
  // URL / query-string embeds of the id as a last resort.
  const patterns = [
    /\/jam\/(\d+)\/[a-z_-]+/,
    /\\\/jam\\\/(\d+)\\\/[a-z_-]+/,
    /[?&]jam_id=(\d+)/,
    /"jam_id"\s*:\s*(\d+)/,
  ];
  for (const pattern of patterns) {
    const captured = html.match(pattern)?.[1];
    if (captured) return Number.parseInt(captured, 10);
  }
  return null;
}

/**
 * Jam phase from the `.view_jam_base_page` class list. itch emits exactly one
 * phase class per page — verified against live pages:
 *
 *   before_start           soulslike-game-jam-3   (starts later today)
 *   during_submit          decadejam              (open until 2030)
 *   during_voting          appx-n-jam-2026        (voting until October)
 *   after_voting is_over   gds-144-hour-jam-2026
 *
 * Ordered latest-phase-first because `is_over` pages also carry `after_voting`.
 * An unrecognized class list falls back to `upcoming`, which is the safe
 * direction — `over` is what makes a jam eligible for ranking collection, so a
 * page we can't read never gets its in-flight scores persisted as final.
 */
export function deriveStatus(viewClasses: string): ItchJamStatus {
  if (viewClasses.includes("after_voting") || viewClasses.includes("is_over")) {
    return "over";
  }
  if (viewClasses.includes("during_voting")) {
    return "voting";
  }
  if (viewClasses.includes("during_submit")) {
    return "running";
  }
  // Loud on purpose: the previous mapping guessed at these class names, and
  // because the fallback is silent every running and voting jam sat in the DB
  // labelled `upcoming` (494 of them) with nothing to show it. If itch renames
  // a phase class again, that shows up in the cron log the same night.
  if (!viewClasses.includes("before_start")) {
    console.warn(
      `[jam-page] unrecognized jam phase classes, defaulting to upcoming: ${
        viewClasses || "(none)"
      }`,
    );
  }
  return "upcoming";
}

/**
 * itch's original jam format — `/jam/candyjam` and the rest of the 2014
 * cohort — renders `view_raw_jam_page`: the host's own markup inside
 * `.jam_content` and none of the modern furniture. No title header, no host
 * header, no stat boxes, no banner. Those all come back empty on their own;
 * the title and the phase classes are the two that have to be read elsewhere.
 */
function isRawJamPage($: cheerio.CheerioAPI): boolean {
  return $(".view_raw_jam_page").length > 0;
}

/** `<title>Candy Jam - itch.io</title>` — the only place a raw jam is named. */
function parseDocumentTitle($: cheerio.CheerioAPI): string {
  return $("title")
    .first()
    .text()
    .trim()
    .replace(/\s*-\s*itch\.io$/i, "")
    .trim();
}

export async function scrapeJamPage(slug: string): Promise<ScrapedJam> {
  const url = `https://itch.io/jam/${slug}`;
  return parseJamPage(await fetchHtml(url), slug);
}

export function parseJamPage(html: string, slug: string): ScrapedJam {
  const $ = cheerio.load(html);
  const isRaw = isRawJamPage($);

  // Raw pages carry the phase classes on `.jam_content`; their page root has
  // none, which would otherwise trip deriveStatus's unrecognized-class warning
  // on every legacy jam.
  const viewClasses =
    (isRaw ? $(".jam_content").first().attr("class") : $(".view_jam_base_page").attr("class")) ??
    "";
  const title = isRaw ? parseDocumentTitle($) : $(".jam_title_header").first().text().trim();
  if (!title) throw new Error(`Could not find jam title for ${slug}`);

  const hostHeader = $(".jam_host_header").first();
  const hashtag = hostHeader.find('a[href*="hashtag"]').first().text().trim() || null;
  const hosts: ItchJamHost[] = hostHeader
    .find("a")
    .toArray()
    .map((el) => {
      const $el = $(el);
      return { name: $el.text().trim(), url: $el.attr("href") ?? "" };
    })
    .filter((h) => h.url.includes(".itch.io"));

  const viewJam = parseViewJamPayload(html);
  const jamId = viewJam?.id ?? parseEmbeddedJamIdFallback(html);
  if (!jamId) throw new Error(`Could not determine numeric jam id for ${slug}`);

  // Prefer labeled dates from the ViewJam JSON. Fall back to positional
  // `.date_format` elements if the bootstrap payload isn't parseable.
  let startsAt = viewJam?.startsAt ?? null;
  let endsAt = viewJam?.endsAt ?? null;
  let votingEndsAt = viewJam?.votingEndsAt ?? null;
  if (!startsAt || !endsAt) {
    const dates: Date[] = [];
    $(".date_format").each((_, el) => {
      const attr = $(el).attr("title");
      if (!attr) return;
      const iso = attr.replace(" UTC", "Z").replace(" ", "T");
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) dates.push(d);
    });
    startsAt = startsAt ?? dates[0] ?? null;
    endsAt = endsAt ?? dates[1] ?? null;
    votingEndsAt = votingEndsAt ?? dates[2] ?? null;
  }

  const statBoxes: Array<{ label: string; count: number | null }> = [];
  $(".stats_container .stat_box").each((_, el) => {
    const $el = $(el);
    const label = $el.find(".stat_label").text().trim();
    const value = $el.find(".stat_value").text().trim();
    const titleAttr = $el.attr("title") ?? undefined;
    statBoxes.push({ label, count: parseCount(value, titleAttr) });
  });
  const joinedCount = statBoxes.find((s) => /joined/i.test(s.label))?.count ?? null;
  const entriesCount = statBoxes.find((s) => /entries/i.test(s.label))?.count ?? null;
  const ratingsCount = statBoxes.find((s) => /ratings/i.test(s.label))?.count ?? null;

  const banner = $(".jam_banner img, .jam_banner_outer img").first().attr("src") ?? null;
  const contentHtml = $(".jam_content").first().html()?.trim() || null;

  return {
    jamId,
    slug,
    title,
    bannerUrl: banner,
    hashtag,
    hosts,
    status: deriveStatus(viewClasses),
    startsAt,
    endsAt,
    votingEndsAt,
    joinedCount,
    entriesCount,
    ratingsCount,
    contentHtml,
    themeColor: parseThemeColor(html),
  };
}
