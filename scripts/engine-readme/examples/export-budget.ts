import {
  DEFAULT_EXPORT_BUDGET,
  finishExport,
  formatBytes,
  planContent,
  resolveExportBudget,
} from "@jams/engine/export";

import { laneCode, laneInput } from "./export-plan";

export function budgets() {
  // The project file's `export.budget` overrides a default; a caller's override (the CLI's) comes last.
  const limits = resolveExportBudget(
    { totalBytes: 50 * 1024 * 1024 },
    { fileBytes: 8 * 1024 * 1024 },
  );
  return {
    defaults: Object.entries(DEFAULT_EXPORT_BUDGET).map(([k, v]) => `${k} ${formatBytes(v)}`),
    limits: Object.entries(limits).map(([k, v]) => `${k} ${formatBytes(v)}`),
  };
}

/** The lane against a first load of 4 KB: the plan is whole, with one error saying what to lower. */
export async function tightLane() {
  const input = await laneInput("web");
  const plan = await finishExport(await planContent(input), await laneCode(), input, {
    firstLoadBytes: 4096,
  });
  const over = plan.issues.filter((i) => i.code === "export-over-budget");
  return {
    over: plan.manifest.budget.over,
    measured: formatBytes(plan.manifest.budget.measured.firstLoadBytes),
    messages: over.map((i) => i.message),
    files: plan.files.length,
  };
}
