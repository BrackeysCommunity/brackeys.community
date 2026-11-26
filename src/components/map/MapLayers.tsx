import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Island } from "@/components/canvas/shell/CanvasShell";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MicroLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { isLayer, LAYERS, LIVE_LAYERS, type LayerId } from "../../../packages/mmo-map/src/index.ts";
import { MAP_LAYER_NAMES } from "../../../packages/mmo-words/src/index.ts";
import type { MapViewer } from "./use-live-map";

const BASE_LAYERS = LAYERS.filter((l) => !LIVE_LAYERS.includes(l));

/** Why a viewer without a character has no live layer to turn on. */
export const LIVE_OFF_WHY: Record<Exclude<MapViewer, "character">, string> = {
  anonymous:
    "Live layers show what your character and your guild can see right now. Sign in with Discord to see them.",
  player:
    "Live layers show what your character and your guild can see right now. You have no character in the world yet.",
};

function LayerGroup({
  ids,
  layers,
  onChange,
  disabled,
  label,
}: {
  ids: readonly LayerId[];
  layers: ReadonlySet<LayerId>;
  onChange: (next: ReadonlySet<LayerId>) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <ToggleGroup
      multiple
      orientation="vertical"
      spacing={1}
      aria-label={label}
      disabled={disabled}
      className="w-full flex-wrap"
      value={disabled ? [] : ids.filter((id) => layers.has(id))}
      onValueChange={(on) => {
        const next = new Set([...layers].filter((id) => !ids.includes(id)));
        for (const id of on) if (isLayer(String(id))) next.add(id as LayerId);
        onChange(next);
      }}
    >
      {ids.map((id) => (
        <ToggleGroupItem key={id} value={id} size="sm" className="justify-start rounded-md px-2">
          {MAP_LAYER_NAMES[id] ?? id}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * The layer toggles (GDD 4.11). Base layers are the same for everyone; live
 * layers carry what the viewer's character and guild can see, so a viewer
 * without one has them off, and the reason beside them.
 */
export function MapLayers({
  layers,
  onChange,
  viewer,
  className,
}: {
  layers: ReadonlySet<LayerId>;
  onChange: (next: ReadonlySet<LayerId>) => void;
  viewer: MapViewer;
  className?: string;
}) {
  const live = viewer === "character";
  return (
    <Island
      aria-label="Layers"
      className={cn("w-56 flex-col items-stretch gap-2 self-start p-2", className)}
    >
      <MicroLabel as="div" className="px-1">
        Base layers
      </MicroLabel>
      <LayerGroup ids={BASE_LAYERS} layers={layers} onChange={onChange} label="Base layers" />
      <div className="flex items-center justify-between px-1">
        <MicroLabel as="div">Live layers</MicroLabel>
        {live ? null : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Why live layers are off"
            tooltip={LIVE_OFF_WHY[viewer]}
            tooltipSide="right"
          >
            <HugeiconsIcon icon={InformationCircleIcon} size={12} />
          </Button>
        )}
      </div>
      <LayerGroup
        ids={LIVE_LAYERS}
        layers={layers}
        onChange={onChange}
        disabled={!live}
        label="Live layers"
      />
    </Island>
  );
}
