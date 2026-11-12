import { Rectangle, Texture, type TextureSource as PixiTextureSource } from "pixi.js";

import type { SpriteVisual } from "../context";
import type { Sha256 } from "../project/types";
import type { TextureSource } from "./pixi-view";

type Sampling = SpriteVisual["sampling"];
type Frame = NonNullable<SpriteVisual["frame"]>;

/** A source with the wanted scale mode: the loader's own, or a copy sharing its pixels. */
type Sampled = {
  key: string;
  base: Texture;
  source: PixiTextureSource;
  owned: boolean;
  users: number;
};
type Entry = {
  key: string;
  base: Texture;
  texture: Texture;
  owned: boolean;
  users: number;
  sampled: Sampled;
};

export type SpriteTextures = {
  /** `hash`'s `frame` sampled as asked, or null while it isn't loaded. Pair each with a `release`. */
  acquire(hash: Sha256, frame: Frame | undefined, sampling: Sampling): Texture | null;
  release(texture: Texture): void;
  /** Destroys every texture and source it made; the loader's own textures are left alone. */
  destroy(): void;
};

/**
 * Frame textures cached per hash, frame and sampling over a texture source.
 * Sampling lives on a Pixi source, so a hash drawn both nearest and linear
 * gets a second source over the same pixels. When the source hands out a
 * different texture for a hash (it was evicted and reloaded), new acquires
 * build fresh entries and the old ones live until released.
 */
export function createSpriteTextures(textures: TextureSource): SpriteTextures {
  const sources = new Map<string, Sampled>();
  const frames = new Map<string, Entry>();
  const byTexture = new Map<Texture, Entry>();

  function sampledSource(hash: Sha256, base: Texture, sampling: Sampling): Sampled {
    const key = `${hash}|${sampling}`;
    const cached = sources.get(key);
    if (cached && cached.base === base) {
      cached.users++;
      return cached;
    }
    const own = base.source;
    let source = own;
    let owned = false;
    if (own.scaleMode !== sampling) {
      const Ctor = own.constructor as new (o: object) => PixiTextureSource;
      source = new Ctor({
        ...(own as unknown as { options: object }).options,
        resource: own.resource,
        scaleMode: sampling,
      });
      owned = true;
    }
    const sampled: Sampled = { key, base, source, owned, users: 1 };
    sources.set(key, sampled);
    return sampled;
  }

  function dropSource(s: Sampled): void {
    if (--s.users > 0) return;
    if (sources.get(s.key) === s) sources.delete(s.key);
    if (s.owned) s.source.destroy();
  }

  return {
    acquire(hash, frame, sampling) {
      const base = textures.get(hash);
      if (!base) return null;
      const f = frame ? `${frame.x},${frame.y},${frame.w},${frame.h}` : "*";
      const key = `${hash}|${sampling}|${f}`;
      const cached = frames.get(key);
      if (cached && cached.base === base) {
        cached.users++;
        return cached.texture;
      }
      const sampled = sampledSource(hash, base, sampling);
      let texture = base;
      let owned = false;
      if (frame || sampled.owned) {
        const rect = frame ? new Rectangle(frame.x, frame.y, frame.w, frame.h) : base.frame.clone();
        texture = new Texture({ source: sampled.source, frame: rect });
        owned = true;
      }
      const entry: Entry = { key, base, texture, owned, users: 1, sampled };
      frames.set(key, entry);
      byTexture.set(texture, entry);
      return texture;
    },
    release(texture) {
      const entry = byTexture.get(texture);
      if (!entry || --entry.users > 0) return;
      byTexture.delete(texture);
      if (frames.get(entry.key) === entry) frames.delete(entry.key);
      if (entry.owned) entry.texture.destroy(false);
      dropSource(entry.sampled);
    },
    destroy() {
      for (const entry of byTexture.values()) if (entry.owned) entry.texture.destroy(false);
      for (const entry of byTexture.values()) {
        if (entry.sampled.owned && !entry.sampled.source.destroyed) entry.sampled.source.destroy();
      }
      frames.clear();
      sources.clear();
      byTexture.clear();
    },
  };
}
