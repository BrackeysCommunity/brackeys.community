import { vi, type Mock } from "vite-plus/test";

import type { ProjectSession } from "../../../collab/index";
import type { AssetEntry, DocLayout } from "../../../project/index";
import type { SettingsDoc } from "../../panels/settings/settings-doc";

/** The project's game-settings file, as the settings panels open it. */
export const GAME_SETTINGS_ENTRY: AssetEntry = {
  key: "kset",
  id: "game-settings",
  kind: "game-settings",
  path: "game-settings.json",
  created: { at: 0, by: "seed" },
};

/** An open game-settings doc whose edits land and are recorded on `edit`. */
export function fakeSettingsDoc({
  value,
  layout,
  readOnly = null,
}: {
  value: Record<string, unknown>;
  layout: DocLayout;
  readOnly?: string | null;
}): SettingsDoc & { edit: Mock } {
  return {
    session: {} as ProjectSession,
    kind: "game-settings",
    entry: GAME_SETTINGS_ENTRY,
    docName: "asset:p.kset",
    value,
    layout,
    readOnly,
    edit: vi.fn(async () => true),
    create: vi.fn(async () => true),
  };
}
