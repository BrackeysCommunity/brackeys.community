/**
 * A frequency as the editor shows it: "440 Hz", "44.1 kHz"; `short` drops
 * the unit for a knob's face, "440" and "2.5k". Kilohertz keep at most two
 * decimals.
 */
export function formatHz(hz: number, { short = false }: { short?: boolean } = {}): string {
  if (hz < 1_000) return short ? String(hz) : `${hz} Hz`;
  const k = Number((hz / 1_000).toFixed(2));
  return short ? `${k}k` : `${k} kHz`;
}
