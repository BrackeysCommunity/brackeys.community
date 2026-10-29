import type { LinkOptions } from "@tanstack/react-router";

import type { BannerArtKey } from "@/components/announcements/banner-art";
import { SPOTLIGHT_TARGETS, type SpotlightTarget } from "@/components/announcements/spotlight";
import type { FeatureFlagKey } from "@/lib/flags";

/** Who sees a banner and for how long; shared by every kind. */
interface BannerRules {
  /** Keys this browser's history for it; change it to show a reworded banner again. */
  id: string;
  /** Higher goes first within its collection. Ties keep registry order. */
  priority?: number;
  /** Shown only while this flag is on for the viewer. */
  flag?: FeatureFlagKey;
  audience?: "everyone" | "signed-in";
  /** ISO date; the banner stops showing to anyone from then on. */
  until?: string;
  /**
   * How long one viewer keeps seeing it, counted from the first time this
   * browser showed it, so an ignored banner retires on its own. Defaults to
   * `DEFAULT_SHOW_FOR_DAYS`; `Infinity` keeps it up until it's closed.
   */
  showForDays?: number;
  /** Path prefixes where the banner would only point at the page you're on. */
  hiddenOn?: string[];
  /** Kept off the mobile layout, for features phones can't use yet. */
  desktopOnly?: boolean;
}

export interface Announcement extends BannerRules {
  kind: "feature";
  art?: BannerArtKey;
  eyebrow?: string;
  title: string;
  body: string;
  cta: {
    label: string;
    link: LinkOptions;
    /** Lit while the CTA is hovered or focused. */
    spotlight?: SpotlightTarget;
  };
}

/** What the site stores and sends, said plainly. It asks for nothing: there is nothing to consent to. */
export interface CookieNotice extends BannerRules {
  kind: "cookie-notice";
}

export type Banner = Announcement | CookieNotice;

export interface BannerCollection {
  id: string;
  /** Higher collections are exhausted before lower ones get a turn. */
  priority: number;
  banners: readonly Banner[];
}

export const DEFAULT_SHOW_FOR_DAYS = 14;

export const NOTICES: Banner[] = [
  {
    kind: "cookie-notice",
    id: "cookie-notice",
    showForDays: Infinity,
    hiddenOn: ["/privacy", "/settings/privacy"],
  },
];

export const ANNOUNCEMENTS: Announcement[] = [
  {
    kind: "feature",
    id: "canvases-launch",
    art: "canvas",
    eyebrow: "NEW",
    title: "Canvases are here",
    body: "Sketch out plans, map your game, and work it through with your team on a shared board.",
    cta: {
      label: "Open canvases",
      link: { to: "/canvases" },
      spotlight: SPOTLIGHT_TARGETS.workspace,
    },
    flag: "canvases-enabled",
    audience: "signed-in",
    hiddenOn: ["/canvases"],
    desktopOnly: true,
  },
];

/** One banner shows at a time, so a first visit isn't greeted by a stack of them. */
export const BANNER_COLLECTIONS: BannerCollection[] = [
  { id: "notices", priority: 100, banners: NOTICES },
  { id: "announcements", priority: 0, banners: ANNOUNCEMENTS },
];
