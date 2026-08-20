import { ogFonts } from "./fonts";
export function probe() {
  return { fonts: ogFonts().map((f) => [f.name, f.weight, f.data.byteLength]) };
}
