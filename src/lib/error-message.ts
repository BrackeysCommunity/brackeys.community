import { ORPCError } from "@orpc/client";

/**
 * One field-level rejection behind oRPC's input validation. `field` is the
 * top-level key of the input the issue sits on (`""` when the issue is on
 * the object itself), so a caller can route it back to the control that
 * owns that column.
 */
export interface ValidationIssue {
  field: string;
  message: string;
}

/**
 * oRPC's own wording for a rejected zod input. It is the framework
 * talking to itself and must never reach a person — `errorMessage` swaps
 * it for the caller's fallback, and a surface that can do better reads
 * `validationIssues` instead.
 */
const VALIDATION_MESSAGE = "Input validation failed";

type StandardIssue = { message?: unknown; path?: unknown };

/**
 * The field-level issues behind a rejected input, or an empty array for
 * any other error. oRPC packs the standard-schema issues into the error's
 * `data`; each path is a key chain, and only its head names a column.
 */
export function validationIssues(err: unknown): ValidationIssue[] {
  if (!(err instanceof ORPCError)) return [];
  const data = err.data as { issues?: unknown } | undefined;
  if (!data || !Array.isArray(data.issues)) return [];
  return data.issues.flatMap((raw): ValidationIssue[] => {
    const issue = raw as StandardIssue;
    const message = typeof issue.message === "string" ? issue.message : "";
    if (!message) return [];
    const head = Array.isArray(issue.path) ? issue.path[0] : undefined;
    // A path segment is either the key or `{ key }` — standard schema
    // allows both, and zod emits the bare form.
    const key =
      typeof head === "string"
        ? head
        : typeof (head as { key?: unknown } | undefined)?.key === "string"
          ? String((head as { key: unknown }).key)
          : "";
    return [{ field: key, message }];
  });
}

/**
 * The one way to turn a caught `unknown` into copy a person can read.
 * Replaces the `err instanceof Error ? err.message : "…"` extraction that
 * had been hand-rolled at ~25 call sites (three of them as local helpers).
 *
 * An `Error` with an empty message falls through to the fallback — a blank
 * toast is worse than a generic one — and so does a rejected input, whose
 * message is oRPC's internal phrasing. A surface that knows its own fields
 * should read `validationIssues` and put each one under its control.
 */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof Error && err.message === VALIDATION_MESSAGE) return fallback;
  return err instanceof Error && err.message ? err.message : fallback;
}
