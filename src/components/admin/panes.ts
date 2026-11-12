/**
 * The pane names the two folded admin sections carry in the URL.
 *
 * Their own module because `/admin`'s `validateSearch` needs them, and
 * search validation runs in the route shell — importing them from the pane
 * components pulled `AdminSpotlight` and `AdminTaxonomy`, and everything
 * they import, into the root preload graph for every visitor.
 */
export const SPOTLIGHT_PANES = ["featured", "hero"] as const;
export type SpotlightPane = (typeof SPOTLIGHT_PANES)[number];

export const TAXONOMY_PANES = ["skills", "roles"] as const;
export type TaxonomyPane = (typeof TAXONOMY_PANES)[number];

/**
 * The hosted games' moderation section: its reports, first-public reviews
 * and flagged release images. Listed only while `engine-games-enabled` is
 * on for the viewer and `engineGamesAllowed()` holds.
 */
export const ENGINE_GAMES_SECTION = "games" as const;
