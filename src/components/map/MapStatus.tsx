import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";

import type { MapIndex } from "../../../packages/mmo-api/src/index.ts";
import { num } from "../../../packages/mmo-words/src/index.ts";
import type { InView, MapProblem } from "./use-live-map";

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <MicroLabel as="span">{label}</MicroLabel>
      <Text as="span" size="sm" tabular>
        {value}
      </Text>
    </span>
  );
}

const PROBLEM_WORDS: Record<Exclude<MapProblem, "">, string> = {
  busy: "Busy, some of the map is missing",
  down: "The world is not answering",
};

/** The world's tick and day, and the fog counts over the discovered tiles in view. */
export function MapStatus({
  index,
  counts,
  problem,
}: {
  index: MapIndex | undefined;
  counts: InView | undefined;
  problem: MapProblem;
}) {
  if (!index || !counts) {
    return (
      <span className="flex items-center gap-3" aria-busy>
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-24" />
      </span>
    );
  }
  const day = index.ticksPerDay > 0 ? Math.floor(index.tick / index.ticksPerDay) : 0;
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Figure label="Tick" value={num(index.tick)} />
      <Figure label="World day" value={num(day)} />
      <Figure label="In sight" value={num(counts.sight)} />
      <Figure label="Last seen" value={num(counts.seen)} />
      <Figure label="Never seen" value={num(counts.never)} />
      {problem ? (
        <Text as="span" size="xs" className="text-warning">
          {PROBLEM_WORDS[problem]}
        </Text>
      ) : null}
    </span>
  );
}
