import { HugeiconsIcon } from "@hugeicons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Rail } from "@/components/ui/rail";
import { Skeleton } from "@/components/ui/skeleton";
import { EVENTS } from "@/lib/event-taxonomy";
import { useCommandPalette } from "@/lib/hooks/use-command-palette";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useFlag } from "@/lib/hooks/use-flag";
import { useSearchPerformed } from "@/lib/hooks/use-search-performed";
import { captureEvent } from "@/lib/product-insights";
import type { RankedHit, SearchKind } from "@/lib/search-hits";
import { hitLinkOptions } from "@/lib/search-links";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { CommandPreview } from "./command-palette/CommandPreview";
import { hitArtUrl, isMediaHit } from "./command-palette/SearchArt";
import {
  KIND_HEADING,
  SearchHitFeature,
  SearchHitRow,
  SearchHitTile,
} from "./command-palette/SearchHitRow";
import { SearchPreview } from "./command-palette/SearchPreview";
import {
  filterCommands,
  usePaletteCommands,
  type PaletteCommand,
  type PaletteDetail,
} from "./command-palette/use-palette-commands";

/** Below this, a query is still a command filter, not a site search. */
const MIN_SEARCH_LENGTH = 2;

const NO_HITS: RankedHit[] = [];

interface Row {
  value: string;
  kind: SearchKind | "command" | "tag";
  hit?: RankedHit;
  /** For a local row, its label and what the preview pane says about it. */
  local?: { label: string; detail: PaletteDetail };
  content: ReactNode;
  perform: () => void;
}

interface Section {
  heading: string;
  /** A rail of art tiles, for a kind that has any art in this answer. */
  rail?: boolean;
  rows: Row[];
}

