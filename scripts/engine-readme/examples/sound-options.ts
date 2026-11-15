import {
  browserPrefsStore,
  createGame,
  webAudioBackend,
  type GameInstance,
  type MountUi,
} from "@jams/engine";
import { parseSceneOrThrow } from "@jams/engine/scene";

import { gateGame, gateProject } from "./gate-game";

/**
 * A page playing the gate game with sound: Web Audio, unlocked by the
 * player's first press on the canvas, and the player's volumes, language
 * and captions kept in this browser.
 */
export async function startGateGame(canvas: HTMLCanvasElement, sceneText: string) {
  const game = await createGame(canvas, {
    game: gateGame,
    project: gateProject,
    displayWidth: canvas.clientWidth,
    displayHeight: canvas.clientHeight,
    audio: { backend: webAudioBackend(), prefs: browserPrefsStore() },
  });
  game.on("audio:unlocked", () => console.info("sound is on"));
  const report = game.loadScene(parseSceneOrThrow(sceneText, game.registry));
  if (!report.ok) throw new Error(`the scene didn't load: ${report.error}`);
  game.start();
  return game;
}

/**
 * An options panel: a slider and a mute box per bus, the language,
 * captions and latency calibration. Each control writes through
 * `GameInstance`, which saves it in the prefs; nothing here reaches the
 * simulation.
 */
export const mountSoundOptions: MountUi = (ctx) => {
  const doc = ctx.root.ownerDocument;
  const form = doc.createElement("form");
  form.setAttribute("aria-label", "Sound and language");
  // The layer takes no pointer events; whatever is clickable opts back in.
  form.style.pointerEvents = "auto";
  const game: GameInstance = ctx.game;

  const field = (label: string, input: HTMLElement) => {
    const row = doc.createElement("label");
    row.append(label, input);
    form.append(row);
  };

  // Null until a backend plays; a page that has none shows no sliders.
  for (const [bus, level] of Object.entries(game.audio?.buses() ?? {})) {
    const slider = doc.createElement("input");
    slider.type = "range";
    slider.name = bus;
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.05";
    slider.value = String(level.volume);
    const mute = doc.createElement("input");
    mute.type = "checkbox";
    mute.name = `${bus}-muted`;
    mute.checked = level.muted;
    const write = () => game.audio?.setBus(bus, Number(slider.value), mute.checked);
    slider.addEventListener("input", write);
    mute.addEventListener("change", write);
    field(`${bus} volume`, slider);
    field(`Mute ${bus}`, mute);
  }

  const language = doc.createElement("select");
  language.name = "locale";
  for (const locale of game.locale.available()) {
    const option = doc.createElement("option");
    option.value = option.textContent = locale;
    language.append(option);
  }
  language.value = game.locale.current();
  language.addEventListener("change", () => game.locale.set(language.value));
  field("Language", language);

  const captions = doc.createElement("input");
  captions.type = "checkbox";
  captions.name = "captions";
  captions.checked = game.captions.enabled();
  captions.addEventListener("change", () => game.captions.set(captions.checked));
  field("Captions", captions);

  // Taps along to a click track; the offset is saved and sent as `@latency`.
  const calibrate = doc.createElement("button");
  calibrate.type = "button";
  calibrate.name = "calibrate";
  calibrate.textContent = "Calibrate";
  const offset = doc.createElement("output");
  offset.name = "latency";
  calibrate.addEventListener("click", async () => {
    calibrate.disabled = true;
    offset.textContent = "Tap along to the clicks";
    const found = await game.calibrateLatency();
    offset.textContent = found
      ? `${found.ms} ms (spread ${found.spread} ms)`
      : "Not enough taps; try again";
    calibrate.disabled = false;
  });
  field("Latency", calibrate);
  form.append(offset);

  ctx.root.append(form);
  return { destroy: () => form.remove() };
};
