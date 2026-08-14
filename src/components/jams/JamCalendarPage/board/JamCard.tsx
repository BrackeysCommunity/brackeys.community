import { motion } from "framer-motion";

import { JamWatchMarker } from "@/components/jams/JamWatchMarker";
import {
  MediaCardFloatingBadge,
  MediaCardScrim,
  mediaCardClasses,
} from "@/components/ui/media-card";
import { Text } from "@/components/ui/typography";

import type { JamFromList } from "../helpers";
import { JamBanner } from "./BannerMedia";
import { HostLine } from "./HostLine";
import { CardProgressStrip } from "./JamProgress";
import { MilestoneHeadline } from "./milestones";
import { SignalInline } from "./SignalStat";
import { ROW_CLOSE_TRANSITION } from "./transitions";
import { useJamColor } from "./use-jam-color";

/**
 * Tile rendering of a jam for the shelf grids: banner on top (letterboxed
 * against the jam's itch theme color, like its own jam page), meta in the
 * middle, countdown + participation in the footer row, and the lifecycle
 * progress strip pinned to the bottom edge.
 */
export function JamCard({
  jam,
  now,
  layoutKey,
  isSelected,
  onSelect,
}: {
  jam: JamFromList;
  now: Date;
  layoutKey: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const color = useJamColor(jam);

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      layoutId={`tl-row-${layoutKey}`}
      layout={false}
      transition={ROW_CLOSE_TRANSITION}
      style={{ opacity: isSelected ? 0 : 1, borderRadius: 8 }}
      className={`${mediaCardClasses.frame} cursor-pointer`}
    >
      <div className={mediaCardClasses.media} style={{ backgroundColor: color }}>
        <JamBanner jam={jam} layoutKey={layoutKey} fit="contain" />
        <MediaCardScrim />
        {/* Over the art rather than in the text block — the count is a
            glanceable badge, not part of the jam's description. */}
        <MediaCardFloatingBadge>
          <SignalInline jam={jam} now={now} size="sm" />
        </MediaCardFloatingBadge>
        <JamWatchMarker jamId={jam.jamId} className="absolute top-2 left-2" />
      </div>
      <div className={mediaCardClasses.body}>
        <Text bold size="lg" className="line-clamp-2 leading-snug">
          {jam.title}
        </Text>
        <HostLine jam={jam} />
        <div className="mt-auto pt-1.5">
          <MilestoneHeadline jam={jam} now={now} compact />
        </div>
      </div>
      <CardProgressStrip jam={jam} now={now} />
    </motion.button>
  );
}
