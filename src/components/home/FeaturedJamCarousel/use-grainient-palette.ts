import { useEffect, useState } from "react";

import { useThemeChartColors } from "@/lib/hooks/use-theme-chart-colors";

import { type JamLike, pickTwo } from "./helpers";

/**
 * Returns the two random theme colors that drive the colored Grainient
 * backdrop. Re-rolled every time the carousel lands on a non-photo jam
 * (auto-rotate, manual nav, swipe — they all flow through `index`), so
 * each viewing of a non-photo slide gets a fresh pair, even if the same
 * jam comes back around.
 */
export function useGrainientPalette(jams: JamLike[], index: number): [string, string] {
  const palette = useThemeChartColors();
  const [bgColors, setBgColors] = useState<[string, string]>(["#444444", "#222222"]);

  useEffect(() => {
    const current = jams[index];
    if (!current || current.bannerUrl) return;
    setBgColors(pickTwo(palette));
  }, [index, palette, jams]);

  return bgColors;
}
