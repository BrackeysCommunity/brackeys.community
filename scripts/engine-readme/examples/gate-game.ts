import { AUDIO, DIALOGUE_END, defineGame, TEXT, type DialogueEndEvent } from "@jams/engine/game";
import { memoryRuntimeView } from "@jams/engine/headless";
import type { DialogueFile, SoundFile, StringsFile, SynthFile } from "@jams/engine/project";
import type { SceneDefinition } from "@jams/engine/scene";

/**
 * The guard's conversation: pay the toll to pass, or walk away. Conditions,
 * effects and a line's `{toll}` read JSON pointers into the game's
 * `persist` value.
 */
export const gateTalk: DialogueFile = {
  kind: "dialogue",
  v: 1,
  start: "gate",
  speakers: [{ id: "guard", name: "speaker.guard" }],
  nodes: [
    {
      id: "gate",
      lines: [{ speaker: "guard", text: "gate.halt", vars: { toll: "/toll" } }],
      choices: [
        {
          text: "gate.pay",
          if: { var: "/gold", gte: 3 },
          do: [{ add: "/gold", by: -3 }, { emit: "toll-paid" }],
          to: "through",
        },
        { text: "gate.leave", to: "turned-away" },
      ],
    },
    {
      id: "through",
      lines: [{ speaker: "guard", text: "gate.go-on" }],
      do: [{ set: "/flags/gate-open", to: true }],
      end: "paid",
    },
    { id: "turned-away", lines: [{ speaker: "guard", text: "gate.later" }], end: "left" },
  ],
};

export const gateStrings: StringsFile = {
  kind: "strings",
  v: 1,
  strings: [
    { key: "speaker.guard", en: "Guard", fr: "Garde", ar: "الحارس" },
    {
      key: "gate.halt",
      en: "Halt. The toll is {toll} gold.",
      fr: "Halte. Le péage coûte {toll} or.",
    },
    { key: "gate.pay", en: "Pay the toll.", fr: "Payer le péage." },
    { key: "gate.leave", en: "Turn back.", fr: "Faire demi-tour." },
    { key: "gate.go-on", en: "Go on, then.", fr: "Passe, alors." },
    { key: "gate.later", en: "Come back with coin.", fr: "Reviens avec de l'or." },
    { key: "gate.open", en: "Open", fr: "Ouvert", note: "The sign once the toll is paid." },
    { key: "caption.coin", en: "[Coins clink]", fr: "[Tintement de pièces]" },
  ],
};

/** A pickup-like blip, written by hand; `synth new pickup` draws one from the preset. */
export const coinPatch: SynthFile = {
  kind: "synth",
  v: 1,
  wave: "square",
  duty: 0.5,
  freq: 880,
  jump: { atMs: 60, semitones: 5 },
  sustainMs: 60,
  punch: 0.4,
  decayMs: 240,
};

/** Plays the patch on the dialogue's `toll-paid` event, captioned, with no game code. */
export const coinSound: SoundFile = {
  kind: "sound",
  v: 1,
  bus: "sfx",
  volume: 0.8,
  pitch: [0.95, 1.05],
  variants: [{ clip: "coin-patch" }],
  caption: "caption.coin",
  on: [{ event: "toll-paid" }],
};

/** The gate's hum: a low looping tone, placed and faded by where the gate is on screen. */
export const humSound: SoundFile = {
  kind: "sound",
  v: 1,
  bus: "sfx",
  volume: 0.4,
  variants: [{ clip: "hum-patch" }],
  loop: true,
  positional: true,
  range: 6,
};

export const humPatch: SynthFile = {
  kind: "synth",
  v: 1,
  wave: "sine",
  freq: 110,
  sustainMs: 2000,
  decayMs: 0,
};

/** The music while the guard talks: one voice on the music bus, crossfaded by `present.audio.music`. */
export const tuneSound: SoundFile = {
  kind: "sound",
  v: 1,
  bus: "music",
  variants: [{ clip: "tune-patch" }],
  loop: true,
};

export const tunePatch: SynthFile = {
  kind: "synth",
  v: 1,
  wave: "triangle",
  freq: 220,
  vibrato: { semitones: 0.3, hz: 5 },
  sustainMs: 2000,
  decayMs: 0,
};

/** The project as a host passes it: English by default, French beside it, Arabic for the guard's name. */
export const gateProject = memoryRuntimeView({
  engine: { locales: { default: "en", available: ["en", "fr", "ar"] } },
  docs: {
    dialogue: { "gate-talk": gateTalk },
    strings: { "gate-strings": gateStrings },
    synth: { "coin-patch": coinPatch, "hum-patch": humPatch, "tune-patch": tunePatch },
    sound: { "coin-sound": coinSound, "hum-sound": humSound, "tune-sound": tuneSound },
  },
});

/**
 * Opens the guard's conversation on load, with the wallet in `persist`
 * where the dialogue's conditions and effects read and write. The run ends
 * with the conversation's ending; on "paid" the sign shows its new key, the
 * gate's hum stops and the music fades out. The sign and the hum are drawn
 * and played only with a view, so headless their handles are undefined.
 */
export const gateGame = defineGame({
  id: "gate",
  types: [],
  actions: [],
  world: { physics: "none" },
  persist: { initial: () => ({ gold: 3, toll: 3 }) },
  createRuntime: (ctx) => ({
    onLoad() {
      ctx.present.audio.music("tune-sound", { fadeMs: 800 });
      ctx.dialogue.start("gate-talk");
      ctx.events.on(DIALOGUE_END, (e) => {
        if ((e.data as DialogueEndEvent).ending !== "paid") return;
        ctx.entity("sign")?.getBehavior(TEXT)?.setKey("gate.open");
        ctx.entity("gate")?.getBehavior(AUDIO)?.stop();
        ctx.present.audio.music(null, { fadeMs: 1200 });
      });
    },
    snapshot: () => null,
  }),
  play: {
    results: ["paid", "left"],
    outcome: ({ events }) => {
      const end = events.find((e) => e.type === DIALOGUE_END);
      return end ? { result: (end.data as DialogueEndEvent).ending } : null;
    },
  },
});

export const gateScene: SceneDefinition = {
  v: 5,
  game: "gate",
  name: "gate",
  bounds: [0, 0, 8, 4],
  entities: [
    {
      id: "sign",
      type: "marker",
      at: [4, 1],
      behaviors: { text: { key: "gate.halt", vars: { toll: 3 }, size: 14, wrap: 160 } },
    },
    { id: "gate", type: "marker", at: [6, 2], behaviors: { audio: { sound: "hum-sound" } } },
  ],
};
