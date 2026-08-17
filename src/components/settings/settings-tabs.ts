import {
  ColorsIcon,
  LockKeyIcon,
  MagicWand01Icon,
  Notification03Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

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
    hint: "Theme",
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
