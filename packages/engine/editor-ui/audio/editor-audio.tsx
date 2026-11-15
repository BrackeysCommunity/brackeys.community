import { PlayIcon, StopIcon } from "@hugeicons/core-free-icons";
import { Store } from "@tanstack/store";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { renderSynth, SYNTH_SAMPLE_RATE, synthDurationMs } from "../../audio/synth";
import type { AudioBackend, AudioClipHandle, BusName, Voice } from "../../audio/types";
import { webAudioBackend } from "../../audio/web-audio";
import { sameValue } from "../../project/canonical";
import { AUDIO_KIND } from "../../project/kinds/audio";
import { isPlainObject } from "../../project/kinds/define";
import { SOUND_KIND, type SoundFile } from "../../project/kinds/sound";
import { SYNTH_KIND, type SynthFile } from "../../project/kinds/synth";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import type { AssetId, ProjectView } from "../../project/types";
import { Rng } from "../../sim-kit/rng";
import type { GameInstance } from "../../types";
import { STORAGE_PREFIX, type EditorStorage } from "../host";
import { IconButton, type IconButtonProps } from "../kit/button";
import { useOptionalPending } from "../pending/use-pending";
import { readStored, storedFlag } from "../session/stored";
import { useStoreValue } from "../session/use-store-value";

/** Where an audition stands: its clip decoding, playing, or neither. */
export type AuditionStatus = "idle" | "decoding" | "playing";

export type AuditionOptions = {
  /** Cut it off after this many ms (a hover preview's first second). */
  maxMs?: number;
  /**
   * Only when the backend already exists: a hover or a field change isn't a
   * gesture, so it may not create or unlock one.
   */
  quiet?: boolean;
  /** Plays this patch for `id` instead of the project's copy (a patch panel's draft). */
  patch?: SynthFile;
};

/** What the editor's previews read of the project. */
export type EditorAudioSource = {
  /** Sounds, patches and clip info as the game reads them; null with no project open. */
  runtime(): ProjectRuntimeView | null;
  /** The project's assets, for a clip's length from its meta; null with no project open. */
  view(): ProjectView | null;
  /** An audio clip's bytes, through the host's blob URLs. */
  fetchClip(id: AssetId): Promise<ArrayBuffer>;
};

/** The editor's own audio: previews in the project tree, the inspector and the asset panels. */
export type EditorAudio = {
  /**
   * Plays an audio clip, a sound (a variant picked by weight, its bus,
   * volume and pitch) or a synth patch once, from the start, stopping what
   * `id` played before. The first call creates the backend, so it must run
   * in a click. Resolves true once the clip starts.
   */
  play(id: AssetId, opts?: AuditionOptions): Promise<boolean>;
  /** Stops `id`'s audition, or every one. */
  stop(id?: AssetId): void;
  /** Stops `id`'s audition only when a `quiet` call started it (a hover preview). */
  stopQuiet(id: AssetId): void;
  readonly statuses: Store<{ statuses: ReadonlyMap<AssetId, AuditionStatus> }>;
  /** Why `id` has nothing to play (a sound with no variants), or null. */
  silentReason(id: AssetId): string | null;
  /** How long `id` plays at its own pitch, ms: [shortest, longest] over a sound's variants; null when unknown. */
  lengthMs(id: AssetId): readonly [number, number] | null;
};

const EditorAudioSlot = createContext<EditorAudio | null>(null);

/** The pending scope an audition's decode runs in. */
export const auditionScope = (id: AssetId) => `audio:${id}`;

/** How long a stop or a cut-off fades, ms, so it doesn't click. */
const STOP_FADE_MS = 30;

const U32 = 0x1_0000_0000;

type Clip = { sha: string | undefined; clip: Promise<AudioClipHandle> };
type Playing = {
  token: number;
  quiet: boolean;
  voice: Voice | null;
  timer: ReturnType<typeof setTimeout> | null;
};
type Leaf = { kind: "patch"; doc: SynthFile } | { kind: "clip"; sha: string | undefined };
type Resolved = { id: AssetId; leaf: Leaf; bus: BusName; volume: number; rate: number };

const docOf = <T,>(runtime: ProjectRuntimeView | null, kind: string, id: AssetId): T | undefined =>
  runtime?.doc?.<T>(kind, id);

/** A clip's length from its meta, ms. */
function clipMs(view: ProjectView | null, id: AssetId): number | null {
  const meta = view?.byId.get(id)?.meta;
  return isPlainObject(meta) && typeof meta.durationMs === "number" ? meta.durationMs : null;
}

/** A clip's or a patch's length, ms; null for a sound or an unknown id. */
function leafMs(source: EditorAudioSource, id: AssetId): number | null {
  const patch = docOf<SynthFile>(source.runtime(), SYNTH_KIND, id);
  return patch ? synthDurationMs(patch) : clipMs(source.view(), id);
}

