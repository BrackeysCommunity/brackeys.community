import { linkOptions } from "@tanstack/react-router";

import { forumPostLinkParams } from "@/lib/forum-posts";
import { jamLinkParams } from "@/lib/jam-links";
import { profileLinkParams } from "@/lib/profile-links";
import { projectLinkParams } from "@/lib/project-links";
import type { SearchHit } from "@/lib/search-hits";
import { teamLinkParams } from "@/lib/team-links";

/** A search hit as a typed route, for `navigate` and `preloadRoute`. */
export function hitLinkOptions(hit: SearchHit) {
  switch (hit.kind) {
    case "jam":
      return linkOptions({
        to: "/jams/$jamSlug",
        params: jamLinkParams({ jamId: hit.id, slug: hit.slug }),
      });
    case "entry":
      return linkOptions({
        to: "/projects/game/$gameId",
        params: { gameId: String(hit.gameId) },
        search: { jam: hit.jamId },
      });
    case "member":
      return linkOptions({
        to: "/profile/$userId",
        params: profileLinkParams({ id: hit.id, urlStub: hit.stub }),
      });
    case "team":
      return linkOptions({ to: "/teams/$teamId", params: teamLinkParams(hit) });
    case "collab":
      return linkOptions({ to: "/collab/$postId", params: { postId: String(hit.id) } });
    case "forum":
      return linkOptions({ to: "/forum/$postId", params: forumPostLinkParams(hit) });
    case "project":
      return linkOptions({ to: "/projects/$projectSlug", params: projectLinkParams(hit) });
  }
}
