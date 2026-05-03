import { useEffect, useState } from "react";

import { useAppTheme } from "@/lib/hooks/use-app-theme";

const CHART_VARS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];

function rgbStringToHex(input: string): string {
  const m = input.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return "#888888";
  const toHex = (s: string) => Number(s).toString(16).padStart(2, "0");
  return `#${toHex(m[1]!)}${toHex(m[2]!)}${toHex(m[3]!)}`;
}

/**
 * Reads the active theme's `--chart-1` … `--chart-5` CSS variables and
 * returns them as hex strings, refreshing whenever the theme changes.
 * Resolution is done by setting `color: var(--chart-N)` on a probe and
 * reading back the computed color, which normalizes oklch/hsl/hex inputs
 * to a consistent rgb(...) form.
 */
export function useThemeChartColors(): string[] {
  const { themeId } = useAppTheme();
  const [colors, setColors] = useState<string[]>([]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    document.body.appendChild(probe);
    const out: string[] = [];
    for (const v of CHART_VARS) {
      probe.style.color = `var(${v})`;
      out.push(rgbStringToHex(getComputedStyle(probe).color));
    }
    document.body.removeChild(probe);
    setColors(out);
  }, [themeId]);

  return colors;
}
