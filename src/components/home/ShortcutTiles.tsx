import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { Chonk } from "@/components/ui/chonk";
import { Text } from "@/components/ui/typography";

export interface ShortcutTile {
  label: string;
  stat: string;
  icon: IconSvgElement;
  /** A destination, for chips that leave the page. Mutually exclusive with
      `onClick` — a chip is either a link or a control, never both. */
  to?: string;
  onClick?: () => void;
  /** Override stat text styling — e.g. for non-numeric values that don't
      look right at the default 2xl size. */
  statClassName?: string;
}

interface ShortcutTilesProps {
  tiles: ShortcutTile[];
}

export function ShortcutTiles({ tiles }: ShortcutTilesProps) {
  return (
    <div className="-mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-1.5 overflow-x-auto py-3 pr-4 pl-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tiles.map((tile) => {
        const inner = (
          <div className="flex h-full items-center gap-2 px-3 py-2.5">
            <HugeiconsIcon icon={tile.icon} size={24} />
            <div className="flex flex-col gap-1">
              <Text size="xs" variant="muted" density="dense">
                {tile.label}
              </Text>
              <Text
                variant="accent"
                density="dense"
                className={tile.statClassName || "text-2xl leading-none"}
              >
                {tile.stat}
              </Text>
            </div>
          </div>
        );
        const render = tile.to ? (
          <Link to={tile.to} aria-label={tile.label} />
        ) : tile.onClick ? (
          <button type="button" onClick={tile.onClick} aria-label={tile.label} />
        ) : null;

        return render ? (
          <Chonk
            key={tile.label}
            variant="surface"
            size="lg"
            render={render}
            className="block w-auto min-w-36 shrink-0 snap-start text-left"
          >
            {inner}
          </Chonk>
        ) : (
          <Chonk
            key={tile.label}
            variant="surface"
            size="lg"
            className="block w-auto min-w-36 shrink-0 snap-start"
          >
            {inner}
          </Chonk>
        );
      })}
    </div>
  );
}
