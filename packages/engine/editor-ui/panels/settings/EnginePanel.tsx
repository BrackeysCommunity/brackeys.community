import { settingsRows } from "../../../editor/settings-model";
import { DEFAULT_GRAVITY, DEFAULT_PHYSICS, DEFAULT_TICK_RATE } from "../../../game/defaults";
import type { Registry } from "../../../game/types";
import { pxPerMetreOf } from "../../../game/units";
import { DEFAULT_RESOLUTION } from "../../../resolution";
import { FieldRow } from "../inspector/field-widgets";
import { DocGate } from "./DocGate";
import type { SettingsDoc } from "./settings-doc";
import { gameSettingsBlocks } from "./settings-schemas";
import { SettingsRows } from "./SettingsRows";

/** What each engine setting is when the project sets none: the game's, else the engine's. */
export function engineFallbacks(registry: Registry): Record<string, unknown> {
  const game = registry.game;
  const resolution = { ...DEFAULT_RESOLUTION, ...game?.resolution };
  return {
    "engine.physics": game?.world?.physics ?? DEFAULT_PHYSICS,
    "engine.gravity": game?.world?.gravity ?? DEFAULT_GRAVITY,
    "engine.tickRate": game?.time?.rate ?? DEFAULT_TICK_RATE,
    ...Object.fromEntries(
      Object.entries(resolution).map(([k, v]) => [`engine.resolution.${k}`, v]),
    ),
  };
}

const ORDER = ["physics", "gravity", "tickRate", "resolution"];
const rank = (name: string) => {
  const at = ORDER.indexOf(name);
  return at < 0 ? ORDER.length : at;
};

/**
 * The game-settings doc's `engine` block: physics, gravity in m/s², tick
 * rate and resolution, each over the game's. The game's px per metre is
 * its code's (`world.lengthUnit`), shown and not edited.
 */
export function EnginePanel({ doc, registry }: { doc: SettingsDoc; registry: Registry }) {
  const { engine } = gameSettingsBlocks(registry);
  return (
    <DocGate doc={doc} noun="game settings">
      {(value) => (
        <>
          <SettingsRows
            doc={doc}
            rows={settingsRows(engine, value.engine ?? {}, "engine", { registry }).sort(
              (a, b) => rank(a.name) - rank(b.name),
            )}
            fallbacks={engineFallbacks(registry)}
          />
          <FieldRow
            label="px per metre"
            hint="World metres to the resolution's virtual px, set by the game's code (world.lengthUnit)."
          >
            <span className="je-insp-line" aria-label="px per metre">
              {pxPerMetreOf(registry)} px/m
            </span>
          </FieldRow>
        </>
      )}
    </DocGate>
  );
}
