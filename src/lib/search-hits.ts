/**
 * The site-wide search result contract: what `searchAll` returns, whatever
 * engine answered. The palette, the indexer and the MCP server all read it,
 * so this module has no runtime imports — a service that copies it must not
 * drag the app's module graph along.
 */

export const SEARCH_KINDS = [
  "jam",
  "entry",
  "member",
  "team",
  "collab",
  "forum",
  "project",
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

export type SearchJamPhase = "upcoming" | "running" | "voting" | "archive";

export type SearchHit =
  | {
      kind: "jam";
      id: number;
      slug: string;
      title: string;
      phase: SearchJamPhase;
      startsAt: string | null;
      endsAt: string | null;
      votingEndsAt: string | null;
      bannerUrl: string | null;
      themeColor: string | null;
      entriesCount: number | null;
    }
  | {
      kind: "entry";
      id: number;
      gameId: number;
      jamId: number;
      title: string;
      author: string | null;
      jamTitle: string;
      coverUrl: string | null;
      coverColor: string | null;
    }
  | {
      kind: "member";
      id: string;
      stub: string | null;
      name: string;
      avatarUrl: string | null;
      tagline: string | null;
    }
  | {
      kind: "team";
      id: string;
      slug: string;
      name: string;
      tagline: string | null;
      avatarUrl: string | null;
      recruiting: boolean;
    }
  | {
      kind: "collab";
      id: number;
      title: string;
      type: string;
      status: string;
      teamName: string | null;
    }
  | {
      kind: "forum";
      id: number;
      slug: string | null;
      title: string;
      excerpt: string | null;
      postKind: "post" | "devlog" | "question";
      tags: string[];
    }
  | {
      kind: "project";
      id: string;
      slug: string;
      title: string;
      coverUrl: string | null;
    };

export type Ranked<T> = T & {
  score: number;
  /** Absolute site path. Navigation builds a typed route from the hit's own fields. */
  href: string;
  highlight?: [number, number][];
};

export type RankedHit = Ranked<SearchHit>;

/** One kind's answer, best first, before fusion. */
export interface KindResult {
  kind: SearchKind;
  hits: (Omit<RankedHit, "score"> & { exact?: boolean })[];
}

/** Reciprocal Rank Fusion's damping constant — the usual 60. */
export const RRF_K = 60;

/**
 * A nudge per kind, about one rank step at the top of a list: enough to
 * break ties between kinds' equal ranks, never enough to reorder a kind.
 */
const KIND_PRIOR: Record<SearchKind, number> = {
  jam: 0.0004,
  member: 0.0003,
  team: 0.0003,
  project: 0.0002,
  collab: 0.00015,
  forum: 0.0001,
  entry: 0.00005,
};

/**
 * An exact name match outranks every fuzzy one: typing a handle in full
 * should put that person first, not the best-ranked forum post.
 */
const EXACT_BONUS = 0.01;

/**
 * Merges each kind's ranked list into one list, best first. Scores within
 * a kind aren't comparable across kinds (trigram similarity vs `ts_rank`),
 * so only each hit's position in its own list counts.
 */
export function fuseResults(results: KindResult[]): RankedHit[] {
  const fused: RankedHit[] = [];
  for (const { kind, hits } of results) {
    hits.forEach(({ exact, ...hit }, index) => {
      const score = 1 / (RRF_K + index + 1) + KIND_PRIOR[kind] + (exact ? EXACT_BONUS : 0);
      fused.push({ ...hit, score } as RankedHit);
    });
  }
  return fused.sort((a, b) => b.score - a.score);
}

/** Lowercased, diacritics stripped, whitespace collapsed. */
export function foldSearchText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Whether any of `labels` is the query itself, ignoring case and accents. */
export function isExactMatch(query: string, labels: (string | null | undefined)[]): boolean {
  const q = foldSearchText(query).replace(/^[@#]/, "");
  return labels.some((label) => label != null && foldSearchText(label) === q);
}

/**
 * Where `query` occurs in `text`, for highlighting. Folding keeps one
 * character per character for Latin text, so offsets line up with the
 * original; a label where they wouldn't (ligatures, some scripts) just
 * goes unhighlighted.
 */
export function highlightRanges(text: string, query: string): [number, number][] {
  const q = foldSearchText(query).replace(/^[@#]/, "");
  if (!q) return [];
  const folded = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (folded.length !== text.length) return [];
  const ranges: [number, number][] = [];
  for (const word of q.split(" ").filter((w) => w.length >= 2)) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(word, from);
      if (at < 0) break;
      ranges.push([at, at + word.length]);
      from = at + word.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** The label a hit is listed under. */
export function hitLabel(hit: SearchHit): string {
  return hit.kind === "member" || hit.kind === "team" ? hit.name : hit.title;
}
