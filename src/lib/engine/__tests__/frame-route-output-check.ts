/**
 * Checks a production build's route rules for hosted games: reads Nitro's compiled matcher
 * out of `.output/server/index.mjs`, runs it on a path under each rule, and compares the
 * headers it would add with `frameRouteRules`. CI runs it after `vp build`:
 *
 *   bun src/lib/engine/__tests__/frame-route-output-check.ts [.output/server/index.mjs]
 */
import { readFileSync } from "node:fs";

import { frameRouteRules } from "../frame-route-rules";

type Layer = { data: { name: string; options: unknown }[] };
type Matcher = (method: string, path: string) => Layer[] | undefined;

const START = "var findRouteRules = ";
const END = "\n})();";

/** The headers Nitro's built matcher adds to `path`, merged in its order; throws when the bundle has none. */
export function builtRouteHeaders(bundle: string): (path: string) => Record<string, string> {
  const start = bundle.indexOf(START);
  const end = start < 0 ? -1 : bundle.indexOf(END, start);
  if (start < 0 || end < 0)
    throw new Error("the server bundle has no `findRouteRules`; Nitro's output changed shape");
  const source = bundle.slice(start, end + END.length);
  // oxlint-disable-next-line typescript/no-implied-eval -- the build's own matcher, run on sample paths
  const find = new Function("headers", `${source}\nreturn findRouteRules;`)(() => {}) as Matcher;
  return (path) => {
    const merged: Record<string, string> = {};
    for (const layer of find("GET", path) ?? [])
      for (const rule of layer.data)
        if (rule.name === "headers" && typeof rule.options === "object" && rule.options !== null)
          Object.assign(merged, rule.options);
    return merged;
  };
}

const RELEASE = "d".repeat(64);

/** A path under each hosted-game rule, as a browser asks for it. */
export const SAMPLE_PATHS: Record<keyof typeof frameRouteRules, string> = {
  "/frames/**": `/frames/${RELEASE}/index.html`,
  "/frames-private/**": `/frames-private/${RELEASE}/tok/assets/game.js`,
  "/games/*/play/**": "/games/p1/play/latest",
  "/games/*/embed/**": "/games/p1/embed/3",
};

/** Every header a hosted-game rule sets that the built matcher doesn't add to its sample path. */
export function frameRouteOutputFailures(headersFor: (path: string) => Record<string, string>) {
  const failures: string[] = [];
  for (const [pattern, rule] of Object.entries(frameRouteRules)) {
    const path = SAMPLE_PATHS[pattern as keyof typeof frameRouteRules];
    const got = headersFor(path);
    for (const [name, want] of Object.entries(rule.headers))
      if (got[name] !== want)
        failures.push(
          `${path} (${pattern}): ${name} is ${JSON.stringify(got[name])}, not "${want}"`,
        );
  }
  return failures;
}

if (import.meta.main) {
  const file = process.argv[2] ?? ".output/server/index.mjs";
  const failures = frameRouteOutputFailures(builtRouteHeaders(readFileSync(file, "utf8")));
  if (failures.length) {
    console.error(`the build's route rules for hosted games are wrong:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`the build's route rules for hosted games hold (${file})`);
}
