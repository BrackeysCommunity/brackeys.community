# Brand raster sources

The SVGs here are the sources for the committed rasters in `public/`. They
live outside `public/` on purpose — `public/` is served, and nothing should
be able to fetch the source of an icon.

| Source         | Output                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| `app-icon.svg` | `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png` |
| `favicon.svg`  | `public/favicon.ico` (16/32/48/64, packed by hand — see below)              |

**Social cards are not here.** `public/og/brackeys-card.png` is cut from the
live renderer, not from an SVG in this directory:

```bash
bun run og:card
```

That runs `src/lib/og/__tests__/fallback-card.test.ts` with `OG_DUMP` pointed
at `public/og`, so the committed fallback is by construction the same design
as everything `/og/<kind>/<id>.png` serves. Edit `src/lib/og/card.ts` and
re-run it. An earlier hand-drawn `og-card.svg` lived here and was deleted the
day the renderer landed — two sources for one card is how they drift.

The icons need only what macOS ships:

```bash
qlmanage -t -s 1024 -o /tmp scripts/brand/app-icon.svg
sips -z 512 512 /tmp/app-icon.svg.png --out public/icon-512.png
sips -z 192 192 /tmp/app-icon.svg.png --out public/icon-192.png
sips -z 180 180 /tmp/app-icon.svg.png --out public/apple-touch-icon.png
```

`favicon.svg` is a _separate_ source from `app-icon.svg` on purpose: it draws
the mark ~30% larger in the square, because at 16px the bracket gaps close up
and the mark reads as a plain diamond ring. The `.ico` itself is a container
of four PNGs; there is no packer on a stock Mac, so it is assembled with a
short Python script (`struct.pack` over the ICONDIR/ICONDIRENTRY headers).
Re-cut the PNGs with `sips` as above, then pack them.

The renderer's own fonts are elsewhere again — `src/lib/og/assets/*.ttf`,
Latin-subset static cuts of Rubik and JetBrains Mono from Google Fonts (both
OFL). Satori cannot read the woff2 the app ships, which is the whole reason
they exist as separate files.
