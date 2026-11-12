import { checkItchLayout, ITCH_LIMITS, zipFiles } from "@jams/engine/export";

const text = (s: string) => new TextEncoder().encode(s);

export function itchUpload() {
  const files = [
    { path: "index.html", bytes: text("<!doctype html>\n") },
    { path: "code/main-1a2b3c.js", bytes: text("console.log('lane');\n") },
    { path: "release.json", bytes: text("{}\n") },
  ];
  const sizes = (list: typeof files) => list.map((f) => ({ path: f.path, bytes: f.bytes.length }));
  // Stored entries, sorted by path, at a fixed time: the input order and the clock don't matter.
  const zip = zipFiles(files);
  const again = zipFiles([...files].reverse());
  return {
    limits: ITCH_LIMITS,
    issues: checkItchLayout(sizes(files)).map((i) => i.message),
    // A folder zipped from its parent, with a Finder file beside it.
    nested: checkItchLayout([
      { path: "lane/index.html", bytes: 16 },
      { path: "lane/.DS_Store", bytes: 6148 },
    ]).map((i) => i.message),
    zipBytes: zip.length,
    sameZip: zip.length === again.length && zip.every((b, i) => b === again[i]),
  };
}
