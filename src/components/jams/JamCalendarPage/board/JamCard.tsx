import { Link as RouterLink } from "@tanstack/react-router";

import { JamWatchMarker } from "@/components/jams/JamWatchMarker";
import {
  MediaCardFloatingBadge,
  MediaCardTile,
  mediaCardClasses,
} from "@/components/ui/media-card";
import { Text } from "@/components/ui/typography";
import { jamLinkParams } from "@/lib/jam-links";

import type { JamFromList } from "../helpers";
import { JamBanner } from "./BannerMedia";
import { HostLine } from "./HostLine";
import { CardProgressStrip } from "./JamProgress";
import { MilestoneHeadline } from "./milestones";
import { SignalInline } from "./SignalStat";
import { useJamColor } from "./use-jam-color";

/**
 * Tile rendering of a jam for the shelf grids: banner on top (letterboxed
 * against the jam's itch theme color, like its own jam page), meta in the
 * middle, countdown + participation in the footer row, and the lifecycle
 * progress strip pinned to the bottom edge. Shares its shell — emboss,
 * hover lift, interaction cues — with the collab board's cards.
 */
export function JamCard({ jam, now }: { jam: JamFromList; now: Date }) {
  const color = useJamColor(jam);

  return (
    <MediaCardTile
      render={<RouterLink to="/jams/$jamSlug" params={jamLinkParams(jam)} data-hover-play-group />}
    >
      <div className={mediaCardClasses.media} style={{ backgroundColor: color }}>
        <JamBanner jam={jam} fit="contain" />
        {/* Over the art: a glanceable badge, not part of the description. It
            carries its own chip, so the banner needs no scrim under it. */}
        <MediaCardFloatingBadge>
          <SignalInline jam={jam} now={now} size="sm" />
        </MediaCardFloatingBadge>
        <JamWatchMarker jamId={jam.jamId} className="absolute top-2 left-2" />
      </div>
      <div data-emboss-reset className={mediaCardClasses.body}>
        <Text bold size="lg" className="line-clamp-2 leading-snug">
          {jam.title}
        </Text>
        <HostLine jam={jam} />
        <div className="mt-auto pt-1.5">
          <MilestoneHeadline jam={jam} now={now} compact />
        </div>
      </div>
      <CardProgressStrip jam={jam} now={now} />
    </MediaCardTile>
  );
}
