import type { ProjectPeer } from "../../../../collab/index";
import type { AssetEntry, ProjectTreeNode } from "../../../../project/index";

export const PROJECT = "yard";

export function entry(key: string, path: string, kind: string, extra: Partial<AssetEntry> = {}) {
  const id = path.slice(path.lastIndexOf("/") + 1).replace(/\..*$/, "");
  return { key, id, kind, path, created: { at: 1, by: "ada" }, ...extra } satisfies AssetEntry;
}

export const level = entry("klevel", "scenes/level-1.json", "scene");
export const hero = entry("khero", "sprites/hero.png", "texture", {
  sha256: "a".repeat(64),
  bytes: 120,
});
export const jump = entry("kjump", "sfx/jump.ogg", "audio", {
  licence: { spdx: "CC0-1.0", author: "Ana" },
});
export const ice = entry("kice", "ice.material.json", "material");
export const gone = entry("kgone", "sprites/old.png", "texture", {
  deleted: { at: Date.now() - 60_000, by: "ada" },
});

export function tree(): ProjectTreeNode[] {
  return [
    {
      type: "folder",
      path: "scenes",
      children: [{ type: "asset", entry: level }],
    },
    { type: "folder", path: "sfx", children: [{ type: "asset", entry: jump }] },
    {
      type: "folder",
      path: "sprites",
      children: [{ type: "asset", entry: hero }],
    },
    {
      type: "folder",
      path: "src",
      children: [
        { type: "code", path: "src/game.ts", info: { registers: { types: ["crate", "door"] } } },
      ],
    },
    { type: "asset", entry: ice },
  ];
}

export function peer(id: string, name: string, doc: string | null, clientId: number): ProjectPeer {
  return { user: { id, name, color: "#000" }, doc, mode: "edit", clientId };
}
