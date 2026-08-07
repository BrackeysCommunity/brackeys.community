import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { formatJamShortDates } from "@/lib/jam-countdown";
import { orpc } from "@/orpc/client";

import { FieldRow } from "./fields";

/** A jam as the picker needs it — a subset of what `listJams` returns. */
export interface PickableJam {
  jamId: number;
  title: string;
  bannerUrl: string | null;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
}

interface JamPickerFieldProps {
  value: number | undefined;
  onChange: (jam: PickableJam | null) => void;
}

const VISIBLE_RESULTS = 6;

/**
 * Optional "this post is for a jam" link. Backed by `listJams`'s board
 * window (everything with an event still ahead of it), upcoming and
 * running first — a jam recruiting post is almost always for a jam that
 * hasn't finished, and typing narrows to the rest.
 *
 * Picking a jam is what turns "Brackeys Jam 2026.2" from a phrase buried
 * in a description into something the board can filter on.
 */
export function JamPickerField({ value, onChange }: JamPickerFieldProps) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery({
    ...orpc.listJams.queryOptions({ input: { filter: "board", limit: 500 } }),
    staleTime: 5 * 60 * 1000,
  });

  const jams = useMemo(() => (data?.jams ?? []) as PickableJam[], [data]);
  const selected = useMemo(() => jams.find((j) => j.jamId === value) ?? null, [jams, value]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = q ? jams.filter((j) => j.title.toLowerCase().includes(q)) : jams;
    return matches.slice(0, VISIBLE_RESULTS);
  }, [jams, search]);

  // A jam is selected: show the choice, not the search — re-picking is a
  // click away and the list would only invite a second, conflicting one.
  if (value !== undefined) {
    return (
      <FieldRow label="JAM" hint="optional">
        <Well variant="ghost" className="flex-row items-center gap-3 border-primary/30 p-2.5">
          <JamThumb jam={selected} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Text size="sm" bold ellipsis>
              {selected?.title ?? `Jam #${value}`}
            </Text>
            {selected ? (
              <Text size="xs" variant="muted" className="tracking-widest">
                {formatJamShortDates(selected.startsAt, selected.endsAt) ?? "DATES TBA"}
              </Text>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Remove jam link"
            onClick={() => onChange(null)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </Button>
        </Well>
      </FieldRow>
    );
  }

  return (
    <FieldRow label="JAM" hint="optional · links the post to a jam">
      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search upcoming jams…"
          className="pl-8"
        />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : results.length === 0 ? (
        <Text size="xs" variant="muted">
          {search.trim() ? "No jams match that search." : "No upcoming jams right now."}
        </Text>
      ) : (
        <div className="flex flex-col gap-1.5">
          {results.map((jam) => (
            <Chonk
              key={jam.jamId}
              variant="surface"
              size="sm"
              render={<button type="button" onClick={() => onChange(jam)} />}
              className="w-full items-center gap-3 p-2"
            >
              <JamThumb jam={jam} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Text as="span" size="sm" ellipsis>
                  {jam.title}
                </Text>
                <Text as="span" size="xs" variant="muted" className="tracking-widest">
                  {formatJamShortDates(jam.startsAt, jam.endsAt) ?? "DATES TBA"}
                </Text>
              </span>
            </Chonk>
          ))}
        </div>
      )}
    </FieldRow>
  );
}

function JamThumb({ jam }: { jam: PickableJam | null }) {
  return (
    <span className="block h-10 w-16 shrink-0 overflow-hidden border border-muted/40 bg-muted/30">
      {jam?.bannerUrl ? (
        <img src={jam.bannerUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : null}
    </span>
  );
}
