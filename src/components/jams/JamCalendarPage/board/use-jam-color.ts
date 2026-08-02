import { useThemeChartColors } from "@/lib/hooks/use-theme-chart-colors";
import { jamPaletteColors } from "@/lib/jam-palette";

import { type JamFromList, safeThemeColor } from "../helpers";

/**
 * The jam's display color: the real itch theme color (the host-chosen
 * page background, scraped from the jam page) when we have it,
 * otherwise a deterministic palette pick keyed by jam id. Every
 * board surface (row wash, card progress bar, imageless banner
 * fallback) draws from this one hook so a jam keeps a single colorway
 * everywhere it appears.
 */
export function useJamColor(jam: JamFromList): string {
  const palette = useThemeChartColors();
  return safeThemeColor(jam.themeColor) ?? jamPaletteColors(palette, jam.jamId)[0];
}

/** Two-stop gradient pair for imageless banner fallbacks — the theme
 * color shading toward black, or the deterministic palette pair. */
export function useJamGradient(jam: JamFromList): readonly [string, string] {
  const palette = useThemeChartColors();
  const theme = safeThemeColor(jam.themeColor);
  if (theme) return [theme, `color-mix(in srgb, ${theme} 55%, black)`] as const;
  return jamPaletteColors(palette, jam.jamId);
}