/** "0.42 s", "12.0 s", "1:05": a clip's or a sound's length. */
export function formatClipLength(ms: number): string {
  if (ms >= 60_000) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  return ms < 10_000 ? `${(ms / 1000).toFixed(2)} s` : `${(ms / 1000).toFixed(1)} s`;
}

/** `[min, max]` as words: one length, or "0.20–0.50 s". */
export function formatLengthRange([min, max]: readonly [number, number]): string {
  if (min === max) return formatClipLength(min);
  const lo = formatClipLength(min);
  const hi = formatClipLength(max);
  return lo.endsWith(" s") && hi.endsWith(" s") ? `${lo.slice(0, -2)}–${hi}` : `${lo}–${hi}`;
}

/**
 * The editor's audio previews over one backend of their own, created on
 * the first `play` (a click, so the browser lets it start) and closed when
 * the provider unmounts. `backend` is for tests; hosts leave it out.
 */
export function EditorAudioProvider({
  source,
  backend: makeBackend,
  children,
}: {
  source: EditorAudioSource;
  backend?: () => AudioBackend;
  children: ReactNode;
}) {
  const pending = useOptionalPending();
  const [audio] = useState(() => createEditorAudio({ source, makeBackend, pending }));
  useEffect(() => {
    audio.retarget({ source, makeBackend, pending });
  });
  useEffect(() => {
    audio.open();
    return () => audio.close();
  }, [audio]);
  return <EditorAudioSlot.Provider value={audio}>{children}</EditorAudioSlot.Provider>;
}

/** The editor's audio, or null outside an `EditorAudioProvider` (no play buttons then). */
export function useEditorAudio(): EditorAudio | null {
  return useContext(EditorAudioSlot);
}

const NO_STATUSES = new Store<{ statuses: ReadonlyMap<AssetId, AuditionStatus> }>({
  statuses: new Map(),
});

/** One asset's audition status, re-rendering as it changes; "idle" outside a provider. */
export function useAuditionStatus(id: AssetId): AuditionStatus {
  const audio = useEditorAudio();
  return useStoreValue(audio?.statuses ?? NO_STATUSES, (s) => s.statuses.get(id) ?? "idle");
}

/** How long the pointer rests on a row before it previews. */
export const HOVER_PREVIEW_DELAY_MS = 400;
/** How much of a clip a hover preview plays. */
export const HOVER_PREVIEW_MS = 1000;

/**
 * Play, or Stop while it plays; busy, saying "Decoding", until the clip
 * starts. Disabled with the reason when there's nothing to play; nothing
 * outside an `EditorAudioProvider`.
 */
export function AuditionButton({
  id,
  name,
  size = "icon-xs",
  variant,
  patch,
}: {
  id: AssetId;
  /** What the accessible name calls it: "Play <name>". */
  name: string;
  size?: IconButtonProps["size"];
  variant?: IconButtonProps["variant"];
  /** Plays this patch for `id` instead of the project's copy. */
  patch?: SynthFile;
}) {
  const audio = useEditorAudio();
  const status = useAuditionStatus(id);
  if (!audio) return null;
  const silent = audio.silentReason(id);
  const label =
    status === "decoding"
      ? `Decoding ${name}`
      : status === "playing"
        ? `Stop ${name}`
        : `Play ${name}`;
  return (
    <IconButton
      size={size}
      {...(variant ? { variant } : {})}
      icon={status === "playing" ? StopIcon : PlayIcon}
      label={label}
      tooltip={
        silent ?? (status === "decoding" ? "Decoding" : status === "playing" ? "Stop" : "Play")
      }
      busy={status === "decoding"}
      disabled={silent !== null}
      cue={null}
      data-audition={status}
      onClick={(e) => {
        e.stopPropagation();
        if (status === "playing") audio.stop(id);
        else void audio.play(id, patch ? { patch } : {});
      }}
    />
  );
}

/**
 * Pointer handlers that preview `id`'s first second once the pointer has
 * rested on the element for `HOVER_PREVIEW_DELAY_MS`, and stop it when the
 * pointer leaves. A preview needs the backend a click made: hovering
 * creates none.
 */
export function useHoverPreview(id: AssetId | null) {
  const audio = useEditorAudio();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  if (!audio || id === null) return {};
  return {
    onPointerEnter: (e: { pointerType?: string }) => {
      cancel();
      // A tap is not a hover: touch and pen open the row, they don't preview it.
      if (e.pointerType && e.pointerType !== "mouse") return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if ((audio.statuses.state.statuses.get(id) ?? "idle") !== "idle") return;
        void audio.play(id, { maxMs: HOVER_PREVIEW_MS, quiet: true });
      }, HOVER_PREVIEW_DELAY_MS);
    },
    onPointerLeave: () => {
      cancel();
      audio.stopQuiet(id);
    },
  };
}

