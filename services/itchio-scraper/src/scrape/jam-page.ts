import * as cheerio from "cheerio";

import type { ItchJamHost, ItchJamStatus } from "../../../../src/db/schema.ts";
import { fetchHtml } from "../browser.ts";

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
};

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

function parseViewJamPayload(html: string): ViewJamPayload | null {
  // Every jam page bootstraps a `new I.ViewJam('#view_jam_NN', { ... })`
  // constructor — regardless of status — and the JSON object always carries
  // the numeric id, start/end, and (when applicable) voting_end_date. This
  // is the most reliable source we have across upcoming / running / over.
  const match = html.match(/I\.ViewJam\(\s*'[^']+'\s*,\s*(\{[^}]*\})\s*\)/);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as {
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

function deriveStatus(viewClasses: string): ItchJamStatus {
  if (viewClasses.includes("after_voting") || viewClasses.includes("is_over")) {
    return "over";
  }
  if (viewClasses.includes("voting_open") || viewClasses.includes("in_voting")) {
    return "voting";
  }
  if (viewClasses.includes("is_running") || viewClasses.includes("in_progress")) {
    return "running";
  }
  return "upcoming";
}

export async function scrapeJamPage(slug: string): Promise<ScrapedJam> {
  const url = `https://itch.io/jam/${slug}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const viewClasses = $(".view_jam_base_page").attr("class") ?? "";
  const title = $(".jam_title_header").first().text().trim();
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
  };
}
