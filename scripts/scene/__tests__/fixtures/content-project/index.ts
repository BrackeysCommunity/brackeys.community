import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { defaultIconPng } from "@jams/engine/export";
import { synthWav } from "@jams/engine/headless";
import type { SynthFile } from "@jams/engine/project";

import { runCli } from "../../../commands";
import type { ToolContext } from "../../../context";
import { REPO_ROOT } from "../../../default-context";

/** The preloaded sound the menu's bell plays: the WAV `CONTENT_CHIME_CLIP` or the patch `CONTENT_PATCH`. */
export const CONTENT_CHIME_SOUND = "bell-chime";
export const CONTENT_CHIME_CLIP = "chime-clip";
/** The synth patch `CONTENT_CHIME_SOUND` names: a runtime doc, never a file in `assets/`. */
export const CONTENT_PATCH = "blip-synth";
/** The looping sound the menu's speaker plays, not preloaded: its Ogg clip loads on first play. */
export const CONTENT_DRONE_SOUND = "drone-loop";
export const CONTENT_DRONE_CLIP = "drone-clip";
/** The dialogue, whose only clip is the voice line `CONTENT_VOICE_CLIP`. */
export const CONTENT_DIALOGUE = "greeting";
export const CONTENT_VOICE_CLIP = "voice-clip";
/** The strings file, in en (the default) and fr. */
export const CONTENT_STRINGS = "menu-strings";
/** The BMFont the menu's title draws in, and its page. */
export const CONTENT_FONT = "sign-font";
export const CONTENT_FONT_PAGE = "sign-font-page";
/** The key the menu's title shows. */
export const CONTENT_TITLE_KEY = "menu.title";

/** Every clip the project gains, with the extension it ships under. */
export const CONTENT_CLIPS: Readonly<Record<string, string>> = {
  [CONTENT_CHIME_CLIP]: ".wav",
  [CONTENT_DRONE_CLIP]: ".ogg",
  [CONTENT_VOICE_CLIP]: ".wav",
};

/** The sound file of `CONTENT_CHIME_SOUND`, its bus given. */
export const chimeSound = (bus: string) => ({
  kind: "sound",
  v: 1,
  bus,
  preload: true,
  variants: [{ clip: CONTENT_CHIME_CLIP }, { clip: CONTENT_PATCH }],
});

/** The strings file of `CONTENT_STRINGS`; `titleIn` the locales the title has text in. */
export const menuStrings = (titleIn: readonly ("en" | "fr")[] = ["en", "fr"]) => {
  const title: Record<string, string> = { en: "Tactics", fr: "Tactique" };
  return {
    kind: "strings",
    v: 1,
    strings: [
      {
        key: CONTENT_TITLE_KEY,
        ...Object.fromEntries(titleIn.map((l) => [l, title[l]!])),
      },
      { key: "speaker.guide", en: "Guide", fr: "Guide" },
      { key: "talk.hello", en: "Hello there.", fr: "Bonjour." },
      { key: "talk.yes", en: "Yes", fr: "Oui" },
      { key: "talk.bye", en: "Goodbye.", fr: "Au revoir." },
    ],
  };
};

const patch = (freq: number, sustainMs: number): SynthFile => ({
  kind: "synth",
  v: 1,
  wave: "square",
  freq,
  sustainMs,
  decayMs: 60,
});

/** A text BMFont on one 192 px page: printable ASCII and "é" in 8 px cells. */
function bmfont(page: string): string {
  const ids = [...Array.from({ length: 95 }, (_, i) => 32 + i), 233];
  const chars = ids.map((id, i) => {
    const x = (i % 24) * 8;
    const y = Math.floor(i / 24) * 8;
    return `char id=${id} x=${x} y=${y} width=7 height=7 xoffset=0 yoffset=0 xadvance=8 page=0 chnl=15`;
  });
  return [
    'info face="Content Sign" size=8 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=1,1 outline=0',
    "common lineHeight=8 base=7 scaleW=192 scaleH=192 pages=1 packed=0 alphaChnl=0 redChnl=4 greenChnl=4 blueChnl=4",
    `page id=0 file="${page}"`,
    `chars count=${chars.length}`,
    ...chars,
    "",
  ].join("\n");
}

/**
 * Adds a project's worth of sound and text to the tactics project `ctx`
 * holds, through the scene CLI as an author would: the clips (two WAVs
 * rendered from patches, and the engine's CC0 Ogg tone), the patch, the two
 * sounds, a BMFont and its page, the strings in en and fr with
 * `engine.locales` naming the font, and the dialogue. The start scene
 * ("menu") gains a bell and a speaker playing the sounds and a title
 * showing `CONTENT_TITLE_KEY` in the font. `staging` holds the imported
 * files' sources. Throws on any command that fails.
 */
