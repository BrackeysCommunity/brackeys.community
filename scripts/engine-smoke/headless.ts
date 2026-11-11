/**
 * Runs the smoke game's probe, a scripted playtest and a replay of the
 * playtest's recording on a scene under Bun with `-compat` Rapier, then the
 * contact read (`browser/contact.ts`), and prints the reports as JSON; it
 * exits 1 when the contact read fails `judgeContact`. `smoke.ts` runs it twice: from the repo, where
 * tsconfig paths resolve `@jams/engine/*` to source, and from the extracted
 * tarball, where they resolve to `dist`. The two reports must match.
 *
 *   bun headless.ts <scene.json> <inputs.json>
 */
import { readFileSync } from "node:fs";

import RAPIER from "@dimforge/rapier2d-compat";
import { createRegistry } from "@jams/engine/game";
import {
  replayRecording,
  runPlaytest,
  runProbe,
  type ProbeInput,
  type RapierModule,
} from "@jams/engine/headless";
import { expandScene, parseSceneOrThrow } from "@jams/engine/scene";

import { judgeContact, readContact } from "./browser/contact";
import { smokeGame } from "./game";

const [scenePath, inputsPath] = process.argv.slice(2);
if (!scenePath || !inputsPath) {
  console.error("usage: bun headless.ts <scene.json> <inputs.json>");
  process.exit(2);
}

const warn = console.warn;
console.warn = () => {};
await RAPIER.init();
console.warn = warn;
// `-compat` has the standard build's classes plus its own `init`, so it passes through a cast.
const rapier = RAPIER as unknown as RapierModule;

const registry = createRegistry(smokeGame);
const def = parseSceneOrThrow(readFileSync(scenePath, "utf8"), registry);
const scene = expandScene(def, registry);
const inputs = JSON.parse(readFileSync(inputsPath, "utf8")) as NonNullable<ProbeInput["inputs"]>;

const report = runProbe({ rapier, game: smokeGame, registry, scene, ticks: 600, inputs });
if (!report.load.ok) {
  console.error(JSON.stringify(report.load));
  process.exit(1);
}
const playtest = runPlaytest({
  rapier,
  game: smokeGame,
  registry,
  scene: def,
  script: {
    v: 1,
    steps: [{ hold: ["right"], until: { event: { type: "sensor:enter", other: "avatar" } } }],
  },
});
const replay = playtest.blocked
  ? null
  : replayRecording({
      rapier,
      game: smokeGame,
      registry,
      scene: def,
      recording: JSON.parse(JSON.stringify(playtest.recording)),
    });
const contact = readContact(rapier);
const missed = judgeContact(contact);
if (missed) {
  console.error(`the contact read failed: ${missed}`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ probe: report, playtest, replay, contact })}\n`);
