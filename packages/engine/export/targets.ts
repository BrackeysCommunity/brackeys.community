import type { ReleaseTarget } from "../project/release";
import type { SceneIssue } from "../scene/types";
import { checkItchLayout } from "./itch";

/** Everything that differs between export targets. */
export type ExportTargetDef = {
  /** `sw.js` and `app.webmanifest` are planned (when `export.pwa` isn't false) and `manifest.pwa` is set. */
  pwa: boolean;
  /** Run over the planned files; its issues join the plan's. null: no check. */
  layout: ((files: readonly { path: string; bytes: number }[]) => SceneIssue[]) | null;
};

/**
 * The targets this engine builds, one row each: the only place a target's
 * name decides anything. A target with no row is `export-target-unsupported`.
 */
export const EXPORT_TARGETS: Readonly<Partial<Record<ReleaseTarget, ExportTargetDef>>> = {
  web: { pwa: true, layout: null },
  itch: { pwa: false, layout: checkItchLayout },
};

/** The target `game build` builds when none is given. */
export const DEFAULT_BUILD_TARGET: ReleaseTarget = "web";

/** The target `game export --zip` builds when none is given. */
export const DEFAULT_ZIP_TARGET: ReleaseTarget = "itch";

/** The targets with a row, in table order. */
export function exportTargetNames(): ReleaseTarget[] {
  return Object.keys(EXPORT_TARGETS) as ReleaseTarget[];
}

/** A target's row, or undefined when this engine doesn't build it. */
export function exportTarget(target: ReleaseTarget): ExportTargetDef | undefined {
  return Object.hasOwn(EXPORT_TARGETS, target) ? EXPORT_TARGETS[target] : undefined;
}
