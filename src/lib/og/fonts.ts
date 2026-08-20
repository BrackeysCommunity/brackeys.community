/**
 * Satori needs ttf, otf or woff — never the woff2 the app's font packages
 * ship — and `?inline` puts the bytes in the server bundle rather than a
 * file it would have to find on disk. See `scripts/brand/README.md`.
 */
import monoMedium from "./assets/jetbrains-mono-latin-500.ttf?inline";
import rubikRegular from "./assets/rubik-latin-400.ttf?inline";
import rubikBold from "./assets/rubik-latin-700.ttf?inline";

function decodeDataUri(dataUri: string): ArrayBuffer {
  const comma = dataUri.indexOf(",");
  const binary = atob(dataUri.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 700;
  style: "normal";
}

let cached: OgFont[] | null = null;

export function ogFonts(): OgFont[] {
  cached ??= [
    { name: "Rubik", data: decodeDataUri(rubikRegular), weight: 400, style: "normal" },
    { name: "Rubik", data: decodeDataUri(rubikBold), weight: 700, style: "normal" },
    { name: "JetBrains Mono", data: decodeDataUri(monoMedium), weight: 500, style: "normal" },
  ];
  return cached;
}
