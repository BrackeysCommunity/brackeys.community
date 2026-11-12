import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { siteUrl } from "@/env";
import type { PlayPayload } from "@/lib/engine/game-play";
import { SITE } from "@/lib/legal-meta";
import { cn } from "@/lib/utils";

import {
  PLAY_UNAVAILABLE_MESSAGE,
  playPath,
  refusalOf,
  useEngineGamesBlocked,
  useLocalPlayStores,
  usePlayQuery,
  type PlayUnavailableReason,
} from "./PlayChrome";
import { PlayFrame } from "./PlayFrame";

/** What `/embed/<version>` accepts: the live version or a version number, never the preview. */
export const EMBED_VERSION = /^(latest|[1-9]\d{0,8})$/;

/** The save menu's sentence in an embed, where saves live in the embedding site's partition. */
export const EMBED_SAVES_DESCRIBE = `Saves stay in this browser for this page until you clear its site data. Play on ${SITE.name} to keep them on your account.`;

const EMBEDDABLE = new Set<PlayPayload["visibility"]>(["public", "unlisted"]);

/**
 * The page's one control. It opens a new tab, so a page framing this one
 * can't trick a click into doing anything here.
 */
function OpenOnSite({ href, className }: { href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), className)}
    >
      <HugeiconsIcon icon={LinkSquare02Icon} data-icon="inline-start" />
      Open on {SITE.name}
    </a>
  );
}

/** In place of the frame: why it isn't here, and the way to the site. */
function EmbedUnavailable({ reason, href }: { reason: PlayUnavailableReason; href: string }) {
  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background p-6 text-center"
    >
      <Text as="p" size="sm" variant="muted" textWrap="pretty" className="max-w-md">
        {PLAY_UNAVAILABLE_MESSAGE[reason]}
      </Text>
      <OpenOnSite href={href} />
    </div>
  );
}

/**
 * `/games/<project>/embed/<version>`: the frame and its host channel with no
 * sign-in and no actions, for public and unlisted games on other sites. It
 * plays signed out, with saves in the embedding site's partition of this browser.
 */
export function EmbedFrame({ projectId, version }: { projectId: string; version: string }) {
  const blocked = useEngineGamesBlocked();
  const valid = EMBED_VERSION.test(version);
  const query = usePlayQuery(projectId, version, !blocked && valid);
  const stores = useLocalPlayStores(projectId, () => EMBED_SAVES_DESCRIBE);
  const href = siteUrl(playPath(projectId, valid ? version : "latest"));

  if (blocked || !valid) return <EmbedUnavailable reason="unavailable" href={href} />;
  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading the game" className="h-full w-full bg-black p-6">
        <Skeleton className="h-full w-full bg-white/5" />
      </div>
    );
  }
  if (query.isError) {
    const reason = refusalOf(query.error) ?? "unavailable";
    return <EmbedUnavailable reason={reason} href={href} />;
  }
  const play = query.data;
  if (!EMBEDDABLE.has(play.visibility))
    return <EmbedUnavailable reason="unavailable" href={href} />;

  return (
    <div className="relative h-full w-full bg-black">
      <PlayFrame
        frameUrl={play.frameUrl}
        title={play.title}
        release={{ id: play.release.id, gameId: play.release.gameId, projectId }}
        saveMode={play.saveMode}
        saves={stores.saves}
        describe={stores.describe}
        prefs={stores.prefs}
        offerDownloads={false}
      />
      <OpenOnSite href={href} className="absolute top-2 right-2 opacity-80 hover:opacity-100" />
    </div>
  );
}
