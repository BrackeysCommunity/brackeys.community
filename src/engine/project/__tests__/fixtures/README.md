# Asset fixtures

Tiny files for the header readers in `src/engine/project/inspect/` and the blob kinds in
`src/engine/project/kinds/`.
Every file here was generated for this repository from synthetic input (solid
colours, checkers, a sine tone); none is copied from anywhere. All are dedicated
to the public domain under [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/).

| File                      | Format                                                  | Contents                                                                                                                                         | Made with                                                                                |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `texture.png`             | PNG, RGBA 8-bit                                         | 12×10 checker                                                                                                                                    | a zlib PNG writer (Python)                                                               |
| `texture.jpg`             | JPEG, baseline, 4:2:0                                   | 20×14 gradient; DQT/DHT before SOF0                                                                                                              | `ffmpeg -i src.png -q:v 10 -pix_fmt yuvj420p -fflags +bitexact`                          |
| `texture.webp`            | WebP, lossy (`VP8 `)                                    | 18×6 gradient                                                                                                                                    | `cwebp -q 50 -metadata none` (libwebp 1.6.0)                                             |
| `texture-lossless.webp`   | WebP, lossless (`VP8L`)                                 | 12×10, from `texture.png`                                                                                                                        | `cwebp -lossless -metadata none`                                                         |
| `texture-alpha.webp`      | WebP, extended (`VP8X` + `ALPH` + `VP8 `)               | 9×7 with transparent pixels                                                                                                                      | `cwebp -q 50 -metadata none`                                                             |
| `texture.gif`             | GIF87a                                                  | 7×5, two-colour palette                                                                                                                          | assembled by hand (Python), LZW with fixed 3-bit codes                                   |
| `hero.png`, `hero.json`   | Aseprite sheet, JSON hash export                        | 4 frames of 8×8 in a 32×8 strip; tags `idle`, `walk` (ping-pong), `rewind` (reverse); slices `panel` (nine-slice centre) and `hitbox` (two keys) | PNG as above; JSON written in Aseprite 1.3's export format                               |
| `items.png`, `items.json` | TexturePacker atlas, JSON array export (PixiJS flavour) | 16×16; `coin` and `gem` with pivots, `panel` with nine-slice `borders`, animation `spin`                                                         | PNG as above; JSON written in TexturePacker's export format                              |
| `font.fnt`, `font_0.png`  | BMFont, text format, one page                           | line height 9, 4 glyphs on a 16×16 page                                                                                                          | written by hand; PNG as above                                                            |
| `tone.ogg`                | Ogg Vorbis, stereo, 22.05 kHz                           | 0.1 s, 440 Hz sine                                                                                                                               | `ffmpeg -f lavfi -i sine=440 -c:a vorbis -strict -2`                                     |
| `tone.wav`                | WAV, PCM unsigned 8-bit, mono, 8 kHz                    | 0.05 s, 440 Hz sine                                                                                                                              | Python's `wave` module                                                                   |
| `tone.mp3`                | MP3, MPEG-2.5 layer III, mono, 8 kHz, no ID3 tag        | 0.1 s, 440 Hz sine                                                                                                                               | `ffmpeg -f lavfi -i sine=440:sample_rate=8000 -c:a libmp3lame -b:a 8k -fflags +bitexact` |
| `tone.m4a`                | MPEG-4 audio (`ftyp` brand `M4A `), AAC, mono, 8 kHz    | 0.1 s, 440 Hz sine                                                                                                                               | `ffmpeg -f lavfi -i sine=440:sample_rate=8000 -c:a aac -b:a 16k -fflags +bitexact`       |
| `run.recording.json`      | `recording:v1`                                          | a 120-tick run on `kitchen-sink` with four input edges; hashes are placeholders                                                                  | written by hand                                                                          |

`inspect-digests.ts` runs every blob kind over these files and digests the results;
`inspect-digests-cli.ts` prints those digests, for the determinism test to compare
under Bun.

Readers only look at headers and JSON; the pixel and sample data are never
decoded, so the files only need to be valid enough for real tools to open.
