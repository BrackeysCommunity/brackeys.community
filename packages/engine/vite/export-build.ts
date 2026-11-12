import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import { planContent } from "../export/content";
import {
  finishExport,
  type BuiltCode,
  type ContentPlan,
  type ExportInput,
  type ExportPlan,
} from "../export/plan";
import type { ContentStore } from "../project/content-store";
import { sha256 } from "../project/hash";
import { byCodeUnit } from "../project/kinds/define";
import {
  formatReleaseManifest,
  RELEASE_FILE,
  type ExportBudget,
  type ThirdPartyLicence,
} from "../project/release";

/** The id `index.html`'s script is built from. */
export const EXPORT_ENTRY_ID = "virtual:jams-export/main";
const RESOLVED_ENTRY_ID = `\0${EXPORT_ENTRY_ID}`;
/** The entry chunk's `[name]`. */
const ENTRY_NAME = "main";

/**
 * The build options an export needs, merged into Vite's config by the
 * plugin: the virtual entry as the only input, every bundler file under
 * `code/` named by content hash, no sourcemaps and no public dir copied.
 */
export type ExportBuildConfig = {
  publicDir: false;
  build: {
    sourcemap: false;
    copyPublicDir: false;
    rolldownOptions: {
      input: Record<string, string>;
      output: {
        entryFileNames: string;
        chunkFileNames: string;
        assetFileNames: string;
        sourcemap: false;
      };
    };
  };
};

/** The Vite plugin shape `createExportBuild` returns, typed structurally so `./vite` adds no peer. */
export type ExportPluginLike = {
  name: string;
  enforce?: "pre";
  apply?: "build";
  config(): ExportBuildConfig;
  configResolved(config: { root: string }): void;
  /** Plans what ships, so `load` knows whether the entry imports Rapier. */
  buildStart(): Promise<void>;
  resolveId(id: string): string | null;
  load(id: string): string | null;
  generateBundle(
    this: { emitFile(f: { type: "asset"; fileName: string; source: string | Uint8Array }): void },
    opts: unknown,
    bundle: Record<string, unknown>,
  ): Promise<void>;
};

export type ExportBuildOptions = {
  input: ExportInput;
  /** Absolute paths of the modules the project file names. */
  modules: { game: { path: string; export: string }; ui: { path: string; export: string } | null };
  /** Blobs by hash (dev: `fileContentStore`). */
  content: ContentStore;
  rapier: "standard" | "compat";
  budget?: Partial<ExportBudget>;
  /** Called with the finished plan, for the CLI's report. */
  onPlan?(plan: ExportPlan): void;
};

/** The entry the generated module boots from; a build resolves it like any `@jams/engine` import. */
const STANDALONE_ENTRY = "@jams/engine/standalone";

const RAPIER_PACKAGES = {
  standard: "@dimforge/rapier2d",
  compat: "@dimforge/rapier2d-compat",
} as const;

const posixPath = (path: string) => path.split("\\").join("/");
const isIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);

function moduleImport(local: string, mod: { path: string; export: string }): string {
  if (!isAbsolute(mod.path)) throw new Error(`export module "${mod.path}" isn't an absolute path`);
  if (mod.export !== "default" && !isIdentifier(mod.export))
    throw new Error(`"${mod.export}" isn't an export name ${mod.path} can have`);
  return importLine(`{ ${mod.export} as ${local} }`, posixPath(mod.path));
}

const importLine = (names: string, spec: string) => `import ${names} from ${JSON.stringify(spec)};`;
const dynamicImport = (spec: string) => `import(${JSON.stringify(spec)})`;

/** The text of `virtual:jams-export/main`: `bootStandalone` with the game, its UI and, only when a listed scene needs it, Rapier. */
export function exportEntrySource(
  modules: ExportBuildOptions["modules"],
  rapier: ExportBuildOptions["rapier"] | null,
): string {
  const lines = [
    importLine("{ bootStandalone }", STANDALONE_ENTRY),
    moduleImport("game", modules.game),
  ];
  if (modules.ui) lines.push(moduleImport("ui", modules.ui));
  const fields = [`root: document.getElementById("game")`, "game"];
  if (modules.ui) fields.push("ui");
  if (rapier === "standard")
    fields.push(`rapier: () => ${dynamicImport(RAPIER_PACKAGES.standard)}`);
  if (rapier === "compat")
    fields.push(
      `rapier: async () => {\n    const rapier = await ${dynamicImport(RAPIER_PACKAGES.compat)};\n    await rapier.init();\n    return rapier;\n  }`,
    );
  lines.push(`bootStandalone({\n  ${fields.join(",\n  ")},\n});`, "");
  return lines.join("\n");
}

