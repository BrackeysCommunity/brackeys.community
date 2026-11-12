import type { BuildStamp, Sha256 } from "../project/types";

/**
 * A build time as ms since the epoch: a positive number, or a string of
 * digits or a date `Date.parse` reads (what `VITE_BUILD_AT` holds). Anything
 * else is 0, which loses every build-stamp tie to a dated build. Every side
 * that stamps or compares builds reads its build time through this, so a dev
 * server and the browser given the same raw value agree on it.
 */
export function buildAtFrom(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (typeof raw !== "string" || raw.trim() === "") return 0;
  const text = raw.trim();
  const at = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
  return Number.isFinite(at) && at > 0 ? at : 0;
}

/** Whether a build's stamp for a kind wins over `than`: the later build, then the larger hash. */
export function stampWins(buildAt: number, hash: Sha256, than: BuildStamp): boolean {
  return buildAt > than.buildAt || (buildAt === than.buildAt && hash > than.hash);
}