type Latest = {
  source: EditorAudioSource;
  makeBackend: (() => AudioBackend) | undefined;
  pending: ReturnType<typeof useOptionalPending>;
};

function createEditorAudio(
  first: Latest,
): EditorAudio & { retarget(next: Latest): void; open(): void; close(): void } {
  const ref = { current: first };
  const statuses = new Store<{ statuses: ReadonlyMap<AssetId, AuditionStatus> }>({
    statuses: new Map(),
  });
  const clips = new Map<AssetId, Clip>();
  const patches = new Map<AssetId, { doc: SynthFile; clip: AudioClipHandle }>();
  const playing = new Map<AssetId, Playing>();
  const rng = Rng.from("editor-audition");
  let backend: AudioBackend | null = null;
  let tokens = 0;
  let closed = false;

  const setStatus = (id: AssetId, status: AuditionStatus) =>
    statuses.setState((s) => {
      if ((s.statuses.get(id) ?? "idle") === status) return s;
      const next = new Map(s.statuses);
      if (status === "idle") next.delete(id);
      else next.set(id, status);
      return { statuses: next };
    });

  const random = () => rng.nextU32() / U32;

  function pick(file: SoundFile): AssetId | undefined {
    let total = 0;
    for (const v of file.variants) total += v.weight ?? 1;
    let roll = random() * total;
    for (const v of file.variants) {
      roll -= v.weight ?? 1;
      if (roll < 0) return v.clip;
    }
    return file.variants.at(-1)?.clip;
  }

  function leaf(id: AssetId, patch?: SynthFile): Leaf | null {
    const runtime = ref.current.source.runtime();
    const doc = patch ?? docOf<SynthFile>(runtime, SYNTH_KIND, id);
    if (doc) return { kind: "patch", doc };
    const info = runtime?.asset(id);
    return info?.kind === AUDIO_KIND ? { kind: "clip", sha: info.sha256 } : null;
  }

  function resolve(id: AssetId, patch?: SynthFile): Resolved | null {
    const sound = docOf<SoundFile>(ref.current.source.runtime(), SOUND_KIND, id);
    if (!sound) {
      const own = leaf(id, patch);
      return own ? { id, leaf: own, bus: "sfx", volume: 1, rate: 1 } : null;
    }
    const variant = pick(sound);
    const found = variant === undefined ? null : leaf(variant);
    if (variant === undefined || !found) return null;
    const [min, max] = sound.pitch ?? [1, 1];
    return {
      id: variant,
      leaf: found,
      bus: sound.bus,
      volume: sound.volume ?? 1,
      rate: min === max ? min : min + (max - min) * random(),
    };
  }

  function clipFor(on: AudioBackend, r: Resolved): AudioClipHandle | Promise<AudioClipHandle> {
    if (r.leaf.kind === "patch") {
      const doc = r.leaf.doc;
      const hit = patches.get(r.id);
      if (hit && (hit.doc === doc || sameValue(hit.doc, doc))) return hit.clip;
      const clip = on.buffer([renderSynth(doc)], SYNTH_SAMPLE_RATE);
      patches.set(r.id, { doc, clip });
      return clip;
    }
    const { sha } = r.leaf;
    const hit = clips.get(r.id);
    if (hit && hit.sha === sha) return hit.clip;
    const clip = ref.current.source.fetchClip(r.id).then((bytes) => on.decode(bytes));
    const entry: Clip = { sha, clip };
    clips.set(r.id, entry);
    clip.catch(() => {
      if (clips.get(r.id) === entry) clips.delete(r.id);
    });
    return clip;
  }

  function ensureBackend(): AudioBackend | null {
    if (closed) return null;
    if (backend && backend.state !== "closed") return backend;
    backend = (ref.current.makeBackend ?? (() => webAudioBackend()))();
    return backend;
  }

  function stopOne(id: AssetId, fadeMs = STOP_FADE_MS): void {
    const p = playing.get(id);
    if (!p) return;
    playing.delete(id);
    if (p.timer !== null) clearTimeout(p.timer);
    p.voice?.stop(fadeMs);
    setStatus(id, "idle");
  }

  async function play(id: AssetId, opts: AuditionOptions = {}): Promise<boolean> {
    const on = opts.quiet ? backend : ensureBackend();
    if (!on || on.state === "closed" || (opts.quiet && on.state !== "running")) return false;
    stopOne(id);
    const r = resolve(id, opts.patch);
    if (!r) return false;
    // Unlocked inside the click that asked, before anything awaits.
    const unlocking = on.state === "running" ? null : on.unlock();
    const token = ++tokens;
    const mine: Playing = { token, quiet: opts.quiet === true, voice: null, timer: null };
    playing.set(id, mine);
    const ready = clipFor(on, r);
    let clip: AudioClipHandle;
    if (ready instanceof Promise) {
      setStatus(id, "decoding");
      const { pending } = ref.current;
      const work = async () => {
        await unlocking;
        return ready;
      };
      if (pending && !opts.quiet) {
        const result = await pending.run(
          {
            label: `Decoding ${r.id}`,
            scope: auditionScope(id),
            id: `${auditionScope(id)}:${token}`,
            error: "Couldn't play it",
          },
          work,
        );
        if (!result.ok) {
          if (playing.get(id) === mine) stopOne(id);
          return false;
        }
        clip = result.value;
      } else {
        try {
          clip = await work();
        } catch {
          if (playing.get(id) === mine) stopOne(id);
          return false;
        }
      }
    } else {
      await unlocking;
      clip = ready;
    }
    if (closed || playing.get(id) !== mine) return false;
    mine.voice = on.play(clip, {
      bus: r.bus,
      volume: r.volume,
      rate: r.rate,
      pan: 0,
      loop: false,
      key: `audition:${id}`,
    });
    setStatus(id, "playing");
    const fullMs = Number.isFinite(clip.duration) ? (clip.duration / r.rate) * 1000 : Infinity;
    const cut = opts.maxMs !== undefined && opts.maxMs < fullMs;
    const ms = cut ? opts.maxMs! : fullMs;
    if (Number.isFinite(ms)) {
      mine.timer = setTimeout(() => {
        if (playing.get(id) !== mine) return;
        mine.timer = null;
        if (cut) stopOne(id);
        else {
          playing.delete(id);
          setStatus(id, "idle");
        }
      }, ms);
    }
    return true;
  }

  return {
    play,
    stop(id) {
      if (id !== undefined) stopOne(id);
      else for (const each of [...playing.keys()]) stopOne(each);
    },
    stopQuiet(id) {
      if (playing.get(id)?.quiet) stopOne(id);
    },
    statuses,
    silentReason(id) {
      const sound = docOf<SoundFile>(ref.current.source.runtime(), SOUND_KIND, id);
      if (sound && sound.variants.length === 0) return "This sound has no variants yet";
      return null;
    },
    lengthMs(id) {
      const { source } = ref.current;
      const sound = docOf<SoundFile>(source.runtime(), SOUND_KIND, id);
      if (!sound) {
        const ms = leafMs(source, id);
        return ms === null ? null : [ms, ms];
      }
      let min = Infinity;
      let max = -Infinity;
      for (const v of sound.variants) {
        const ms = leafMs(source, v.clip);
        if (ms === null) continue;
        const [slow, fast] = sound.pitch ?? [1, 1];
        min = Math.min(min, ms / fast);
        max = Math.max(max, ms / slow);
      }
      return Number.isFinite(min) ? [min, max] : null;
    },
    retarget(next) {
      ref.current = next;
    },
    open() {
      closed = false;
    },
    close() {
      closed = true;
      for (const id of [...playing.keys()]) stopOne(id, 0);
      backend?.close();
      backend = null;
    },
  };
}

