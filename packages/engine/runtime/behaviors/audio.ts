import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import { AUDIO, type AudioBlock, type AudioHandle } from "../../game/behaviors/audio";
import type { JsonValue } from "../../game/types";

/** What the audio behavior's system answers by entity id; its handle reaches these. */
export type AudioBehaviorSystem = BehaviorSystem<AudioBlock> & {
  play(entityId: string): void;
  stop(entityId: string): void;
  playing(entityId: string): boolean;
};

/** The key an entity's `audio` sound plays under, which its `stop` names. */
export const audioVoiceKey = (entityId: string): string => `${entityId}#${AUDIO.name}`;

type Attached = { block: AudioBlock; playing: boolean };

const playsFromAttach = (block: AudioBlock): boolean => block.playing !== false;

/**
 * The `audio` behavior's system: presentation only, built with a view and
 * never headless, and it only writes presentation requests. Attach plays the
 * block's sound keyed by the entity (looping as the sound says, panned from
 * the entity's world pose when the sound is positional), detach stops it,
 * and a block change does both. The handle's `play` asks again each time, so
 * a one-shot replays. What the handle starts or stops is saved when it
 * differs from the block, so a world save or a live swap puts it back.
 */
export const createAudioBehaviorSystem: BehaviorSystemFactory = (ctx) => {
  const attached = new Map<string, Attached>();

  function start(id: string, a: Attached): void {
    a.playing = true;
    const volume = a.block.volume;
    ctx.present.audio.play(a.block.sound, {
      entity: id,
      key: audioVoiceKey(id),
      ...(volume !== undefined ? { volume } : {}),
    });
  }

  function halt(id: string, a: Attached): void {
    a.playing = false;
    ctx.present.audio.stop(audioVoiceKey(id));
  }

  function show(id: string, block: AudioBlock): void {
    const a: Attached = { block, playing: false };
    attached.set(id, a);
    if (playsFromAttach(block)) start(id, a);
  }

  function hide(id: string): void {
    const a = attached.get(id);
    if (!a) return;
    attached.delete(id);
    if (a.playing) halt(id, a);
  }

  const system: AudioBehaviorSystem = {
    attach: (id, block) => show(id, block),
    update(id, block) {
      hide(id);
      show(id, block);
    },
    detach: hide,
    play(id) {
      const a = attached.get(id);
      if (!a) return;
      if (a.playing) ctx.present.audio.stop(audioVoiceKey(id));
      start(id, a);
    },
    stop(id) {
      const a = attached.get(id);
      if (a?.playing) halt(id, a);
    },
    playing: (id) => attached.get(id)?.playing ?? false,
    save(id): JsonValue | undefined {
      const a = attached.get(id);
      if (!a || a.playing === playsFromAttach(a.block)) return undefined;
      return { playing: a.playing };
    },
    restore(id, state) {
      const a = attached.get(id);
      const playing =
        typeof state === "object" && state !== null && !Array.isArray(state)
          ? state.playing
          : undefined;
      if (!a || typeof playing !== "boolean" || a.playing === playing) return;
      if (playing) start(id, a);
      else halt(id, a);
    },
    handle: (id): AudioHandle => ({
      play: () => system.play(id),
      stop: () => system.stop(id),
      get playing() {
        return system.playing(id);
      },
    }),
    clear() {
      for (const id of [...attached.keys()]) hide(id);
    },
    size: () => attached.size,
  };
  return system as BehaviorSystem;
};
