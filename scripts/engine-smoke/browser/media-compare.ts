/**
 * What the page's sign and audio runs report, and how the runner judges
 * them; pure, so the runner, the page and the tests share it.
 */
import type { BrowserName, BrowserOutcome } from "../browser-compare";
import type { EngineSmokeResult } from "./main";
import { SIGN_GRID, SIGN_WAIT_MS, SIGNS, type SignFont } from "./signs";
import { SMOKE_BACKGROUND } from "./sink";

/** How far a channel may stray from a colour judged present. */
const CHANNEL_TOLERANCE = 8;

/** One sign as the page read it: how many grid points showed its colour, and the first that did. */
export type SignRead = {
  font: SignFont;
  renderer: string;
  points: number;
  /** Points near the sign's colour. */
  lit: number;
  /** Points neither the sign's colour nor the background: antialiased edges, or something else drawn. */
  other: number;
  sample: readonly [number, number, number, number] | null;
  /** From the scene's load to the read that saw the sign, or to giving up. */
  ms: number;
};

/** Both signs, plus how many web font faces the document had loaded when the web sign was read. */
export type SignProbe = { bitmap: SignRead; web: SignRead; loadedFaces: number };

/** The audio run: a synth patch played after a click, and the same patch rendered offline at `pan: -1`. */
export type AudioProbe = {
  /** The context's state after the backend's unlock. */
  context: string;
  backend: string;
  /** `destination.channelCount`, and the most the destination could take. */
  channels: number;
  maxChannels: number;
  patchMs: number;
  /** From `play` until the voice reported `ended`; null when it hadn't by the page's cap. */
  endedMs: number | null;
  /**
   * On a context that never ran: whether the voice, played anyway, was still
   * waiting at position 0 on the stopped clock past its patch's length.
   * Null on a running context.
   */
  held: boolean | null;
  /** The offline render's share of its energy in the left channel, 0–1. */
  leftShare: number;
  offlineChannels: number;
};

/** A voice may report `ended` this late after its patch's length. */
export const AUDIO_ENDED_SLACK_MS = 100;

/** The offline render at `pan: -1` puts more than this share of its energy on the left. */
export const AUDIO_LEFT_SHARE = 0.95;

/** The button the runner clicks to give the page the gesture audio needs. */
export const AUDIO_BUTTON_ID = "smoke-audio";

export const nearColour = (px: readonly number[], hex: number): boolean =>
  [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff].every(
    (c, i) => Math.abs((px[i] ?? -1) - c) <= CHANNEL_TOLERANCE,
  );

/** Counts a read's grid of pixels against its sign's colour and the background. */
export function countSign(
  font: SignFont,
  renderer: string,
  pixels: readonly (readonly [number, number, number, number] | null)[],
  ms: number,
): SignRead {
  let lit = 0;
  let other = 0;
  let sample: SignRead["sample"] = null;
  for (const px of pixels) {
    if (!px) continue;
    if (nearColour(px, SIGNS[font].colour)) {
      lit++;
      sample ??= [px[0], px[1], px[2], px[3]];
    } else if (!nearColour(px, SMOKE_BACKGROUND)) other++;
  }
  return { font, renderer, points: pixels.length, lit, other, sample, ms };
}

function judgeSign(read: SignRead | undefined, font: SignFont): string | null {
  if (!read) return `the page read no ${font} sign`;
  const [cols, rows] = SIGN_GRID;
  if (read.points !== cols * rows)
    return `the ${font} sign was read at ${read.points} points, not ${cols * rows}`;
  if (read.lit === 0)
    return `the ${font} sign is blank: none of ${read.points} points showed its colour within ${SIGN_WAIT_MS / 1000} s on ${read.renderer} (${read.other} showed something else)`;
  return null;
}

/** Why the sign run failed, or null: each sign drew pixels of its own colour, and the web font loaded. */
export function judgeSigns(signs: SignProbe | undefined): string | null {
  if (!signs) return "the page ran no signs";
  const wrong = judgeSign(signs.bitmap, "bitmap") ?? judgeSign(signs.web, "web");
  if (wrong) return wrong;
  if (signs.loadedFaces < 1) return "the web sign drew, but the document loaded no font face";
  return null;
}

/**
 * Firefox's real-time context never runs without an output device, as on a
 * CI runner, where Chromium and WebKit fake one. There the live run proves
 * the gesture unlocked the backend and the voice was scheduled on the
 * context's clock; the offline render proves the graph.
 */
export const deviceless = (audio: AudioProbe, browser: BrowserName | undefined): boolean =>
  browser === "firefox" &&
  audio.maxChannels === 0 &&
  audio.context === "suspended" &&
  audio.backend === "suspended";

function judgeLive(audio: AudioProbe, browser: BrowserName | undefined): string | null {
  if (deviceless(audio, browser))
    return audio.held === true
      ? null
      : "with no output device the patch's voice didn't wait on the stopped context clock";
  if (audio.context !== "running" || audio.backend !== "running") {
    const why = audio.maxChannels === 0 ? " (its destination has no output device to run on)" : "";
    return `after the click the context is ${audio.context} and the backend ${audio.backend}, not running${why}`;
  }
  if (audio.channels < 2)
    return `the destination has ${audio.channels} channel${audio.channels === 1 ? "" : "s"}, not two or more`;
  if (audio.endedMs === null || audio.endedMs > audio.patchMs + AUDIO_ENDED_SLACK_MS)
    return `the patch's voice ${audio.endedMs === null ? "never ended" : `ended after ${audio.endedMs} ms`}, not within its ${audio.patchMs} ms plus ${AUDIO_ENDED_SLACK_MS}`;
  return null;
}

/** Why the audio run in `browser` failed, or null. */
export function judgeAudio(audio: AudioProbe | undefined, browser?: BrowserName): string | null {
  if (!audio) return "the page ran no audio";
  const live = judgeLive(audio, browser);
  if (live) return live;
  if (audio.offlineChannels < 2)
    return `the offline render has ${audio.offlineChannels} channel, not two`;
  if (!(audio.leftShare > AUDIO_LEFT_SHARE))
    return `at pan -1 the left channel holds ${(audio.leftShare * 100).toFixed(1)}% of the energy, not over ${AUDIO_LEFT_SHARE * 100}%`;
  return null;
}

export type MediaOutcome = BrowserOutcome & { signs?: SignProbe; audio?: AudioProbe };

/** `outcome` with the page's signs and audio, failed by the first of them that didn't hold. */
export function judgeMedia(
  outcome: BrowserOutcome,
  result: EngineSmokeResult | undefined,
): MediaOutcome {
  if (!result?.ok) return outcome;
  const seen: MediaOutcome = {
    ...outcome,
    ...(result.signs ? { signs: result.signs } : {}),
    ...(result.audio ? { audio: result.audio } : {}),
  };
  if (outcome.status !== "pass") return seen;
  const wrong = judgeSigns(result.signs) ?? judgeAudio(result.audio, outcome.browser);
  return wrong ? { ...seen, status: "fail", reason: wrong } : seen;
}
