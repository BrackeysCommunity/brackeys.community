import type { EventEmitter } from "node:events";
import { Readable } from "node:stream";

/** What Node destroys a request with when its client hangs up before the request is done. */
export function isAbortedRequestError(e: unknown): boolean {
  return (
    e instanceof Error &&
    e.message === "aborted" &&
    (e as NodeJS.ErrnoException).code === "ECONNRESET"
  );
}

/**
 * Drops an `aborted` hang-up on `stream` when nothing else listens for its
 * errors, reporting it through `report`. Any other error nothing listens for
 * is rethrown, so it stays as fatal as Node would make it.
 */
export function holdAbortedErrors(stream: EventEmitter, report: (e: Error) => void): void {
  stream.on("error", (e: Error) => {
    if (stream.listenerCount("error") > 1) return;
    if (isAbortedRequestError(e)) return report(e);
    throw e;
  });
}

type Guard = {
  /** `Readable.fromWeb` as Node had it, put back by `unguardAbortedRequestBodies`. */
  original: PropertyDescriptor;
  warn: (message: string) => void;
  reported: boolean;
};

/** On `Readable` itself, so every copy of this module a dev server loads shares one guard. */
const GUARD = Symbol.for("@jams/engine/vite:aborted-request-guard");

const guardOf = () => (Readable as unknown as Record<symbol, Guard | undefined>)[GUARD];

/**
 * The site's dev server hands each request body to its SSR worker as
 * `Readable.fromWeb(Readable.toWeb(req)).pipe(upstream)` and listens for no
 * error on the middle stream: a client that hangs up mid-body destroys it
 * with `aborted`, and that unhandled error kills the dev server. This gives
 * every `Readable.fromWeb` stream in the process `holdAbortedErrors`, warning
 * the first time a hang-up is dropped. Installing it again only swaps `warn`.
 */
export function guardAbortedRequestBodies(warn: (message: string) => void): void {
  const installed = guardOf();
  if (installed) {
    installed.warn = warn;
    return;
  }
  const original = Object.getOwnPropertyDescriptor(Readable, "fromWeb");
  if (!original) return;
  const fromWeb = original.value as (...args: Parameters<typeof Readable.fromWeb>) => Readable;
  const guard: Guard = { original, warn, reported: false };
  (Readable as unknown as Record<symbol, Guard>)[GUARD] = guard;
  const report = () => {
    if (guard.reported) return;
    guard.reported = true;
    guard.warn(
      "[dev] a client hung up mid-request and its body stream had no error listener; dropped the 'aborted' error (reported once)",
    );
  };
  Object.defineProperty(Readable, "fromWeb", {
    ...original,
    value: (...args: Parameters<typeof Readable.fromWeb>) => {
      const stream = fromWeb.apply(Readable, args);
      holdAbortedErrors(stream, report);
      return stream;
    },
  });
}

/** Puts `Readable.fromWeb` back as Node had it. */
export function unguardAbortedRequestBodies(): void {
  const guard = guardOf();
  if (!guard) return;
  Object.defineProperty(Readable, "fromWeb", guard.original);
  delete (Readable as unknown as Record<symbol, Guard | undefined>)[GUARD];
}
