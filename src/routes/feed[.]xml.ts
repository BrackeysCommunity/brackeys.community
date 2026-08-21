import { createFileRoute } from "@tanstack/react-router";
import { and, asc, gte, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { itchJams } from "@/db/schema";
import { siteOrigin, siteUrl } from "@/env";
import { hostName } from "@/lib/jam-links";
import { withErrorReporting } from "@/lib/posthog-server";
import { SITE_NAME } from "@/lib/site-meta";

/**
 * `/feed.xml` — upcoming and running jams as Atom, never the archive.
 *
 * Atom rather than RSS 2.0 because entries need a stable `id` and a real
 * `updated`, both of which the scraper already stamps.
 */
const FEED_LIMIT = 60;

/** Jams that already ended by this much are past, not upcoming. */
const RECENTLY_ENDED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function handle() {
  const horizon = new Date(Date.now() - RECENTLY_ENDED_GRACE_MS);
  const rows = await db
    .select({
      jamId: itchJams.jamId,
      slug: itchJams.slug,
      title: itchJams.title,
      startsAt: itchJams.startsAt,
      endsAt: itchJams.endsAt,
      entriesCount: itchJams.entriesCount,
      updatedAt: itchJams.updatedAt,
      hosts: itchJams.hosts,
    })
    .from(itchJams)
    // `missingSince` matches the sitemap and the jam page's 404: a jam
    // delisted on itch must not be advertised at a URL that no longer
    // exists. Open-ended jams (no `endsAt`) qualify only if they started
    // recently — an ancient dateless row is neither opening nor running.
    .where(
      and(
        isNull(itchJams.missingSince),
        or(
          gte(itchJams.endsAt, horizon),
          and(isNull(itchJams.endsAt), gte(itchJams.startsAt, horizon)),
        ),
      ),
    )
    // Soonest first — for jams, "newest" means "next to open".
    .orderBy(asc(sql`coalesce(${itchJams.startsAt}, ${itchJams.endsAt})`))
    .limit(FEED_LIMIT);

  const self = siteUrl("/feed.xml");
  const updated = rows.reduce<Date | null>(
    (latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest),
    null,
  );

  const entries = rows.map((row) => {
    const url = siteUrl(`/jams/${row.slug}`);
    const window = [
      row.startsAt ? `Opens ${row.startsAt.toISOString().slice(0, 10)}` : null,
      row.endsAt ? `closes ${row.endsAt.toISOString().slice(0, 10)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const summary = [
      window && `${window}.`,
      row.entriesCount ? `${row.entriesCount.toLocaleString("en-US")} entries so far.` : null,
      row.hosts[0] ? `Hosted by ${hostName(row)}.` : null,
    ]
      .filter(Boolean)
      .join(" ");

    return [
      "  <entry>",
      `    <id>${escapeXml(`${siteOrigin()}/jams/${row.slug}`)}</id>`,
      `    <title>${escapeXml(row.title)}</title>`,
      `    <link rel="alternate" type="text/html" href="${escapeXml(url)}"/>`,
      `    <updated>${row.updatedAt.toISOString()}</updated>`,
      summary ? `    <summary>${escapeXml(summary)}</summary>` : "",
      "  </entry>",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const body = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom">`,
    `  <title>${escapeXml(`${SITE_NAME} — jams`)}</title>`,
    `  <subtitle>Game jams opening soon and running now.</subtitle>`,
    `  <id>${escapeXml(self)}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(siteUrl("/jams"))}"/>`,
    // RFC 4287 requires an author on the feed or on every entry; some
    // readers refuse the feed without it.
    `  <author><name>${escapeXml(SITE_NAME)}</name></author>`,
    `  <updated>${(updated ?? new Date()).toISOString()}</updated>`,
    ...entries,
    `</feed>`,
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=900",
    },
  });
}

const reportedHandle = withErrorReporting("/feed.xml", handle);

export const Route = createFileRoute("/feed.xml")({
  server: { handlers: { HEAD: reportedHandle, GET: reportedHandle } },
});
