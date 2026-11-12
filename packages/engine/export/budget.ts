import type { ExportBudget, ExportBudgetReport, ReleaseFile } from "../project/release";
import type { AssetId } from "../project/types";
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import type { ContentPlan } from "./plan";

const MiB = 1024 * 1024;

/** The size budgets a build is held to unless the project file's `export.budget` overrides one. */
export const DEFAULT_EXPORT_BUDGET: ExportBudget = {
  codeBytes: 4 * MiB,
  firstLoadBytes: 16 * MiB,
  totalBytes: 100 * MiB,
  fileBytes: 32 * MiB,
};

/** What the budget reads of a content plan; a manifest's `flow`, `projectBundle` and `assets` give the same. */
export type BudgetContent = Pick<ContentPlan, "start" | "scenes" | "projectBundle" | "assets">;

/** One file counted against a budget, largest first in an issue. */
export type BudgetContributor = { path: string; bytes: number; asset?: AssetId };

function budgetKeys(): (keyof ExportBudget)[] {
  return ["codeBytes", "firstLoadBytes", "totalBytes", "fileBytes"];
}

/**
 * The limits a build is held to: the defaults, then each override in turn
 * (the project file's `export.budget`, then the caller's), skipping fields
 * an override leaves out.
 */
export function resolveExportBudget(
  ...overrides: readonly (Partial<ExportBudget> | undefined)[]
): ExportBudget {
  const limits = { ...DEFAULT_EXPORT_BUDGET };
  for (const override of overrides) {
    if (!override) continue;
    for (const key of budgetKeys()) {
      const value = override[key];
      if (value !== undefined) limits[key] = value;
    }
  }
  return limits;
}

/** A byte count as people read it: `512 B`, `14 KB`, `2.3 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MiB) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / MiB) * 10) / 10} MB`;
}

function isCode(file: ReleaseFile): boolean {
  return file.role === "code" || file.role === "style";
}

function startNeedsRapier(content: BudgetContent): boolean {
  return content.scenes.some((s) => s.id === content.start && s.physics === "rapier");
}

/**
 * The files the first frame waits for: code, wasm when the start scene
 * needs Rapier, the project bundle's and the start scene's blobs, and every
 * doc text (boot fetches the runtime view and the listed scenes). A bundle
 * entry whose file isn't in `files` counts at the asset's recorded size.
 */
function firstLoadFiles(
  files: readonly ReleaseFile[],
  content: BudgetContent,
): BudgetContributor[] {
  const rapier = startNeedsRapier(content);
  const counted = new Map<string, BudgetContributor>();
  for (const file of files) {
    if (isCode(file) || file.role === "data" || (rapier && file.role === "wasm")) {
      counted.set(file.path, { path: file.path, bytes: file.bytes });
    }
  }
  const byPath = new Map(files.map((f) => [f.path, f]));
  const start = content.scenes.find((s) => s.id === content.start);
  const entries = [...content.projectBundle.entries, ...(start?.bundle.entries ?? [])];
  for (const id of entries) {
    const asset = content.assets[id];
    if (!asset || counted.has(asset.file)) continue;
    counted.set(asset.file, {
      path: asset.file,
      bytes: byPath.get(asset.file)?.bytes ?? asset.bytes,
    });
  }
  return [...counted.values()];
}

function sum(items: readonly { bytes: number }[]): number {
  let total = 0;
  for (const item of items) total += item.bytes;
  return total;
}

function largest(files: readonly ReleaseFile[]): { path: string; bytes: number } {
  let best: { path: string; bytes: number } = { path: "", bytes: 0 };
  for (const file of files) {
    if (
      best.path === "" ||
      file.bytes > best.bytes ||
      (file.bytes === best.bytes && file.path < best.path)
    ) {
      best = { path: file.path, bytes: file.bytes };
    }
  }
  return best;
}

/**
 * The build's sizes by role against `limits`. `firstLoadBytes` is code,
 * plus wasm when the start scene needs Rapier, plus the project bundle, the
 * start scene's bundle and the data texts fetched at boot. `over` names each
 * budget exceeded, in `ExportBudget`'s order.
 */
export function measureBudget(
  files: readonly ReleaseFile[],
  content: BudgetContent,
  limits: ExportBudget,
): ExportBudgetReport {
  const ofRole = (role: ReleaseFile["role"]) => sum(files.filter((f) => f.role === role));
  const measured: ExportBudgetReport["measured"] = {
    codeBytes: sum(files.filter(isCode)),
    wasmBytes: ofRole("wasm"),
    firstLoadBytes: sum(firstLoadFiles(files, content)),
    assetBytes: ofRole("asset"),
    dataBytes: ofRole("data"),
    totalBytes: sum(files),
    largestFile: largest(files),
  };
  const size: ExportBudget = {
    codeBytes: measured.codeBytes,
    firstLoadBytes: measured.firstLoadBytes,
    totalBytes: measured.totalBytes,
    fileBytes: measured.largestFile.bytes,
  };
  return {
    limits: { ...limits },
    measured,
    over: budgetKeys().filter((key) => size[key] > limits[key]),
  };
}

const CONTRIBUTORS_NAMED = 3;

function contributorsTo(
  key: keyof ExportBudget,
  files: readonly ReleaseFile[],
  content: BudgetContent,
  limit: number,
): BudgetContributor[] {
  const all: BudgetContributor[] =
    key === "codeBytes"
      ? files.filter(isCode)
      : key === "firstLoadBytes"
        ? firstLoadFiles(files, content)
        : key === "fileBytes"
          ? files.filter((f) => f.bytes > limit)
          : [...files];
  const assetByFile = new Map<string, AssetId>();
  for (const id of Object.keys(content.assets).sort()) {
    const file = content.assets[id]?.file;
    if (file !== undefined && !assetByFile.has(file)) assetByFile.set(file, id);
  }
  return all
    .map(({ path, bytes }) => {
      const asset = assetByFile.get(path);
      return asset === undefined ? { path, bytes } : { path, bytes, asset };
    })
    .sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, CONTRIBUTORS_NAMED);
}

function whatToLower(path: string, files: readonly ReleaseFile[]): string {
  const role = files.find((f) => f.path === path)?.role;
  switch (role) {
    case "code":
    case "style":
      return "the code's";
    case "wasm":
      return "the wasm's";
    case "data":
      return "the doc's";
    case "asset":
    case "icon":
    case undefined:
      return "the asset's";
    default:
      return "the file's";
  }
}

/**
 * One `export-over-budget` per budget `report.over` names: the budget, the
 * measured size, the limit (the project's override already applied in
 * `report.limits`) and the largest contributors.
 */
export function budgetIssues(
  report: ExportBudgetReport,
  files: readonly ReleaseFile[],
  content: BudgetContent,
): SceneIssue[] {
  return report.over.map((key) => {
    const limit = report.limits[key];
    const measured = key === "fileBytes" ? report.measured.largestFile.bytes : report.measured[key];
    const contributors = contributorsTo(key, files, content, limit);
    const named = contributors
      .map((c) => `${c.path} ${formatBytes(c.bytes)}${c.asset ? ` (${c.asset})` : ""}`)
      .join(", ");
    const lower = contributors[0] ? whatToLower(contributors[0].path, files) : "the build's";
    return makeIssue("export-over-budget", {
      message: `${key} ${formatBytes(measured)} over ${formatBytes(limit)}${named ? `: ${named}` : ""}. Lower ${lower} size or raise export.budget.${key}.`,
      path: `/export/budget/${key}`,
      detail: { budget: key, measured, limit, contributors },
    });
  });
}
