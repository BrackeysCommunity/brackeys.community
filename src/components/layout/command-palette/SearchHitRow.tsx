import {
  Calendar03Icon,
  Comment01Icon,
  GameController03Icon,
  PackageIcon,
  UserGroupIcon,
  UserIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { CommandShortcut } from "@/components/ui/command";
import { UserAvatar } from "@/components/ui/user-avatar";
import { FORUM_KIND_LABEL } from "@/lib/forum-posts";
import { highlightRanges, hitLabel, type RankedHit, type SearchKind } from "@/lib/search-hits";

import { isMediaHit, SearchArt, type MediaHit } from "./SearchArt";

export const KIND_HEADING: Record<SearchKind, string> = {
  jam: "JAMS",
  entry: "JAM ENTRIES",
  member: "MEMBERS",
  team: "TEAMS",
  collab: "COLLAB",
  forum: "FORUM",
  project: "PROJECTS",
};

const KIND_ICON: Record<SearchKind, typeof UserIcon> = {
  jam: Calendar03Icon,
  entry: GameController03Icon,
  member: UserIcon,
  team: UserGroupIcon,
  collab: Wrench01Icon,
  forum: Comment01Icon,
  project: PackageIcon,
};

/** The right-hand hint on a hit's row: what distinguishes it from a namesake. */
function hitHint(hit: RankedHit): string | null {
  switch (hit.kind) {
    case "jam":
      return hit.phase === "archive" ? null : hit.phase;
    case "entry":
      return hit.jamTitle;
    case "member":
      return hit.stub ? `@${hit.stub}` : null;
    case "team":
      return hit.recruiting ? "recruiting" : null;
    case "collab":
      return hit.teamName;
    case "forum":
      return FORUM_KIND_LABEL[hit.postKind];
    case "project":
      return null;
  }
}

/** `text` with the parts matching `query` emphasised. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  const ranges = highlightRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="bg-transparent font-bold text-primary">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** The icon slot of a row: a person's or team's face, else the kind's glyph. */
function HitGlyph({ hit }: { hit: RankedHit }) {
  if (hit.kind === "member" || hit.kind === "team") {
    return <UserAvatar avatarUrl={hit.avatarUrl} username={hit.name} size={20} />;
  }
  return <HugeiconsIcon icon={KIND_ICON[hit.kind]} className="text-muted-foreground" />;
}

/** A hit's row contents, inside a `CommandItem`. */
export function SearchHitRow({ hit, query }: { hit: RankedHit; query: string }) {
  const hint = hitHint(hit);
  return (
    <>
      <HitGlyph hit={hit} />
      <span className="truncate">
        <Highlighted text={hitLabel(hit)} query={query} />
      </span>
      {hint ? <CommandShortcut className="max-w-[40%] truncate">{hint}</CommandShortcut> : null}
    </>
  );
}

/** The top hit, larger: its art (or face) beside the title and hint. */
export function SearchHitFeature({ hit, query }: { hit: RankedHit; query: string }) {
  const hint = hitHint(hit);
  return (
    <>
      {isMediaHit(hit) ? (
        <SearchArt hit={hit} className="w-20 shrink-0" />
      ) : hit.kind === "member" || hit.kind === "team" ? (
        <UserAvatar avatarUrl={hit.avatarUrl} username={hit.name} size={40} />
      ) : (
        <HitGlyph hit={hit} />
      )}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-bold">
          <Highlighted text={hitLabel(hit)} query={query} />
        </span>
        <span className="truncate text-muted-foreground">
          {[KIND_HEADING[hit.kind], hint].filter(Boolean).join(" · ")}
        </span>
      </span>
    </>
  );
}

/** A media hit as a rail tile: art on top, title and hint under it. */
export function SearchHitTile({ hit, query }: { hit: MediaHit & RankedHit; query: string }) {
  const hint = hitHint(hit);
  return (
    <>
      <SearchArt hit={hit} />
      <span className="line-clamp-2 min-h-[2lh] text-left">
        <Highlighted text={hitLabel(hit)} query={query} />
      </span>
      {hint ? <span className="truncate text-muted-foreground">{hint}</span> : null}
    </>
  );
}
