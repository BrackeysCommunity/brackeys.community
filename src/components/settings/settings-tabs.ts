import {
  ColorsIcon,
  FloppyDiskIcon,
  LockKeyIcon,
  MagicWand01Icon,
  Notification03Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import { engineGamesAllowed } from "@/lib/engine/guard";
import { useFlag } from "@/lib/hooks/use-flag";

/** The `/settings` sections, in nav order. Shared with the header cog so
 * the menu's quick rows deep-link to the pane they summarise. */
export const SETTINGS_TABS = [
  "appearance",
  "motion",
  "notifications",
  "privacy",
  "account",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The sections stored in this browser rather than on an account. The rest
 * only have a signed-out notice to show, so surfaces that adapt to the
 * viewer — the header cog — offer these alone. */
export const LOCAL_SETTINGS_TABS: readonly SettingsTab[] = ["appearance", "motion"];

/** `to` is a literal so `Link` keeps its path type-checking. Each entry is
 * a real child route under the `/settings` layout — the pane swaps under a
 * nav that never unmounts. */
export const SETTINGS_TAB_META = {
  appearance: {
    label: "Appearance",
    hint: "Theme, language",
    icon: ColorsIcon,
    to: "/settings/appearance",
  },
  motion: {
    label: "Motion & sound",
    hint: "Animation, audio cues",
    icon: MagicWand01Icon,
    to: "/settings/motion",
  },
  notifications: {
    label: "Notifications",
    hint: "Email, in-app, digest",
    icon: Notification03Icon,
    to: "/settings/notifications",
  },
  privacy: {
    label: "Privacy",
    hint: "Wall notes, blocks",
    icon: LockKeyIcon,
    to: "/settings/privacy",
  },
  account: {
    label: "Account",
    hint: "Connections, devices",
    icon: UserIcon,
    to: "/settings/account",
  },
} as const satisfies Record<
  SettingsTab,
  { label: string; hint: string; icon: IconSvgElement; to: string }
>;

/** A section the nav lists only while its feature is on for the viewer. */
export type SettingsNavTab = SettingsTab | "game-saves";

export const SETTINGS_NAV_META = {
  ...SETTINGS_TAB_META,
  "game-saves": {
    label: "Game saves",
    hint: "Saves from games you play",
    icon: FloppyDiskIcon,
    to: "/settings/game-saves",
  },
} as const satisfies Record<
  SettingsNavTab,
  { label: string; hint: string; icon: IconSvgElement; to: string }
>;

/** Whether Settings → Game saves exists for this viewer on this deployment. */
export function useGameSavesSettings(): boolean {
  return useFlag("engine-games-enabled") && engineGamesAllowed();
}

/** The nav's sections, in order: `SETTINGS_TABS` plus the ones switched on. */
export function useSettingsNavTabs(): readonly SettingsNavTab[] {
  const gameSaves = useGameSavesSettings();
  if (!gameSaves) return SETTINGS_TABS;
  const at = SETTINGS_TABS.indexOf("account");
  return [...SETTINGS_TABS.slice(0, at), "game-saves", ...SETTINGS_TABS.slice(at)];
}
