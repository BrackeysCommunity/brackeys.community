import { Badge } from "@/components/ui/badge";
import { MicroLabel } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { APP_LOCALE } from "@/lib/format-date";
import { FORUM_KIND_LABEL } from "@/lib/forum-posts";
import { formatCountdown } from "@/lib/jam-countdown";
import { jamDateRange } from "@/lib/jam-links";
import type { RankedHit, SearchHit } from "@/lib/search-hits";

import { SearchArt } from "./SearchArt";
import { KIND_HEADING } from "./SearchHitRow";

type JamHit = Extract<SearchHit, { kind: "jam" }>;

/** The next boundary a jam is counting down to, in words. */
function jamCountdown(jam: JamHit): string | null {
  const next =
    jam.phase === "upcoming"
      ? { label: "Starts in", at: jam.startsAt }
      : jam.phase === "running"
        ? { label: "Submissions close in", at: jam.endsAt }
        : jam.phase === "voting"
          ? { label: "Voting ends in", at: jam.votingEndsAt }
          : null;
  const countdown = next ? formatCountdown(next.at) : null;
  if (next && countdown && !countdown.past) return `${next.label} ${countdown.text}`;
  return jamDateRange(jam.startsAt, jam.endsAt);
}

/** The highlighted hit, larger — beside the list from `md` up. */
export function SearchPreview({ hit }: { hit: RankedHit }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-3">
      <MicroLabel>{KIND_HEADING[hit.kind]}</MicroLabel>
      <PreviewBody hit={hit} />
    </div>
  );
}

function PreviewBody({ hit }: { hit: RankedHit }) {
  switch (hit.kind) {
    case "jam":
      return (
        <>
          <SearchArt hit={hit} fit="contain" />
          <p className="text-sm font-bold">{hit.title}</p>
          {hit.phase !== "archive" ? (
            <Badge size="label" variant="outline">
              {hit.phase.toUpperCase()}
            </Badge>
          ) : null}
          <p className="text-muted-foreground">{jamCountdown(hit)}</p>
          {hit.entriesCount ? (
            <p className="text-muted-foreground">
              {hit.entriesCount.toLocaleString(APP_LOCALE)} entries
            </p>
          ) : null}
        </>
      );
    case "entry":
      return (
        <>
          <SearchArt hit={hit} fit="contain" />
          <p className="text-sm font-bold">{hit.title}</p>
          {hit.author ? <p className="text-muted-foreground">by {hit.author}</p> : null}
          <p className="text-muted-foreground">{hit.jamTitle}</p>
        </>
      );
    case "member":
      return (
        <>
          <UserAvatar avatarUrl={hit.avatarUrl} username={hit.name} size={48} />
          <p className="text-sm font-bold">{hit.name}</p>
          {hit.stub ? <p className="text-muted-foreground">@{hit.stub}</p> : null}
          {hit.tagline ? <p>{hit.tagline}</p> : null}
        </>
      );
    case "team":
      return (
        <>
          <UserAvatar avatarUrl={hit.avatarUrl} username={hit.name} size={48} />
          <p className="text-sm font-bold">{hit.name}</p>
          {hit.recruiting ? (
            <Badge size="label" variant="success" className="w-fit">
              RECRUITING
            </Badge>
          ) : null}
          {hit.tagline ? <p>{hit.tagline}</p> : null}
        </>
      );
    case "collab":
      return (
        <>
          <p className="text-sm font-bold">{hit.title}</p>
          <p className="text-muted-foreground capitalize">
            {[hit.type, hit.status.replace("_", " ")].join(" · ")}
          </p>
          {hit.teamName ? <p className="text-muted-foreground">{hit.teamName}</p> : null}
        </>
      );
    case "forum":
      return (
        <>
          <Badge size="label" variant="outline" className="w-fit">
            {FORUM_KIND_LABEL[hit.postKind].toUpperCase()}
          </Badge>
          <p className="text-sm font-bold">{hit.title}</p>
          {hit.excerpt ? <p className="line-clamp-4 text-muted-foreground">{hit.excerpt}</p> : null}
          {hit.tags.length > 0 ? (
            <p className="text-muted-foreground">{hit.tags.map((t) => `#${t}`).join(" ")}</p>
          ) : null}
        </>
      );
    case "project":
      return (
        <>
          <SearchArt hit={hit} fit="contain" />
          <p className="text-sm font-bold">{hit.title}</p>
        </>
      );
  }
}
