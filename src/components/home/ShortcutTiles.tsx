import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

import { Chonk } from "@/components/ui/chonk";
import { Text } from "@/components/ui/typography";

export interface ShortcutTile {
  label: string;
  stat: string;
  icon: IconSvgElement;
  onClick?: () => void;
  /** Override stat text styling — e.g. for non-numeric values that don't
      look right at the default 2xl size. */
  statClassName?: string;
}

interface ShortcutTilesProps {
  tiles: ShortcutTile[];
}

export function ShortcutTiles({ tiles }: ShortcutTilesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setAtEnd(max <= 0 || el.scrollLeft >= max - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const scrollToEnd = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth - el.clientWidth, behavior: "smooth" });
  };

  return (
    <>
      <div className="-mb-5 flex items-center justify-between">
        <Text bold size="xs" variant="muted">
          Shortcuts
        </Text>
        <button
          type="button"
          onClick={scrollToEnd}
          aria-label="Scroll shortcuts to end"
          className={`text-muted-foreground transition-opacity duration-200 ${atEnd ? "pointer-events-none opacity-0" : "opacity-100"}`}
        >
          <HugeiconsIcon size="20" icon={ArrowDown01Icon} className="-rotate-90" />
        </button>
      </div>
      <div
        ref={scrollRef}
        className="-mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-1.5 overflow-x-auto py-3 pr-4 pl-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
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
          return tile.onClick ? (
            <Chonk
              key={tile.label}
              variant="surface"
              size="lg"
              render={<button type="button" onClick={tile.onClick} aria-label={tile.label} />}
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
    </>
  );
}
