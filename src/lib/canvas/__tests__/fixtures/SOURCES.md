# Fixture sources

All fetched 2026-09-29. "Obsidian-written" = tab-indented, one node per line, 16-hex ids (Obsidian's serializer signature).

| Fixture                          | Source (repo @ commit, path)                                                                                                                      | License           | Provenance                                                     | Covers                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jsoncanvas-sample.canvas`       | https://github.com/obsidianmd/jsoncanvas @ 456f843c, `sample.canvas`                                                                              | MIT (Obsidian.md) | Obsidian-written, official                                     | text, file (.md, .svg), group+label, preset color, left/right sides                                                                              |
| `obsidiantools-crazywall.canvas` | https://github.com/mfarragher/obsidiantools @ 2ee74d35, `tests/vault-stub/Crazy wall.canvas`                                                      | BSD-3-Clause      | Obsidian-written                                               | **all four node types**, preset + **hex** node color, preset edge color, edge label, **all four sides**, file node pointing at another `.canvas` |
| `quartz-test.canvas`             | https://github.com/saberzero1/quartz-themes @ 44dd8109, `runner/vault/theme-canvas/test-canvas.canvas`                                            | MIT               | **Hand-written** (ids like `node-text-1`)                      | all four node types, all four sides; non-hex ids                                                                                                 |
| `dvdd-movies.canvas`             | https://github.com/xDovos/Dataview-Deep-Dive @ 68a8dd79, `Canvas/Movie Canvas/Movies.canvas`                                                      | MIT               | Obsidian-written (type-first key order)                        | **file node with `subpath`** (`#To be Watched`), groups, preset colors                                                                           |
| `zk-links.canvas`                | https://github.com/groepl/Obsidian-Zettelkasten-Starter-Kit @ 42b46770, `Starter-Kit/5_Structure/Canvases/How to Use Links with Templates.canvas` | MIT               | Obsidian-written                                               | hex node colors, **hex edge colors**, `fromEnd: arrow`, edge labels, 10 groups, all four sides                                                   |
| `candy-stakeholder.canvas`       | https://github.com/TfTHacker/obsidian-canvas-candy @ 9e2b6a53, `Samples/Stakeholder Map.canvas`                                                   | MIT               | Obsidian-written                                               | many hex colors, **`toEnd: none`**                                                                                                               |
| `candy-db.canvas`                | same repo, `Samples/Database Structure Diagram.canvas`                                                                                            | MIT               | Obsidian-written                                               | `fromEnd: arrow` (bidirectional), all four sides, callout Markdown                                                                               |
| `candy-network.canvas`           | same repo, `Samples/Home Network.canvas`                                                                                                          | MIT               | Obsidian-written                                               | 14 **image file nodes** (.svg/.png/.jpg), edge colors + labels, `fromEnd: arrow`                                                                 |
| `jcv-demo.canvas`                | https://github.com/hesprs/json-canvas-viewer @ f4eb5bef, `packages/shared/src/demo.canvas`                                                        | MIT               | Re-serialized by Advanced Canvas (pretty-printed, edges first) | **plugin extension keys** (`styleAttributes` on nodes/edges, top-level `metadata`) — use to test unknown-key round-trip                          |
| `customframes.canvas`            | https://github.com/Ellpeck/ObsidianCustomFrames @ b59c07af, `test-vault/Untitled.canvas`                                                          | MIT               | Obsidian-written                                               | single link node (Google Calendar URL)                                                                                                           |
| `siyuan-large-talk.canvas`       | https://github.com/famotime/siyuan-canvas @ 32c176db, `docs/sample_canvas/关于说话的一切.canvas`                                                  | MIT               | Obsidian-written                                               | size fixture: 138 nodes (111 text, 27 groups), 109 edges, CJK text, inline `<font>` HTML in text                                                 |
| `siyuan-deductive-logic.canvas`  | same repo, `docs/sample_canvas/演绎逻辑.canvas`                                                                                                   | MIT               | Obsidian-written                                               | 24 edge labels, `toEnd: none`, nested groups ("未命名组" = default group label)                                                                  |

## Coverage vs. target

| Target                           | Covered by                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| text / file / link / group nodes | crazywall, quartz-test, jcv-demo                                                                                                                    |
| preset colors                    | most                                                                                                                                                |
| hex colors (node)                | crazywall, zk-links, candy-stakeholder                                                                                                              |
| hex colors (edge)                | zk-links                                                                                                                                            |
| all four sides                   | crazywall, quartz-test, zk-links, candy-db                                                                                                          |
| `fromEnd`                        | `arrow` only: zk-links, candy-db, candy-network. `fromEnd: none` explicit: **not found** (it's the default, Obsidian omits it)                      |
| `toEnd`                          | `none`: candy-stakeholder, siyuan-deductive-logic. `toEnd: arrow` explicit: not found (default, omitted)                                            |
| group with `background`          | **NOT COVERED** — only found in https://github.com/PKM-er/Blue-topaz-example (`60-Canvas/Home_middle.canvas`), which has **no license**; not copied |
| group `backgroundStyle`          | **NOT COVERED** — zero hits on Sourcegraph; synthesize from spec                                                                                    |
| file node with `subpath`         | dvdd-movies (heading subpath). Block subpath (`#^abc`) not found                                                                                    |
| file node → image / other canvas | candy-network (svg/png/jpg), crazywall (`.canvas`)                                                                                                  |
| unknown/plugin keys              | jcv-demo                                                                                                                                            |

Other licensed-unknown repos with interesting canvases (not copied): drshahizan/obsidian (subpaths), lakshyaag/Stanford-CS229 (subpath), PKM-er/Blue-topaz-example (group background).

## Synthetic fixtures

Written by hand from the JSON Canvas 1.0 spec for what no licensed file covers:

- `synthetic-spec-gaps.canvas`: group `background` + all `backgroundStyle` forms we
  accept, a block subpath (`#^block-1`), an empty text card, explicit default
  ends (`fromEnd: none`, `toEnd: arrow`), an edge with no sides, a hex group color.
- `synthetic-brackeys.canvas`: our `image` and `entity` node types as they're
  written to a vault, plus the top-level `brackeys` key.
