import { stableJson } from "../project/canonical";
import { byCodeUnit } from "../project/kinds/define";
import {
  INDEX_HTML_FILE,
  type ReleaseAsset,
  type ReleaseCredit,
  type ReleaseManifest,
} from "../project/release";
import type { AssetId, Licence } from "../project/types";
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import { escapeHtml, relativeHref } from "./html";

const LICENCE_FIELDS = (): readonly (keyof Licence)[] => [
  "spdx",
  "author",
  "source",
  "attribution",
];

/** The licence's recorded fields, in a fixed order; null when it records none. */
function recorded(licence: Licence | undefined): Licence | null {
  if (!licence) return null;
  const out: Licence = {};
  for (const key of LICENCE_FIELDS()) {
    const value = licence[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Shipped blobs grouped by identical licence, each group's assets sorted
 * and the groups by their first asset; the blobs with none are `missing`,
 * each with one `licence-missing` (warn). Docs are the project's own
 * writing and carry no licence of their own, so they aren't credited.
 */
export function assetCredits(assets: Readonly<Record<AssetId, ReleaseAsset>>): {
  credits: Omit<ReleaseManifest["credits"], "code">;
  issues: SceneIssue[];
} {
  const groups = new Map<string, { licence: Licence; assets: AssetId[] }>();
  const missing: AssetId[] = [];
  const issues: SceneIssue[] = [];
  for (const id of Object.keys(assets).sort(byCodeUnit)) {
    const asset = assets[id]!;
    if (asset.storage !== "blob") continue;
    const licence = recorded(asset.licence);
    if (licence === null) {
      missing.push(id);
      issues.push(
        makeIssue("licence-missing", {
          message: `"${id}" (${asset.path}) ships with no licence recorded; the credits page lists it under "No licence recorded"`,
          path: "/licence",
          entityIds: [id],
        }),
      );
      continue;
    }
    const key = stableJson(licence);
    const group = groups.get(key);
    if (group) group.assets.push(id);
    else groups.set(key, { licence, assets: [id] });
  }
  const credited: ReleaseCredit[] = [...groups.values()]
    .sort((a, b) => byCodeUnit(a.assets[0]!, b.assets[0]!))
    .map((g) => ({ assets: g.assets, ...g.licence }));
  return { credits: { assets: credited, missing }, issues };
}

/** An http(s) source is linked; anything else is a description. */
const isHttpUrl = (s: string): boolean => /^https?:\/\/[^\s"<>]+$/i.test(s);

function sourceHtml(source: string): string {
  if (!isHttpUrl(source)) return escapeHtml(source);
  return `<a href="${escapeHtml(source)}" rel="noreferrer">${escapeHtml(source)}</a>`;
}

const assetLabel = (m: ReleaseManifest, id: AssetId): string => {
  const asset = Object.hasOwn(m.assets, id) ? m.assets[id] : undefined;
  return escapeHtml(asset?.name ?? asset?.path ?? id);
};

function creditHtml(m: ReleaseManifest, credit: ReleaseCredit): string[] {
  const out = [`    <li>`];
  if (credit.attribution) out.push(`      <p>${escapeHtml(credit.attribution)}</p>`);
  const fields: [string, string][] = [];
  if (credit.author) fields.push(["Author", escapeHtml(credit.author)]);
  if (credit.source) fields.push(["Source", sourceHtml(credit.source)]);
  if (credit.spdx) fields.push(["Licence", escapeHtml(credit.spdx)]);
  if (fields.length > 0) {
    out.push(`      <dl>`);
    for (const [term, value] of fields) out.push(`        <dt>${term}</dt><dd>${value}</dd>`);
    out.push(`      </dl>`);
  }
  out.push(`      <ul>`);
  for (const id of credit.assets) out.push(`        <li>${assetLabel(m, id)}</li>`);
  out.push(`      </ul>`, `    </li>`);
  return out;
}

function packageHtml(pkg: ReleaseManifest["credits"]["code"][number]): string[] {
  return [
    `    <li>`,
    `      <h3>${escapeHtml(pkg.package)} ${escapeHtml(pkg.version)}</h3>`,
    `      <p>Licence: ${escapeHtml(pkg.licence)}</p>`,
    pkg.notice === null
      ? `      <p>The package ships no licence file.</p>`
      : `      <details><summary>Licence notice</summary><pre>${escapeHtml(pkg.notice)}</pre></details>`,
    `    </li>`,
  ];
}

/**
 * `credits.html`: the game's name, its assets grouped by licence (each
 * group's attribution, author, source, SPDX id and asset names), the
 * assets with no licence recorded, each shipped package with its notice,
 * and the engine's version, then a "Play the game" link to `index.html`
 * (it opens the game; a page reached from a running game's new tab is
 * closed to return). No script and no style, so it reads the same under
 * any CSP and in either colour scheme.
 */
export function renderCredits(m: ReleaseManifest): string {
  const name = escapeHtml(m.project.name);
  const { assets, missing, code } = m.credits;
  const body: string[] = [`  <h1>${name}: credits</h1>`, `  <section>`, `    <h2>Assets</h2>`];
  if (assets.length === 0) body.push(`    <p>No licensed assets ship with this game.</p>`);
  else
    body.push(
      `    <ul>`,
      ...assets.flatMap((c) => creditHtml(m, c).map((l) => `  ${l}`)),
      `    </ul>`,
    );
  body.push(`  </section>`);
  if (missing.length > 0)
    body.push(
      `  <section>`,
      `    <h2>No licence recorded</h2>`,
      `    <ul>`,
      ...missing.map((id) => `      <li>${assetLabel(m, id)}</li>`),
      `    </ul>`,
      `  </section>`,
    );
  body.push(`  <section>`, `    <h2>Code</h2>`);
  if (code.length === 0) body.push(`    <p>No third-party packages ship with this game.</p>`);
  else
    body.push(`    <ul>`, ...code.flatMap((p) => packageHtml(p).map((l) => `  ${l}`)), `    </ul>`);
  body.push(
    `  </section>`,
    `  <p>Made with @jams/engine ${escapeHtml(m.engine.version)}</p>`,
    `  <p><a href="${relativeHref(INDEX_HTML_FILE)}">Play the game</a></p>`,
  );
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `  <meta charset="utf-8">`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1">`,
    `  <meta name="color-scheme" content="light dark">`,
    `  <title>${name}: credits</title>`,
    `</head>`,
    `<body>`,
    ...body,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n");
}
