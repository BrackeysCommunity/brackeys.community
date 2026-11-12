import { formatMetres } from "../../editor/gizmos/readout";
import type { LengthUnitName } from "../../scene/units";

export { formatBytes } from "../../export/budget";

/** Decimals a speed or an acceleration shows: the inspector steps them by 0.01. */
const RATE_DECIMALS = 2;

/**
 * A length in metres with its unit, to the decimals that show one world px
 * at `pxPerMetre`, as the canvas readouts print it: `3.25 m`, `4 m`.
 */
export function formatLength(m: number, pxPerMetre: number): string {
  return `${formatMetres(m, pxPerMetre)} m`;
}

/** A speed (or, with `"m/s²"`, an acceleration) with its unit, to hundredths: `4 m/s`. */
export function formatSpeed(value: number, unit: Exclude<LengthUnitName, "m"> = "m/s"): string {
  return `${String(Number(value.toFixed(RATE_DECIMALS)) + 0)} ${unit}`;
}

/** Any metric quantity with its unit: a length to one world px, a rate to hundredths. */
export function formatQuantity(value: number, unit: LengthUnitName, pxPerMetre: number): string {
  return unit === "m" ? formatLength(value, pxPerMetre) : formatSpeed(value, unit);
}
