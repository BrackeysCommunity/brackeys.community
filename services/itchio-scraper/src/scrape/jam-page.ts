import * as cheerio from "cheerio";
import type { Browser } from "puppeteer-core";

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

function parseEmbeddedJamId(html: string): number | null {
  // The numeric id appears in different places depending on jam state:
  //   upcoming  → data-href="/jam/{id}/join" on the join button
  //   running   → submit / manage-submission button hrefs
  //   voting    → entries_url / randomizer_url in the BrowseEntries payload
  //   over      → results / entries URLs
  // A single `/jam/{digits}/...` match covers all of them, plus a few fallbacks
  // for query-string / JSON forms that don't include a trailing path segment.
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

export async function scrapeJamPage(browser: Browser, slug: string): Promise<ScrapedJam> {
  const url = `https://itch.io/jam/${slug}`;
  const html = await fetchHtml(browser, url);
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

  const dates: Date[] = [];
  $(".date_format").each((_, el) => {
    const attr = $(el).attr("title");
    if (!attr) return;
    // Always UTC e.g. "2026-02-15 11:00:00 UTC".
    const iso = attr.replace(" UTC", "Z").replace(" ", "T");
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) dates.push(d);
  });

  const statBoxes: Array<{ label: string; count: number | null }> = [];
  $(".stats_container .stat_box").each((_, el) => {
    const $el = $(el);
    const label = $el.find(".stat_label").text().trim();
    const value = $el.find(".stat_value").text().trim();
    const titleAttr = $el.attr("title") ?? undefined;
    statBoxes.push({ label, count: parseCount(value, titleAttr) });
  });
  const entriesCount = statBoxes.find((s) => /entries/i.test(s.label))?.count ?? null;
  const ratingsCount = statBoxes.find((s) => /ratings/i.test(s.label))?.count ?? null;

  const jamId = parseEmbeddedJamId(html);
  if (!jamId) throw new Error(`Could not determine numeric jam id for ${slug}`);

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
    startsAt: dates[0] ?? null,
    endsAt: dates[1] ?? null,
    votingEndsAt: dates[2] ?? null,
    entriesCount,
    ratingsCount,
    contentHtml,
  };
}