export async function addContent(ctx: ToolContext, staging: string): Promise<void> {
  await mkdir(staging, { recursive: true });
  const cli = async (...argv: string[]) => {
    const r = await runCli([...argv, "--project", "tactics", "--json"], ctx);
    if (r.exitCode !== 0) throw new Error(`${argv.join(" ")}\n${r.stdout}\n${r.stderr}`);
  };
  const stage = async (name: string, content: string | Uint8Array) => {
    const path = join(staging, name);
    await writeFile(path, content);
    return path;
  };
  const doc = (json: object) => `${JSON.stringify(json, null, 2)}\n`;
  const importAt = async (name: string, content: string | Uint8Array, path: string, id: string) =>
    cli("assets", "import", await stage(name, content), "--path", path, "--id", id);

  const tone = await readFile(
    join(REPO_ROOT, "packages/engine/project/__tests__/fixtures/tone.ogg"),
  );
  await importAt("chime.wav", synthWav(patch(880, 40)), "art/sound/", CONTENT_CHIME_CLIP);
  await importAt("drone.ogg", tone, "art/sound/", CONTENT_DRONE_CLIP);
  await importAt("voice.wav", synthWav(patch(330, 90)), "art/sound/", CONTENT_VOICE_CLIP);
  await importAt("sign_0.png", defaultIconPng(192), "art/fonts/", CONTENT_FONT_PAGE);
  await importAt("sign.fnt", bmfont("sign_0.png"), "art/fonts/", CONTENT_FONT);

  const blobs = [
    CONTENT_CHIME_CLIP,
    CONTENT_DRONE_CLIP,
    CONTENT_VOICE_CLIP,
    CONTENT_FONT_PAGE,
    CONTENT_FONT,
  ];
  const licences = {
    v: 1,
    label: "License the sound and text media",
    ops: blobs.map((id) => ({
      op: "setLicence",
      id,
      licence: { spdx: "CC0-1.0", author: "The @jams/engine authors" },
    })),
  };
  await cli("assets", "apply", "--ops", await stage("licence-ops.json", doc(licences)));

  const docs: [string, string, object][] = [
    ["blip.synth.json", CONTENT_PATCH, patch(660, 30)],
    ["bell.sound.json", CONTENT_CHIME_SOUND, chimeSound("sfx")],
    [
      "drone.sound.json",
      CONTENT_DRONE_SOUND,
      { kind: "sound", v: 1, bus: "music", loop: true, variants: [{ clip: CONTENT_DRONE_CLIP }] },
    ],
    ["menu.strings.json", CONTENT_STRINGS, menuStrings()],
    [
      "greeting.dialogue.json",
      CONTENT_DIALOGUE,
      {
        kind: "dialogue",
        v: 1,
        start: "hello",
        speakers: [{ id: "guide", name: "speaker.guide" }],
        nodes: [
          {
            id: "hello",
            lines: [{ speaker: "guide", text: "talk.hello", voice: CONTENT_VOICE_CLIP }],
            choices: [{ text: "talk.yes", to: "bye" }],
          },
          { id: "bye", lines: [{ speaker: "guide", text: "talk.bye" }], end: "done" },
        ],
      },
    ],
  ];
  for (const [name, id, json] of docs) await importAt(name, doc(json), "data/", id);

  const settings = {
    v: 1,
    label: "Offer en and fr, drawn in the sign font",
    ops: [
      {
        op: "editAsset",
        id: "tactics-settings",
        edits: [
          {
            set: "/engine/locales",
            value: { default: "en", available: ["en", "fr"], fonts: { default: CONTENT_FONT } },
          },
        ],
      },
    ],
  };
  await cli("assets", "apply", "--ops", await stage("settings-ops.json", doc(settings)));

  const ops = {
    label: "A bell, a speaker and a title on the menu",
    ops: [
      {
        op: "add",
        entity: {
          id: "bell",
          type: "decor",
          layer: "decor",
          at: [2, 2],
          behaviors: { audio: { sound: CONTENT_CHIME_SOUND } },
        },
      },
      {
        op: "add",
        entity: {
          id: "speaker",
          type: "decor",
          layer: "decor",
          at: [10, 2],
          behaviors: { audio: { sound: CONTENT_DRONE_SOUND } },
        },
      },
      {
        op: "add",
        entity: {
          id: "title",
          type: "decor",
          layer: "decor",
          at: [6, 1],
          behaviors: { text: { key: CONTENT_TITLE_KEY, font: CONTENT_FONT } },
        },
      },
    ],
  };
  await cli("apply", "menu", "--ops", await stage("menu-ops.json", doc(ops)));
}
