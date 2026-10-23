import type { LinkOptions } from "@tanstack/react-router";

import { SPOTLIGHT_TARGETS, type SpotlightTarget } from "@/components/announcements/spotlight";
import type { FeatureFlagKey } from "@/lib/flags";

export interface Announcement {
  /** Keys this browser's history for it; change it to show a reworded banner again. */
  id: string;
  eyebrow?: string;
  title: string;
  body: string;
  cta: {
    label: string;
    link: LinkOptions;
    /** Lit while the CTA is hovered or focused. */
    spotlight?: SpotlightTarget;
  };
  /** Shown only while this flag is on for the viewer. */
  flag?: FeatureFlagKey;
  audience?: "everyone" | "signed-in";
  /** ISO date; the banner stops showing to anyone from then on. */
  until?: string;
  /**
   * How long one viewer keeps seeing it, counted from the first time this
   * browser showed it, so an ignored banner retires on its own. Defaults to
   * `DEFAULT_SHOW_FOR_DAYS`.
   */
  showForDays?: number;
  /** Path prefixes where the banner would only point at the page you're on. */
  hiddenOn?: string[];
}

export const DEFAULT_SHOW_FOR_DAYS = 14;

/** First eligible entry wins, so order is priority. */
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "canvases-launch",
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
  },
];
