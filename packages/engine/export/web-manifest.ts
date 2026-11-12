import type { ReleaseManifest } from "../project/release";

/**
 * `app.webmanifest` from the manifest's `pwa`, every URL relative to the
 * manifest itself so the build installs from whatever directory serves it.
 * Throws for a manifest with no `pwa`: its target ships no web manifest.
 */
export function renderWebManifest(m: ReleaseManifest): string {
  const pwa = m.pwa;
  if (!pwa) throw new Error(`release of "${m.project.id}" has no pwa block to render`);
  const doc = {
    id: "./",
    name: pwa.name,
    short_name: pwa.shortName,
    start_url: "./",
    scope: "./",
    display: pwa.display,
    orientation: pwa.orientation,
    theme_color: pwa.themeColor,
    background_color: pwa.background,
    icons: [...pwa.icons]
      .sort((a, b) => a.size - b.size)
      .map((icon) => ({
        src: icon.file,
        sizes: `${icon.size}x${icon.size}`,
        type: "image/png",
        purpose: "any",
      })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
