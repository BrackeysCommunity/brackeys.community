/**
 * What the export and play smokes share: building a release with
 * `game build`, and watching a page for uncaught errors and the standalone
 * host's `ready`.
 */
import { spawnSync } from "node:child_process";

import type { Frame, Page } from "playwright";

import { PAGE_TIMEOUT_MS } from "./browser-compare";
import { describeFailure, REPO, VP } from "./pack";

export const BUILD_TIMEOUT_MS = 10 * 60_000;

export type BuildResult = { release: string | null; reason?: string };

/** `game build <game> --target <target>` into `out`; the release id it printed, or why it failed. */
export function buildOne(b: { game: string; target: string }, out: string): BuildResult {
  const args = ["run", "scene", "game", "build", b.game, "--target", b.target, "--out", out];
  const res = spawnSync(VP, args, {
    cwd: REPO,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0)
    return { release: null, reason: describeFailure(`vp ${args.join(" ")}`, res) };
  return { release: /\(release ([0-9a-f]{64})\)/.exec(res.stdout)?.[1] ?? null };
}

/**
 * Rejects with the page's first uncaught error, for racing against whatever
 * the run waits on. Errors `ignore` matches are a browser's noise, not the page's.
 */
export function pageErrors(
  page: Page,
  { ignore, what = "page" }: { ignore?: RegExp; what?: string } = {},
): Promise<never> {
  const failed = new Promise<never>((_, reject) => {
    const onError = (err: Error) => {
      if (ignore?.test(err.message)) return;
      page.off("pageerror", onError);
      reject(new Error(`uncaught in the ${what}: ${err.message}`));
    };
    page.on("pageerror", onError);
  });
  failed.catch(() => {});
  return failed;
}

/** Waits for the standalone host's `ready`; its `error` throws with what the page shows. */
export async function waitReady(frame: Frame, what = "page"): Promise<void> {
  const handle = await frame.waitForFunction(
    () => {
      const state = document.documentElement.dataset.jamsState;
      return state === "ready" || state === "error" ? state : null;
    },
    null,
    { timeout: PAGE_TIMEOUT_MS },
  );
  if ((await handle.jsonValue()) === "ready") return;
  const shown = await frame
    .locator("[data-jams-error]")
    .first()
    .textContent({ timeout: 1000 })
    .catch(() => null);
  throw new Error(`the ${what} reports jamsState "error"${shown ? `: ${shown.trim()}` : ""}`);
}
