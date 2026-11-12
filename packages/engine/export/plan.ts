import { SAVE_VERSION } from "../game/save-file";
import type { GameDefinition, Registry } from "../game/types";
import { sha256 } from "../project/hash";
import type { KindRegistry } from "../project/kinds";
import { byCodeUnit } from "../project/kinds/define";
import {
  checkReleaseManifest,
  releaseBuildHash,
  type ExportBudget,
  type ReleaseAsset,
  type ReleaseFile,
  type ReleaseManifest,
  type ReleaseScene,
  type ReleaseTarget,
  type ThirdPartyLicence,
} from "../project/release";
import { snapshotProject, type ProjectSnapshot } from "../project/snapshot";
import type {
  AssetEntry,
  AssetId,
  AssetKey,
  ProjectFile,
  ProjectView,
  Sha256,
} from "../project/types";
import { projectView } from "../project/view";
import { AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { INPUT_SCRIPT_VERSION } from "../scene/input-script";
import { makeIssue } from "../scene/issues";
import { RECORDING_VERSION } from "../scene/recording-schema";
import { SCENE_FORMAT_VERSION, type SceneIssue } from "../scene/types";
import { COLLAB_LAYOUT_VERSION, ENGINE_VERSION, REPLAY_ACROSS_PLATFORMS } from "../version";
import { budgetIssues, measureBudget, resolveExportBudget } from "./budget";
import { CREDITS_FILE, renderCredits } from "./credits";
import { INDEX_HTML_FILE, renderIndexHtml } from "./html";
import { defaultIconPng, planIcons } from "./icons";
import { renderServiceWorker, SERVICE_WORKER_FILE } from "./service-worker";
import { exportTarget } from "./targets";
import { renderWebManifest, WEB_MANIFEST_FILE } from "./web-manifest";

/** Everything an export is planned from. */
export type ExportInput = {
  project: ProjectFile;
  view: ProjectView;
  /** Canonical texts of every doc asset, by id. */
  texts: ReadonlyMap<AssetId, string>;
  kinds: KindRegistry;
  registry: Registry;
  game: GameDefinition;
  /** The project's game-settings `engine` block. */
  engine: Readonly<Record<string, unknown>>;
  target: ReleaseTarget;
  /** The snapshot taken at build time (`snapshotProject`). */
  snapshot: ProjectSnapshot;
};

/** Everything the bundler needs before it runs: what ships, and whether Rapier does. */
export type ContentPlan = {
  start: AssetId;
  scenes: readonly ReleaseScene[];
  projectBundle: ReleaseManifest["projectBundle"];
  assets: Readonly<Record<AssetId, ReleaseAsset>>;
  needsRapier: boolean;
  time: ReleaseManifest["time"];
  credits: Omit<ReleaseManifest["credits"], "code">;
  pwa: ReleaseManifest["pwa"];
  issues: readonly SceneIssue[];
};

/** The bundler's output, hashed. */
export type BuiltCode = {
  files: readonly {
    path: string;
    sha256: Sha256;
    bytes: number;
    role: "code" | "style" | "wasm";
  }[];
  entry: string;
  rapier: ReleaseManifest["build"]["rapier"];
  thirdParty: readonly ThirdPartyLicence[];
};

/** One file the export writes, and where its bytes come from. */
export type PlannedFile = {
  path: string;
  role: ReleaseFile["role"];
  source:
    | { kind: "blob"; sha256: Sha256 }
    | { kind: "text"; text: string }
    | { kind: "built"; path: string }
    /** Bytes the plan makes itself: the default icons. */
    | { kind: "bytes"; bytes: Uint8Array };
};

export type ExportPlan = {
  manifest: ReleaseManifest;
  files: readonly PlannedFile[];
  issues: readonly SceneIssue[];
};

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A planned file and its manifest row. */
type Planned = { file: PlannedFile; row: ReleaseFile };

async function textFile(path: string, role: ReleaseFile["role"], text: string): Promise<Planned> {
  return {
    file: { path, role, source: { kind: "text", text } },
    row: { path, sha256: await sha256(text), bytes: utf8(text).length, role },
  };
}

/** Every file but the shell's: the shipped docs and blobs, the built code, the icons. One file per path. */
async function contentFiles(
  content: ContentPlan,
  code: BuiltCode,
  input: ExportInput,
): Promise<Planned[]> {
  const out = new Map<string, Planned>();
  for (const id of Object.keys(content.assets).sort(byCodeUnit)) {
    const asset = content.assets[id]!;
    if (out.has(asset.file)) continue;
    if (asset.storage === "doc") {
      const text = input.texts.get(id);
      if (text === undefined) continue;
      out.set(asset.file, await textFile(asset.file, "data", text));
    } else {
      out.set(asset.file, {
        file: { path: asset.file, role: "asset", source: { kind: "blob", sha256: asset.sha256 } },
        row: { path: asset.file, sha256: asset.sha256, bytes: asset.bytes, role: "asset" },
      });
    }
  }
  for (const f of code.files)
    out.set(f.path, {
      file: { path: f.path, role: f.role, source: { kind: "built", path: f.path } },
      row: { path: f.path, sha256: f.sha256, bytes: f.bytes, role: f.role },
    });
  for (const icon of planIcons(input).icons) {
    if (icon.source.kind === "asset") {
      const { sha256: hash, bytes } = icon.source;
      out.set(icon.file, {
        file: { path: icon.file, role: "icon", source: { kind: "blob", sha256: hash } },
        row: { path: icon.file, sha256: hash, bytes, role: "icon" },
      });
    } else {
      const bytes = defaultIconPng(icon.size);
      out.set(icon.file, {
        file: { path: icon.file, role: "icon", source: { kind: "bytes", bytes } },
        row: { path: icon.file, sha256: await sha256(bytes), bytes: bytes.length, role: "icon" },
      });
    }
  }
  return [...out.values()];
}

/**
 * The snapshot of exactly what ships: the shipped entries of the project,
 * pinned the way `snapshotProject` pins a whole one, so `releaseSnapshot`
 * of the manifest reproduces its hash and a release pins only its own
 * blobs. A shipped asset whose pin differs from `input.snapshot`'s changed
 * after that snapshot was taken: `hash-mismatch`.
 */
async function shippedSnapshot(
  content: ContentPlan,
  input: ExportInput,
): Promise<{ snapshot: ProjectSnapshot; issues: SceneIssue[] }> {
  const assets: Record<AssetKey, AssetEntry> = {};
  for (const id of Object.keys(content.assets)) {
    const entry = input.view.byId.get(id);
    if (entry) assets[entry.key] = entry;
  }
  const view = projectView({ ...input.view.state, assets }, input.kinds);
  const snapshot = await snapshotProject(view, input.texts, input.view.state.build);
  const issues: SceneIssue[] = [];
  for (const id of Object.keys(snapshot.assets).sort(byCodeUnit)) {
    const was = Object.hasOwn(input.snapshot.assets, id) ? input.snapshot.assets[id] : undefined;
    const now = snapshot.assets[id]!;
    if (was?.sha256 === now.sha256) continue;
    issues.push(
      makeIssue("hash-mismatch", {
        message: was
          ? `"${id}" (${now.path}) is ${now.sha256} now, not ${was.sha256} as snapshot ${input.snapshot.hash} pins it`
          : `"${id}" (${now.path}) ships, but snapshot ${input.snapshot.hash} doesn't hold it`,
        entityIds: [id],
        ...(was ? { expected: was.sha256 } : {}),
        got: now.sha256,
      }),
    );
  }
  return { snapshot: { ...snapshot, at: 0 }, issues };
}

const byPath = (a: { path: string }, b: { path: string }) => byCodeUnit(a.path, b.path);

/**
 * Joins the content plan and the built code into the manifest and every
 * file to write, measures the budget and ends with `checkReleaseManifest`.
 * The shell files are rendered from the manifest before their own rows
 * are known: a renderer reads every path in `build.files`, never a shell
 * file's hash or size, nor the budget.
 */
export async function finishExport(
  content: ContentPlan,
  code: BuiltCode,
  input: ExportInput,
  budget?: Partial<ExportBudget>,
): Promise<ExportPlan> {
  const issues: SceneIssue[] = [...content.issues];
  const target = exportTarget(input.target);
  const pwa = target?.pwa ? content.pwa : null;
  const files = await contentFiles(content, code, input);
  const shellPaths: [string, ReleaseFile["role"]][] = [
    [INDEX_HTML_FILE, "shell"],
    [CREDITS_FILE, "shell"],
    ...(pwa
      ? ([
          [SERVICE_WORKER_FILE, "worker"],
          [WEB_MANIFEST_FILE, "shell"],
        ] as [string, ReleaseFile["role"]][])
      : []),
  ];
  const pending: ReleaseFile[] = shellPaths.map(([path, role]) => ({
    path,
    sha256: "0".repeat(64),
    bytes: 0,
    role,
  }));

  const pinned = await shippedSnapshot(content, input);
  issues.push(...pinned.issues);
  const limits = resolveExportBudget(input.project.export?.budget, budget);
  const manifestOf = async (rows: readonly ReleaseFile[]): Promise<ReleaseManifest> => {
    const sorted = [...rows].sort(byPath);
    return {
      kind: "release",
      v: 1,
      engine: {
        version: ENGINE_VERSION,
        agentSurface: AGENT_SURFACE_VERSION,
        formats: {
          scene: SCENE_FORMAT_VERSION,
          prefab: SCENE_FORMAT_VERSION,
          recording: RECORDING_VERSION,
          inputScript: INPUT_SCRIPT_VERSION,
          save: SAVE_VERSION,
          collabLayout: COLLAB_LAYOUT_VERSION,
        },
      },
      game: {
        id: input.game.id,
        configHash: input.game.configHash ?? null,
        saveVersion: input.game.saves?.version ?? null,
      },
      project: {
        id: input.project.id,
        name: input.project.name,
        snapshot: pinned.snapshot.hash,
        snapshotEngine: pinned.snapshot.engine,
        build: pinned.snapshot.build,
      },
      build: {
        hash: await releaseBuildHash(sorted),
        target: input.target,
        rapier: code.rapier,
        entry: code.entry,
        files: sorted,
      },
      time: content.time,
      replay: { acrossPlatforms: REPLAY_ACROSS_PLATFORMS },
      flow: { start: content.start, scenes: content.scenes },
      projectBundle: content.projectBundle,
      assets: content.assets,
      credits: {
        ...content.credits,
        code: [...code.thirdParty].sort(
          (a, b) => byCodeUnit(a.package, b.package) || byCodeUnit(a.version, b.version),
        ),
      },
      budget: measureBudget(sorted, content, limits),
      pwa,
    };
  };

  const draft = await manifestOf([...files.map((f) => f.row), ...pending]);
  const styles = code.files
    .filter((f) => f.role === "style")
    .map((f) => f.path)
    .sort(byCodeUnit);
  const rendered: Record<string, () => string> = {
    [INDEX_HTML_FILE]: () => renderIndexHtml(draft, { styles }),
    [CREDITS_FILE]: () => renderCredits(draft),
    [SERVICE_WORKER_FILE]: () => renderServiceWorker(draft),
    [WEB_MANIFEST_FILE]: () => renderWebManifest(draft),
  };
  for (const [path, role] of shellPaths) files.push(await textFile(path, role, rendered[path]!()));

  const rows = files.map((f) => f.row).sort(byPath);
  const manifest = await manifestOf(rows);
  issues.push(...budgetIssues(manifest.budget, manifest.build.files, content));
  if (target?.layout)
    issues.push(...target.layout(rows.map(({ path, bytes }) => ({ path, bytes }))));
  issues.push(...(await checkReleaseManifest(manifest, undefined, { measureBudget })));
  return { manifest, files: files.map((f) => f.file).sort(byPath), issues };
}