// ─── The bundle ──────────────────────────────────────────

type Chunk = {
  fileName: string;
  code: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  moduleLengths: Record<string, number>;
};
type Asset = { fileName: string; source: string | Uint8Array };

function readBundle(bundle: Record<string, unknown>): { chunks: Chunk[]; assets: Asset[] } {
  const chunks: Chunk[] = [];
  const assets: Asset[] = [];
  for (const out of Object.values(bundle)) {
    const o = out as Record<string, unknown>;
    if (o.type === "chunk") {
      const modules = (o.modules ?? {}) as Record<string, { renderedLength?: number }>;
      const moduleLengths: Record<string, number> = {};
      for (const [id, m] of Object.entries(modules)) moduleLengths[id] = m.renderedLength ?? 0;
      chunks.push({
        fileName: String(o.fileName),
        code: String(o.code),
        isEntry: o.isEntry === true,
        facadeModuleId: typeof o.facadeModuleId === "string" ? o.facadeModuleId : null,
        moduleLengths,
      });
    } else if (o.type === "asset") {
      assets.push({ fileName: String(o.fileName), source: o.source as string | Uint8Array });
    }
  }
  chunks.sort((a, b) => byCodeUnit(a.fileName, b.fileName));
  assets.sort((a, b) => byCodeUnit(a.fileName, b.fileName));
  return { chunks, assets };
}

const byteLength = (source: string | Uint8Array) =>
  typeof source === "string" ? new TextEncoder().encode(source).length : source.length;

function assetRole(fileName: string): "style" | "wasm" {
  if (fileName.endsWith(".css")) return "style";
  if (fileName.endsWith(".wasm")) return "wasm";
  throw new Error(
    `the bundler emitted ${fileName}; an export's bundle holds only code, styles and wasm (assets ship through the project)`,
  );
}

const NODE_MODULES = "/node_modules/";

