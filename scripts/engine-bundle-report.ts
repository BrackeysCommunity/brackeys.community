import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Plugin } from "vite-plus";

/** One output chunk and the source modules bundled into it. */
export type ReportedChunk = {
  fileName: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  imports: string[];
  dynamicImports: string[];
  /** Module ids with their rendered size in bytes. */
  modules: Record<string, number>;
};

export type BundleReportOptions = {
  /** Where each environment's report goes: `<dir>/<environment>.json`. */
  dir: string;
  /** A module id suffix and the code appended to it, so the check can prove it catches a leak. */
  inject?: { into: string; code: string };
};

/**
 * Writes every chunk's module ids per build environment, for
 * `scripts/engine-bundle-check.ts`. The root config adds it only when
 * `ENGINE_BUNDLE_REPORT` names an output directory.
 */
export function engineBundleReport({ dir, inject }: BundleReportOptions): Plugin {
  return {
    name: "engine-bundle-report",
    enforce: "pre",
    transform(code, id) {
      if (!inject || !id.split("?")[0]!.endsWith(inject.into)) return null;
      return { code: `${code}\n${inject.code}\n`, map: null };
    },
    generateBundle(_options, bundle) {
      const chunks: ReportedChunk[] = [];
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        chunks.push({
          fileName: out.fileName,
          isEntry: out.isEntry,
          isDynamicEntry: out.isDynamicEntry,
          imports: out.imports,
          dynamicImports: out.dynamicImports,
          modules: Object.fromEntries(
            Object.entries(out.modules).map(([id, m]) => [id, m.renderedLength]),
          ),
        });
      }
      const file = join(dir, `${this.environment.name}.json`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ chunks }, null, 1));
    },
  };
}
