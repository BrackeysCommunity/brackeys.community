import { Badge } from "@/components/ui/badge";
import { MicroLabel } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { APP_LOCALE } from "@/lib/format-date";
import { FORUM_KIND_LABEL } from "@/lib/forum-posts";
import { jamDateRange } from "@/lib/jam-links";
import type { SearchHit } from "@/lib/search-hits";

import { jamNextBoundary } from "./jam-boundary";
import { SearchArt } from "./SearchArt";
import { KIND_HEADING } from "./SearchHitRow";

/** The highlighted hit, larger — beside the list from `md` up. */
export function SearchPreview({ hit }: { hit: SearchHit }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-3">
      <MicroLabel>{KIND_HEADING[hit.kind]}</MicroLabel>
      <PreviewBody hit={hit} />
    </div>
  );
}

function PreviewBody({ hit }: { hit: SearchHit }) {
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
          <p className="text-muted-foreground">
            {jamNextBoundary(hit)?.long ?? jamDateRange(hit.startsAt, hit.endsAt)}
          </p>
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