/** The installed package a module id lies in: its directory and name, or null outside node_modules. */
export function packageOfModule(id: string): { dir: string; name: string } | null {
  const bare = id.startsWith("\0") ? id.slice(1) : id;
  const path = posixPath(bare.split("?")[0]!);
  const at = path.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const rest = path.slice(at + NODE_MODULES.length).split("/");
  const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1] ?? ""}` : rest[0];
  if (!name || name.endsWith("/")) return null;
  return { dir: path.slice(0, at + NODE_MODULES.length) + name, name };
}

const NOTICE_FILES = ["license", "license.md", "copying"];

function noticeOf(dir: string): string | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const wanted of NOTICE_FILES) {
    const name = names.find((n) => n.toLowerCase() === wanted);
    if (name) return readFileSync(`${dir}/${name}`, "utf8").replace(/\r\n?/g, "\n");
  }
  return null;
}

function licenceField(pkg: Record<string, unknown>): string {
  const { license, licenses } = pkg;
  if (typeof license === "string" && license.length > 0) return license;
  if (license && typeof (license as { type?: unknown }).type === "string")
    return (license as { type: string }).type;
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((l) => (l as { type?: unknown })?.type)
      .filter((t): t is string => typeof t === "string" && t.length > 0);
    if (types.length > 0) return types.length === 1 ? types[0]! : `(${types.join(" OR ")})`;
  }
  return "NOASSERTION";
}

function readPackage(dir: string, name: string): ThirdPartyLicence {
  const file = `${dir}/package.json`;
  const pkg = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
    : {};
  return {
    package: typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : name,
    version: typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "unknown",
    licence: licenceField(pkg),
    notice: noticeOf(dir),
  };
}

/** Every package the chunks' module ids reach, with its version, licence and notice; sorted, one per name and version. */
export function thirdPartyOf(moduleIds: Iterable<string>): ThirdPartyLicence[] {
  const dirs = new Map<string, string>();
  for (const id of moduleIds) {
    const pkg = packageOfModule(id);
    if (pkg && !dirs.has(pkg.dir)) dirs.set(pkg.dir, pkg.name);
  }
  const found = new Map<string, ThirdPartyLicence>();
  for (const [dir, name] of [...dirs].sort(([a], [b]) => byCodeUnit(a, b))) {
    const licence = readPackage(dir, name);
    const key = `${licence.package}@${licence.version}`;
    if (!found.has(key)) found.set(key, licence);
  }
  return [...found.values()].sort(
    (a, b) => byCodeUnit(a.package, b.package) || byCodeUnit(a.version, b.version),
  );
}

async function builtCode(
  chunks: readonly Chunk[],
  assets: readonly Asset[],
  rapier: ExportBuildOptions["rapier"] | null,
): Promise<BuiltCode> {
  const files: BuiltCode["files"][number][] = [];
  for (const c of chunks)
    files.push({
      path: c.fileName,
      sha256: await sha256(c.code),
      bytes: byteLength(c.code),
      role: "code",
    });
  for (const a of assets)
    files.push({
      path: a.fileName,
      sha256: await sha256(a.source),
      bytes: byteLength(a.source),
      role: assetRole(a.fileName),
    });
  files.sort((a, b) => byCodeUnit(a.path, b.path));

  const entries = chunks.filter((c) => c.isEntry);
  const entry = entries.find((c) => c.facadeModuleId === RESOLVED_ENTRY_ID) ?? entries[0];
  if (!entry || (entries.length > 1 && entry.facadeModuleId !== RESOLVED_ENTRY_ID))
    throw new Error(`the bundle has no single entry chunk for ${EXPORT_ENTRY_ID}`);

  const moduleIds = chunks.flatMap((c) => Object.keys(c.moduleLengths));
  return {
    files,
    entry: entry.fileName,
    rapier: rapier === null ? null : rapierBuild(rapier, chunks, files),
    thirdParty: thirdPartyOf(moduleIds),
  };
}

function rapierBuild(
  rapier: ExportBuildOptions["rapier"],
  chunks: readonly Chunk[],
  files: BuiltCode["files"],
): NonNullable<BuiltCode["rapier"]> {
  const name = RAPIER_PACKAGES[rapier];
  let dir: string | null = null;
  let inlined = 0;
  for (const c of chunks)
    for (const [id, length] of Object.entries(c.moduleLengths)) {
      const pkg = packageOfModule(id);
      if (pkg?.name !== name) continue;
      dir ??= pkg.dir;
      inlined += length;
    }
  if (dir === null) throw new Error(`a listed scene needs Rapier, but the bundle holds no ${name}`);
  const { version } = readPackage(dir, name);
  if (rapier === "compat") return { package: name, version, file: null, bytes: inlined };
  const wasm = files.filter((f) => f.role === "wasm");
  const file = wasm.find((f) => /rapier/i.test(f.path)) ?? wasm[0];
  if (!file) throw new Error(`the bundle holds ${name} but no wasm file; is vite-plugin-wasm on?`);
  return { package: name, version, file: file.path, bytes: file.bytes };
}

const dirOf = (path: string) => posixPath(path).replace(/\/[^/]*$/, "");

/**
 * The directories a build's output must never name: the given ones and every
 * module's, reduced to the outermost (a path under one contains it).
 */
export function machineDirs(given: readonly string[], moduleIds: Iterable<string>): string[] {
  const dirs = new Set<string>();
  const add = (dir: string) => {
    if (isAbsolute(dir) && /[^/]\/[^/]/.test(dir)) dirs.add(dir.replace(/\/+$/, ""));
  };
  for (const dir of given) add(posixPath(dir));
  for (const id of moduleIds) if (!id.startsWith("\0")) add(dirOf(id.split("?")[0]!));
  const sorted = [...dirs].sort(byCodeUnit);
  return sorted.filter((dir, i) => !sorted.slice(0, i).some((outer) => dir.startsWith(outer)));
}

/** The first emitted text naming a machine directory, which would make the build depend on where it ran. */
function leakedPath(
  chunks: readonly Chunk[],
  assets: readonly Asset[],
  dirs: readonly string[],
): string | null {
  const texts = [
    ...chunks.map((c) => ({ fileName: c.fileName, text: c.code })),
    ...assets
      .filter((a) => a.fileName.endsWith(".css"))
      .map((a) => ({
        fileName: a.fileName,
        text: typeof a.source === "string" ? a.source : new TextDecoder().decode(a.source),
      })),
  ];
  for (const { fileName, text } of texts)
    for (const dir of dirs) if (text.includes(dir)) return `${fileName} contains ${dir}`;
  return null;
}

// ─── The plugin ──────────────────────────────────────────

/**
 * A Vite plugin that builds index.html's entry (`virtual:jams-export/main`)
 * and emits every planned file. `generateBundle` hashes the chunks, finishes
 * the plan, writes the shell, docs, blobs, icons and `release.json` beside
 * them, and hands the plan to `onPlan`.
 */
export function createExportBuild(opts: ExportBuildOptions): ExportPluginLike {
  let content: ContentPlan | null = null;
  let root: string | null = null;
  const planned = async () => (content ??= await planContent(opts.input));

  return {
    name: "jams-engine:export",
    enforce: "pre",
    apply: "build",
    config() {
      return {
        publicDir: false,
        build: {
          sourcemap: false,
          copyPublicDir: false,
          rolldownOptions: {
            input: { [ENTRY_NAME]: EXPORT_ENTRY_ID },
            output: {
              entryFileNames: "code/[name]-[hash].js",
              chunkFileNames: "code/[name]-[hash].js",
              assetFileNames: "code/[name]-[hash][extname]",
              sourcemap: false,
            },
          },
        },
      };
    },
    configResolved(config) {
      root = posixPath(config.root);
    },
    async buildStart() {
      await planned();
    },
    resolveId(id) {
      return id === EXPORT_ENTRY_ID ? RESOLVED_ENTRY_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ENTRY_ID) return null;
      if (!content) throw new Error(`${EXPORT_ENTRY_ID} loaded before the export was planned`);
      return exportEntrySource(opts.modules, content.needsRapier ? opts.rapier : null);
    },
    async generateBundle(output, bundle) {
      if ((output as { sourcemap?: unknown } | null)?.sourcemap)
        throw new Error("an export builds without sourcemaps");
      const plan = await planned();
      const outDir = (output as { dir?: unknown } | null)?.dir;
      const { chunks, assets } = readBundle(bundle);
      const maps = assets.filter((a) => a.fileName.endsWith(".map"));
      if (maps.length > 0) throw new Error(`an export ships no sourcemaps: ${maps[0]!.fileName}`);
      const dirs = machineDirs(
        [
          ...(root ? [root] : []),
          ...(typeof outDir === "string" ? [outDir] : []),
          dirOf(opts.modules.game.path),
          ...(opts.modules.ui ? [dirOf(opts.modules.ui.path)] : []),
        ],
        chunks.flatMap((c) => Object.keys(c.moduleLengths)),
      );
      const leak = leakedPath(chunks, assets, dirs);
      if (leak) throw new Error(`an export carries no absolute path: ${leak}`);

      const code = await builtCode(chunks, assets, plan.needsRapier ? opts.rapier : null);
      const result = await finishExport(plan, code, opts.input, opts.budget);
      const built = new Set(code.files.map((f) => f.path));
      const missing: string[] = [];
      for (const file of result.files) {
        const { source } = file;
        if (source.kind === "built") {
          if (!built.has(source.path)) missing.push(source.path);
          continue;
        }
        if (source.kind === "blob") {
          const bytes = await opts.content.get(source.sha256);
          if (!bytes) {
            missing.push(`${file.path} (blob ${source.sha256})`);
            continue;
          }
          this.emitFile({ type: "asset", fileName: file.path, source: bytes });
        } else {
          const bytes = source.kind === "text" ? source.text : source.bytes;
          this.emitFile({ type: "asset", fileName: file.path, source: bytes });
        }
      }
      if (missing.length > 0)
        throw new Error(`the export can't write ${missing.length} file(s): ${missing.join(", ")}`);
      this.emitFile({
        type: "asset",
        fileName: RELEASE_FILE,
        source: formatReleaseManifest(result.manifest),
      });
      opts.onPlan?.(result);
    },
  };
}
