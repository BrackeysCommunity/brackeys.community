import { settingsRows } from "../../../editor/settings-model";
import type { Registry } from "../../../game/types";
import { gameSettingsValues } from "../../../project/index";
import { DocGate } from "./DocGate";
import type { SettingsDoc } from "./settings-doc";
import { gameSettingsBlocks } from "./settings-schemas";
import { SettingsNote, SettingsRows } from "./SettingsRows";

const prefixed = (prefix: string, values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [`${prefix}.${k}`, v]));

/** The game-settings doc's `game` block: the fields the game's `projectSettings` declares. */
export function GeneralPanel({ doc, registry }: { doc: SettingsDoc; registry: Registry }) {
  const { game } = gameSettingsBlocks(registry);
  if (Object.keys(game.shape).length === 0) {
    return (
      <SettingsNote>
        {registry.game
          ? `The ${registry.id} game declares no project settings.`
          : "A project with no game has no game settings."}
      </SettingsNote>
    );
  }
  return (
    <DocGate doc={doc} noun="game settings">
      {(value) => (
        <SettingsRows
          doc={doc}
          rows={settingsRows(game, value.game ?? {}, "game", { registry })}
          fallbacks={prefixed("game", gameSettingsValues(registry, {}))}
        />
      )}
    </DocGate>
  );
}
