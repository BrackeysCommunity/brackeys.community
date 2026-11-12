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
  /**
   * A module id suffix and the code appended to it, so the check can prove it
   * catches a leak. Defaults to `ENGINE_BUNDLE_INJECT` (JSON), which is how the
   * check reaches builds it starts through a CLI, such as `game build`.
   */
  inject?: { into: string; code: string };
};

/**
 * Writes every chunk's module ids per build environment, for
 * `scripts/engine-bundle-check.ts`. The root config adds it only when
 * `ENGINE_BUNDLE_REPORT` names an output directory; `game build` always adds
 * it, beside the export.
 */
export function engineBundleReport({ dir, inject = injectFromEnv() }: BundleReportOptions): Plugin {
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

function injectFromEnv(): BundleReportOptions["inject"] {
  const raw = process.env.ENGINE_BUNDLE_INJECT;
  return raw ? (JSON.parse(raw) as BundleReportOptions["inject"]) : undefined;
}
