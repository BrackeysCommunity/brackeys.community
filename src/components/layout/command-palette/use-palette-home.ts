import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useMemo, useState } from "react";

import { SHOWCASE_MAX_LENGTH_DAYS } from "@/components/home/showcase-jams";
import { jamPhase } from "@/components/jams/JamCalendarPage/helpers";
import { authStore } from "@/lib/auth-store";
import { forumPostTitle } from "@/lib/forum-posts";
import { jamLengthDays } from "@/lib/jam-countdown";
import { readRecentlyOpened, readRecentSearches } from "@/lib/palette-recents";
import type { SearchHit } from "@/lib/search-hits";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

type JamHit = Extract<SearchHit, { kind: "jam" }>;

const LIVE_LIMIT = 7;
/** Live jams fetched before the length filter, so seven survive it. */
const LIVE_FETCH = 30;
const DEADLINE_LIMIT = 5;
const FORUM_LIMIT = 4;

type Stamp = Date | string | null;

function iso(value: Stamp): string | null {
  return value == null ? null : new Date(value).toISOString();
}

function toDate(value: Stamp): Date | null {
  return value == null ? null : new Date(value);
}

function jamHit(
  jam: {
    jamId: number;
    slug: string;
    title: string;
    bannerUrl: string | null;
    themeColor: string | null;
    startsAt: Stamp;
    endsAt: Stamp;
    votingEndsAt: Stamp;
    entriesCount?: number | null;
  },
  now: Date,
): JamHit {
  return {
    kind: "jam",
    id: jam.jamId,
    slug: jam.slug,
    title: jam.title,
    phase: jamPhase(
      {
        startsAt: toDate(jam.startsAt),
        endsAt: toDate(jam.endsAt),
        votingEndsAt: toDate(jam.votingEndsAt),
      },
      now,
    ),
    startsAt: iso(jam.startsAt),
    endsAt: iso(jam.endsAt),
    votingEndsAt: iso(jam.votingEndsAt),
    bannerUrl: jam.bannerUrl,
    themeColor: jam.themeColor,
    entriesCount: jam.entriesCount ?? null,
  };
}

export interface PaletteHome {
  live: JamHit[];
  deadlines: JamHit[];
  unread: number;
  forum: Extract<SearchHit, { kind: "forum" }>[];
  recentSearches: string[];
  recentlyOpened: SearchHit[];
  loading: boolean;
}

/**
 * What the palette shows before anything is typed. Each part is a query
 * the site already makes elsewhere (the jam board, the watch strip, the
 * bell, the forum feed) with the same input, so it usually answers from
 * cache.
 */
export function usePaletteHome(enabled: boolean, forumOn: boolean): PaletteHome {
  const signedIn = useStore(authStore, (s) => Boolean(s.session?.user));
  const live = useQuery({
    ...orpc.listJams.queryOptions({
      input: { filter: "live", sortBy: "popularity", limit: LIVE_FETCH },
    }),
    enabled,
    staleTime: STALE.listing,
  });
  const watches = useQuery({
    ...orpc.listMyJamWatches.queryOptions({ input: { scope: "all", limit: 50 } }),
    enabled: enabled && signedIn,
    staleTime: STALE.listing,
  });
  const unread = useQuery({
    ...orpc.unreadCount.queryOptions({ input: {} }),
    enabled: enabled && signedIn,
  });
  const forum = useQuery({
    ...orpc.listForumPosts.queryOptions({ input: { sort: "latest", limit: FORUM_LIMIT } }),
    enabled: enabled && forumOn,
    staleTime: STALE.listing,
  });

  // Read on each opening, not per render: they only change when the
  // palette itself writes them, which closes it.
  const [recents, setRecents] = useState(() => ({
    searches: [] as string[],
    opened: [] as SearchHit[],
  }));
  const [readFor, setReadFor] = useState(false);
  if (enabled !== readFor) {
    setReadFor(enabled);
    if (enabled) setRecents({ searches: readRecentSearches(), opened: readRecentlyOpened() });
  }

  return useMemo(() => {
    const now = new Date();
    return {
      // Same rule as the home band: a year-long or open-ended jam is always
      // "live" and says nothing about what's happening now. Search still
      // finds them.
      live: (live.data?.jams ?? [])
        .filter((jam) => {
          const length = jamLengthDays(jam.startsAt, jam.endsAt);
          return length != null && length <= SHOWCASE_MAX_LENGTH_DAYS;
        })
        .slice(0, LIVE_LIMIT)
        .map((jam) => jamHit(jam, now)),
      deadlines: (watches.data?.jams ?? [])
        .filter((jam) => jam.missingSince == null)
        .map((jam) => jamHit(jam, now))
        .filter((jam) => jam.phase !== "archive")
        .slice(0, DEADLINE_LIMIT),
      unread: unread.data?.count ?? 0,
      forum: (forum.data?.posts ?? []).map((post) => ({
        kind: "forum" as const,
        id: post.id,
        slug: post.slug,
        title: forumPostTitle(post),
        excerpt: post.excerpt,
        postKind: post.kind,
        tags: post.tags,
      })),
      recentSearches: recents.searches,
      recentlyOpened: recents.opened,
      loading: live.isPending,
    };
  }, [live.data, live.isPending, watches.data, unread.data, forum.data, recents]);
}
