import type { ReleaseManifest } from "../project/release";
import { iconFile } from "./icons";
import { exportTarget } from "./targets";
import { WEB_MANIFEST_FILE } from "./web-manifest";

/** The page every build opens at. */
export const INDEX_HTML_FILE = "index.html";

/** Text for an HTML text node or a double-quoted attribute. */
export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** A build path as a relative URL: each segment percent-encoded, then escaped for an attribute. */
export const relativeHref = (path: string): string =>
  escapeHtml(path.split("/").map(encodeURIComponent).join("/"));

/**
 * `index.html`: the project's name as the title, a viewport meta, the
 * theme colour and the web manifest link when the build is a PWA, the
 * build's stylesheets and icons, `<div id="game">`, one module script for
 * `build.entry` and a `<noscript>` line. No inline script or style and no
 * absolute URL, so a strict CSP and any static host serve it unchanged.
 */
export function renderIndexHtml(m: ReleaseManifest, opts: { styles: readonly string[] }): string {
  const name = escapeHtml(m.project.name);
  const pwa = exportTarget(m.build.target)?.pwa ? m.pwa : null;
  const paths = new Set(m.build.files.map((f) => f.path));
  const head: string[] = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${name}</title>`,
  ];
  if (pwa) {
    head.push(`<meta name="theme-color" content="${escapeHtml(pwa.themeColor)}">`);
    head.push(`<link rel="manifest" href="${relativeHref(WEB_MANIFEST_FILE)}">`);
  }
  for (const size of [192, 512] as const) {
    const file = iconFile(size);
    if (paths.has(file))
      head.push(
        `<link rel="icon" type="image/png" sizes="${size}x${size}" href="${relativeHref(file)}">`,
      );
  }
  for (const style of opts.styles)
    head.push(`<link rel="stylesheet" href="${relativeHref(style)}">`);
  head.push(`<script type="module" src="${relativeHref(m.build.entry)}"></script>`);
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    ...head.map((line) => `  ${line}`),
    `</head>`,
    `<body>`,
    `  <div id="game"></div>`,
    `  <noscript>${name} needs JavaScript to run.</noscript>`,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n");
}