/** How long a highlight must rest before the preview and preload follow it. */
const PREVIEW_DELAY_MS = 120;

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const navigate = useNavigate();
  const router = useRouter();
  const forumOn = useFlag("forum-enabled");
  const { actions, rest } = usePaletteCommands(forumOn);

  // The dialog paints first and the list follows a frame later, so the
  // first ⌘K shows the palette at once instead of after every row renders.
  const [listReady, setListReady] = useState(false);
  useEffect(() => {
    if (!open || listReady) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setListReady(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open, listReady]);

  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 150);
  const searchable = open && listReady && debounced.length >= MIN_SEARCH_LENGTH;
  const search = useQuery({
    ...orpc.searchAll.queryOptions({ input: { q: debounced } }),
    enabled: searchable,
    placeholderData: keepPreviousData,
    staleTime: STALE.listing,
  });
  const { data: forumTags } = useQuery({
    ...orpc.searchForumTags.queryOptions({ input: { query: debounced, limit: 4 } }),
    enabled: searchable && forumOn,
    placeholderData: keepPreviousData,
    staleTime: STALE.listing,
  });

  const showHits = trimmed.length >= MIN_SEARCH_LENGTH;
  const hits = (showHits ? search.data?.hits : undefined) ?? NO_HITS;
  const settled =
    !showHits || (debounced === trimmed && search.isSuccess && !search.isPlaceholderData);

  const tags = showHits && forumOn ? forumTags : undefined;
  // Built once per answer, not per highlight: moving through the list must
  // not re-render every row.
  const sections = useMemo(() => {
    const hitRow = (hit: RankedHit, content: ReactNode): Row => ({
      value: `hit:${hit.kind}:${hit.id}`,
      kind: hit.kind,
      hit,
      content,
      perform: () => void navigate(hitLinkOptions(hit)),
    });
    const commandRow = (command: PaletteCommand): Row => ({
      value: `cmd:${command.id}`,
      kind: "command",
      content: (
        <>
          <HugeiconsIcon icon={command.icon} className={command.iconClassName} />
          <span>{command.label}</span>
          {command.shortcut ? <CommandShortcut>{command.shortcut}</CommandShortcut> : null}
        </>
      ),
      local: { label: command.label, detail: command.detail },
      perform: command.perform,
    });

    // Top hit, then the actions (few, and what a short query usually means),
    // then each kind in the order of its best hit, then everything local.
    const built: Section[] = [];
    const [top, ...others] = hits;
    if (top) {
      built.push({
        heading: "TOP HIT",
        rows: [hitRow(top, <SearchHitFeature hit={top} query={trimmed} />)],
      });
    }
    const matchedActions = filterCommands(actions, trimmed);
    if (matchedActions.commands.length > 0) {
      built.push({ heading: actions.heading, rows: matchedActions.commands.map(commandRow) });
    }
    const byKind = new Map<SearchKind, RankedHit[]>();
    for (const hit of others) byKind.set(hit.kind, [...(byKind.get(hit.kind) ?? []), hit]);
    for (const [kind, kindHits] of byKind) {
      const media = kindHits.filter(isMediaHit);
      const rail = media.length === kindHits.length && media.some((hit) => hitArtUrl(hit));
      built.push({
        heading: KIND_HEADING[kind],
        rail,
        rows: rail
          ? media.map((hit) => hitRow(hit, <SearchHitTile hit={hit} query={trimmed} />))
          : kindHits.map((hit) => hitRow(hit, <SearchHitRow hit={hit} query={trimmed} />)),
      });
    }
    if (tags?.length) {
      built.push({
        heading: "FORUM TAGS",
        rows: tags.map((tag) => ({
          value: `tag:${tag.slug}`,
          kind: "tag",
          local: {
            label: `#${tag.slug}`,
            detail: {
              type: "tag",
              slug: tag.slug,
              name: tag.name,
              usageCount: tag.usageCount,
            },
          },
          content: (
            <>
              <span className="text-muted-foreground">#</span>
              <span>{tag.slug}</span>
              <CommandShortcut>{tag.usageCount}</CommandShortcut>
            </>
          ),
          perform: () => void navigate({ to: "/forum/tags/$tag", params: { tag: tag.slug } }),
        })),
      });
    }
    for (const group of rest) {
      const matched = filterCommands(group, trimmed);
      if (matched.commands.length > 0) {
        built.push({ heading: group.heading, rows: matched.commands.map(commandRow) });
      }
    }
    return built;
  }, [hits, trimmed, tags, actions, rest, navigate]);

  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const firstValue = rows[0]?.value ?? "";
  // A late server answer can put a top hit above the row cmdk selected;
  // Enter should take the top hit.
  const [firstSeen, setFirstSeen] = useState(firstValue);
  if (firstValue !== firstSeen) {
    setFirstSeen(firstValue);
    setSelected(firstValue);
  }
  // The highlight itself is instant; the preview pane and the route
  // preload wait for it to rest, so sweeping the pointer down a list
  // doesn't swap the pane (and load its art) once per row.
  const previewValue = useDebouncedValue(selected, PREVIEW_DELAY_MS);
  const previewRow = rows.find((row) => row.value === previewValue);
  const previewHit = previewRow?.hit;
  useEffect(() => {
    if (previewHit) router.preloadRoute(hitLinkOptions(previewHit)).catch(() => {});
  }, [previewHit, router]);

  useSearchPerformed({
    surface: "command_palette",
    query: open ? trimmed : undefined,
    filterKinds: [],
    resultCount: settled ? rows.length : null,
    properties: {
      engine: showHits ? (search.data?.engine ?? null) : "local",
      kinds: [...new Set(hits.map((hit) => hit.kind))],
    },
  });

  const choose = useCallback(
    (row: Row) => {
      captureEvent(EVENTS.searchResultSelected, {
        surface: "command_palette",
        kind: row.kind,
        position: rows.indexOf(row) + 1,
        query_length: trimmed.length,
      });
      setOpen(false);
      row.perform();
    },
    [rows, trimmed, setOpen],
  );

  const list = useMemo(
    () => <PaletteSections sections={sections} onChoose={choose} />,
    [sections, choose],
  );

  const pending = showHits && search.isPending;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Search the site, commands, bots, and macros"
      className="top-[10vh] max-md:inset-0 max-md:top-0 max-md:h-dvh max-md:max-w-none max-md:translate-x-0 max-md:rounded-none md:max-w-4xl"
    >
      <Command
        className="font-mono max-md:h-dvh"
        shouldFilter={false}
        value={selected}
        onValueChange={setSelected}
      >
        <CommandInput
          size="lg"
          placeholder="Search jams, members, teams, posts, commands..."
          value={query}
          onValueChange={setQuery}
        />
        <div className="flex min-h-0 flex-1">
          <CommandList className="max-h-none min-w-0 flex-1 max-md:h-full md:max-h-[min(36rem,72vh)]">
            {pending || !listReady ? null : (
              <CommandEmpty>
                <span className="font-mono text-xs text-destructive">
                  {"// PROTOCOL NOT FOUND"}
                </span>
              </CommandEmpty>
            )}
            {pending || !listReady ? <SkeletonGroup /> : null}
            {listReady ? list : null}
          </CommandList>
          <aside className="hidden w-72 shrink-0 overflow-x-hidden overflow-y-auto border-l md:block">
            {previewHit ? (
              <SearchPreview hit={previewHit} />
            ) : previewRow?.local ? (
              <CommandPreview label={previewRow.local.label} detail={previewRow.local.detail} />
            ) : null}
          </aside>
        </div>

        <div className="flex items-center gap-3 border-t border-muted/40 px-3 py-2 font-mono text-[10px] text-muted-foreground/60">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span className="ml-auto max-md:hidden">ctrl+k to toggle</span>
        </div>
      </Command>
    </CommandDialog>
  );
}

const PaletteSections = memo(function PaletteSections({
  sections,
  onChoose,
}: {
  sections: Section[];
  onChoose: (row: Row) => void;
}) {
  return sections.map((section) =>
    section.rail ? (
      <CommandGroup key={section.heading} className="px-2 pt-1">
        <Rail title={section.heading} variant="label" bleed={false}>
          {section.rows.map((row) => (
            <CommandItem
              key={row.value}
              value={row.value}
              onSelect={() => onChoose(row)}
              className="w-36 shrink-0 flex-col items-stretch gap-1.5 p-1.5 [&>svg:last-child]:hidden"
            >
              {row.content}
            </CommandItem>
          ))}
        </Rail>
      </CommandGroup>
    ) : (
      <CommandGroup key={section.heading} heading={section.heading}>
        {section.rows.map((row) => (
          <CommandItem key={row.value} value={row.value} onSelect={() => onChoose(row)}>
            {row.content}
          </CommandItem>
        ))}
      </CommandGroup>
    ),
  );
});

function SkeletonGroup() {
  return (
    <div className="flex flex-col gap-2 px-2 py-2" aria-hidden>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
    </div>
  );
}
