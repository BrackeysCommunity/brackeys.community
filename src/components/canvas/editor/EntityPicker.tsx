import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { MicroLabel, Text } from "@/components/ui/typography";
import type { EntityRef } from "@/lib/canvas/json-canvas";
import type { RankedHit } from "@/lib/search-hits";
import { orpc } from "@/orpc/client";

const KIND_LABEL = { jam: "JAM", member: "MEMBER", team: "TEAM", forum: "FORUM" } as const;

function entityOf(hit: RankedHit): EntityRef | null {
  switch (hit.kind) {
    case "jam":
      return { kind: "jam", id: String(hit.id) };
    case "member":
      return { kind: "profile", id: hit.id };
    case "team":
      return { kind: "team", id: hit.id };
    case "forum":
      return { kind: "forum-post", id: String(hit.id) };
    default:
      return null;
  }
}

function titleOf(hit: RankedHit): string {
  return "title" in hit ? hit.title : "name" in hit ? hit.name : "";
}

/** Site search, narrowed to what a live card can show. */
export function EntityPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (entity: EntityRef, url: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQuery({
    ...orpc.searchAll.queryOptions({
      input: { q: debounced, perKind: 5, kinds: ["jam", "team", "member", "forum"] },
    }),
    enabled: open && debounced.length > 0,
  });
  const hits = (data?.hits ?? []).filter((hit) => entityOf(hit) != null);

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      title="Add a live card"
      description="Search for a jam, team, member or forum post to put on the canvas."
      className="sm:max-w-lg"
    >
      <div className="flex flex-col gap-3 p-4">
        <Input
          autoFocus
          placeholder="Search jams, teams, members, posts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search"
        />
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.id}`}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => {
                  const entity = entityOf(hit);
                  if (entity) onPick(entity, new URL(hit.href, window.location.origin).toString());
                }}
              >
                <MicroLabel as="span" className="w-14 shrink-0">
                  {KIND_LABEL[hit.kind as keyof typeof KIND_LABEL]}
                </MicroLabel>
                <Text as="span" size="sm" ellipsis>
                  {titleOf(hit)}
                </Text>
              </button>
            </li>
          ))}
          {debounced && !isFetching && hits.length === 0 ? (
            <li className="px-2 py-1.5">
              <Text as="span" size="xs" variant="muted">
                Nothing found.
              </Text>
            </li>
          ) : null}
        </ul>
      </div>
    </ResponsiveModal>
  );
}
