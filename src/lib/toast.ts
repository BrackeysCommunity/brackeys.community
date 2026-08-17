import { toast as sonnerToast } from "sonner";

import { playToast } from "@/lib/sound";

/**
 * Sonner's `toast`, with the arrival cue from `@/lib/sound` attached.
 * App code imports `toast` from here, never from `sonner` directly — sonner
 * has no global event hook, so the cue has to ride the call itself.
 *
 * Only the three outcome methods are wrapped. Everything else on sonner's
 * `toast` — the bare call, `promise`, `loading`, `dismiss`, `custom` — passes
 * through untouched, so this stays a drop-in swap. Sounds on `loading`
 * belong to the slow-job cue in `@/lib/sound`, at the call site that knows
 * whether the wait is long enough to earn one.
 */

type Toast = typeof sonnerToast;

function withCue<Fn extends (...args: never[]) => unknown>(fn: Fn): Fn {
  return ((...args: Parameters<Fn>) => {
    playToast();
    return fn(...args);
  }) as Fn;
}

export const toast: Toast = Object.assign(
  ((...args: Parameters<Toast>) => sonnerToast(...args)) as Toast,
  sonnerToast,
  {
    success: withCue(sonnerToast.success),
    warning: withCue(sonnerToast.warning),
    error: withCue(sonnerToast.error),
  },
);
