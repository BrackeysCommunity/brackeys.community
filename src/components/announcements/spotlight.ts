import { Store } from "@tanstack/store";

/**
 * Elements a spotlight can point at. Tag the element with
 * `spotlightTarget(...)`; more than one element may share an id (the desktop
 * bar and the narrow-width menu), and the first one visible wins.
 */
export const SPOTLIGHT_TARGETS = {
  workspace: "workspace",
} as const;

export type SpotlightTarget = (typeof SPOTLIGHT_TARGETS)[keyof typeof SPOTLIGHT_TARGETS];

export const SPOTLIGHT_ATTR = "data-spotlight";
/** Stays undimmed while a spotlight is up — the surface that raised it. */
export const SPOTLIGHT_KEEP_ATTR = "data-spotlight-keep";

export function spotlightTarget(id: SpotlightTarget) {
  return { [SPOTLIGHT_ATTR]: id };
}

export const spotlightStore = new Store<SpotlightTarget | null>(null);

export function showSpotlight(id: SpotlightTarget): void {
  spotlightStore.setState(() => id);
}

/** Only clears `id`, so a late leave from one control can't cut off another's. */
export function hideSpotlight(id: SpotlightTarget): void {
  spotlightStore.setState((current) => (current === id ? null : current));
}