// ─── Sound in Play ───

/** Where the viewer's Sound in Play choice is kept. */
export const SOUND_IN_PLAY_KEY = `${STORAGE_PREFIX}sound-in-play`;

/** The viewer's Sound in Play choice; off when nothing is stored or storage refuses. */
export const soundInPlay = (storage: EditorStorage | null): boolean =>
  readStored(storage, SOUND_IN_PLAY_KEY, false, storedFlag);

/**
 * `GameConfig.audio.backend` for the editor's game: asked each time Play
 * starts, it builds a backend only while Sound in Play is on, and the
 * shell closes what it built when Play ends.
 */
export function playAudioBackend(
  storage: EditorStorage | null,
  make: () => AudioBackend = () => webAudioBackend(),
): () => AudioBackend | false {
  return () => (soundInPlay(storage) ? make() : false);
}

/**
 * Sound in Play flipped while playing: off mutes the game's master bus and
 * stops what plays; on unmutes it. False when this Play started with it off,
 * so it has no sound to unmute until the next Play.
 */
export function applySoundInPlay(game: object, on: boolean): boolean {
  // The chrome's game type leaves `audio` out; a stand-in game may have none.
  const audio = (game as Partial<Pick<GameInstance, "audio">>).audio ?? null;
  if (!audio) return !on;
  const master = audio.buses().master;
  if (master && master.muted === on) audio.setBus("master", master.volume, !on);
  if (!on) audio.stopAll(STOP_FADE_MS);
  return true;
}
