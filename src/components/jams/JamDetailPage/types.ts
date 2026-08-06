import type { client } from "@/orpc/client";

/** `getJam`'s payload for a jam that exists. */
export type JamDetail = NonNullable<Awaited<ReturnType<typeof client.getJam>>>;

/**
 * The `itch.jams` row itself. Structurally identical to `JamFromList`
 * (both are a full select of the table), which is what lets the board's
 * presentation helpers — `jamPhase`, `lifecyclePoints`, `useJamColor` —
 * run against a detail page without a second set of overloads.
 */
export type JamDetailRow = JamDetail["jam"];

export type JamEntryRow = Awaited<ReturnType<typeof client.listJamEntries>>["entries"][number];

export type JamResultsCriterion = Awaited<
  ReturnType<typeof client.getJamResults>
>["criteria"][number];

export type JamResultsPlace = JamResultsCriterion["places"][number];
