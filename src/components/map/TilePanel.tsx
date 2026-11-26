import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Island } from "@/components/canvas/shell/CanvasShell";
import { Button } from "@/components/ui/button";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";

import { FogSeen, type MapTileView } from "../../../packages/mmo-api/src/index.ts";
import { type TileContext, tileWords } from "../../../packages/mmo-words/src/index.ts";

/** The picked tile: its base, its fog state in words, and what is live on it. */
export function TilePanel({
  tile,
  at,
  onClose,
  className,
}: {
  tile: MapTileView | undefined;
  at: TileContext;
  onClose: () => void;
  className?: string;
}) {
  const w = tileWords(tile, at);
  return (
    <Island
      aria-label="Picked tile"
      className={className ?? "w-full flex-col items-stretch gap-2 self-start p-3"}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <MicroLabel as="div">{w.fogLine}</MicroLabel>
          <Heading as="h2" size="md" ellipsis>
            {w.title}
          </Heading>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close the tile"
          tooltip="Close"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </div>
      {w.base.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {w.base.map((line) => (
            <Text as="p" size="sm" key={line}>
              {line}
            </Text>
          ))}
        </div>
      ) : null}
      {w.age ? (
        <Text as="p" size="sm" variant="muted">
          {w.ageLine}
        </Text>
      ) : null}
      {w.live.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <MicroLabel as="div">{w.liveHeading}</MicroLabel>
          {w.live.map((line) => (
            <Text as="p" size="sm" key={line} className={w.fog === FogSeen ? "italic" : undefined}>
              {line}
            </Text>
          ))}
        </div>
      ) : null}
    </Island>
  );
}
