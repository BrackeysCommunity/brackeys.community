import { sha256 } from "../project/hash";
import { byCodeUnit } from "../project/kinds/define";
import type { ReleaseManifest } from "../project/release";
import type { AssetId } from "../project/types";
import { makeIssue } from "../scene/issues";
import { StandaloneBootError } from "./errors";

/** What the host fetches with: `fetch`, or a stand-in that answers a URL. */
export type FetchText = (url: string) => Promise<Response>;

/**
 * `path` resolved against `base`, the manifest's own URL. Refused with
 * `schema` when it would leave the manifest's directory: a released game
 * never requests anything outside its build.
 */
export function releaseUrl(base: URL, path: string): URL {
  const url = new URL(path, base);
  const dir = new URL(".", base).href;
  if (!url.href.startsWith(dir) || url.href === dir)
    throw new StandaloneBootError([
      makeIssue("schema", {
        message: `"${path}" resolves to ${url.href}, outside the build at ${dir}`,
        expected: `a path under ${dir}`,
        got: path,
      }),
    ]);
  return url;
}

/** The text at `path`, relative to `base`; a failed request is `export-asset-missing`. */
export async function fetchText(base: URL, path: string, fetchFn: FetchText): Promise<string> {
  const url = releaseUrl(base, path);
  let response: Response;
  try {
    response = await fetchFn(url.href);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new StandaloneBootError([
      makeIssue("export-asset-missing", {
        message: `couldn't fetch the build's "${path}": ${detail}`,
        got: path,
      }),
    ]);
  }
  if (!response.ok)
    throw new StandaloneBootError([
      makeIssue("export-asset-missing", {
        message: `the build has no "${path}" (HTTP ${response.status})`,
        got: path,
      }),
    ]);
  return response.text();
}

/**
 * Fetches the doc texts a boot needs (the runtime view's docs and every
 * listed scene and prefab), in parallel, each resolved against `base`, the
 * manifest's own URL. The manifest ships exactly those docs, so every doc
 * asset is fetched, each file once. A text that doesn't hash to its pin is
 * `hash-mismatch`: a stale cache served a file of another build.
 */
export async function fetchReleaseTexts(
  m: ReleaseManifest,
  base: URL,
  fetchFn: FetchText,
): Promise<Map<AssetId, string>> {
  const docs = Object.keys(m.assets)
    .sort(byCodeUnit)
    .filter((id) => m.assets[id]!.storage === "doc");
  const byFile = new Map<string, Promise<string>>();
  for (const id of docs) {
    const { file } = m.assets[id]!;
    if (!byFile.has(file)) byFile.set(file, fetchText(base, file, fetchFn));
  }
  const texts = await Promise.all(
    docs.map(async (id): Promise<[AssetId, string]> => {
      const asset = m.assets[id]!;
      const text = await byFile.get(asset.file)!;
      const got = await sha256(text);
      if (got !== asset.sha256)
        throw new StandaloneBootError([
          makeIssue("hash-mismatch", {
            message: `"${asset.file}" (${id}) hashes to ${got}, not ${asset.sha256} as release.json pins it; reload to fetch this build's copy`,
            entityIds: [id],
            expected: asset.sha256,
            got,
          }),
        ]);
      return [id, text];
    }),
  );
  return new Map(texts);
}
