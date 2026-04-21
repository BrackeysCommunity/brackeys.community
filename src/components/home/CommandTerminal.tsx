import { ComputerTerminal01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CommandEntry, type CommandEntryData } from "@/components/home/CommandEntry";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

export type CommandCategory =
  | "all"
  | "moderation"
  | "utility"
  | "learning"
  | "fun"
  | "gamification";

export const COMMAND_CATEGORIES: { id: CommandCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "moderation", label: "Moderation" },
  { id: "utility", label: "Utility" },
  { id: "learning", label: "Learning" },
  { id: "fun", label: "Fun" },
  { id: "gamification", label: "Gamification" },
];

interface CommandTerminalProps {
  entries: CommandEntryData[];
  totalCount: number;
  category: CommandCategory;
  onCategoryChange: (c: CommandCategory) => void;
  search: string;
  onSearchChange: (s: string) => void;
  scopeLabel: string;
  className?: string;
}

export function CommandTerminal({
  entries,
  totalCount,
  category,
  onCategoryChange,
  search,
  onSearchChange,
  scopeLabel,
  className,
}: CommandTerminalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const [cursorX, setCursorX] = useState(0);

  // Focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Block cursor positioning — measure text width at caret via hidden mirror
  const updateCursor = useCallback(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    const pos = input.selectionStart ?? input.value.length;
    mirror.textContent = input.value.slice(0, pos).toUpperCase();
    setCursorX(mirror.getBoundingClientRect().width - (input.scrollLeft ?? 0));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: search triggers cursor recalc
  useLayoutEffect(() => {
    updateCursor();
  }, [search, updateCursor]);

  return (
    <Well
      notchOpts={{ size: 16 }}
      className={cn("flex max-h-[calc(100dvh-10rem)] flex-col", className)}
    >
      {/* Title bar */}
      <div className="mt-1 flex shrink-0 items-center justify-between border-b border-muted/40 bg-muted/50 px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground uppercase">
          <HugeiconsIcon icon={ComputerTerminal01Icon} size={12} className="text-brackeys-yellow" />
          ROOT@BRACKEYS-SERVER:~
        </span>
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          <span className="text-foreground">{entries.length}</span> / <span>{totalCount}</span>{" "}
          PROTOCOLS
        </span>
      </div>

      {/* Search bar */}
      <div className="shrink-0 border-b border-muted/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="shrink-0 font-mono text-lg leading-none font-bold text-primary">
            &gt;
          </span>
          <div className="relative flex-1 overflow-hidden">
            <span
              ref={mirrorRef}
              aria-hidden
              className="pointer-events-none invisible absolute top-0 left-0 font-mono text-sm whitespace-pre uppercase"
            />
            <input
              ref={inputRef}
              autoComplete="off"
              spellCheck="false"
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onSelect={updateCursor}
              onKeyUp={updateCursor}
              onKeyDown={(e) => e.key === "Escape" && onSearchChange("")}
              placeholder="SEARCH COMMANDS…"
              className="w-full border-none bg-transparent p-0 font-mono text-sm text-brackeys-yellow uppercase placeholder-muted-foreground/50 caret-transparent outline-none focus:ring-0"
            />
            <span
              className="pointer-events-none absolute top-1/2 h-[1.15em] w-[0.55em] -translate-y-1/2 bg-brackeys-yellow"
              style={{ left: cursorX, animation: "terminal-blink 1.1s step-end infinite" }}
            />
          </div>
          <kbd className="shrink-0 border border-muted/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Category tabs + scope */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-muted/40 bg-muted/20 px-3 py-2">
        <SegmentedControl
          value={category}
          onChange={(v) => onCategoryChange(v as CommandCategory)}
          size="xs"
          className="flex-wrap"
        >
          {COMMAND_CATEGORIES.map((c) => (
            <SegmentedControl.Item key={c.id} value={c.id}>
              <span className="font-mono tracking-widest uppercase">{c.label}</span>
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
        <span className="shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          Scope: <span className="text-primary">{scopeLabel}</span>
        </span>
      </div>

      {/* Command list — virtualized */}
      <VirtualizedCommandList entries={entries} />

      {/* Footer status */}
      <div className="mt-auto flex shrink-0 items-center justify-between border-t border-muted/40 bg-muted/50 px-4 py-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        <span className="flex items-center gap-2">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          Ready · <span className="text-foreground">{entries.length}</span> results
        </span>
        <span className="animate-pulse">Awaiting input</span>
      </div>
    </Well>
  );
}

/**
 * Virtualized scrolling list for command entries. Each row's height is
 * dynamic (entries expand in place), so `measureElement` observes DOM size
 * and reports back to the virtualizer.
 */
function VirtualizedCommandList({ entries }: { entries: CommandEntryData[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (i) => entries[i].id,
  });

  if (entries.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-12 font-mono text-xs tracking-widest text-muted-foreground uppercase">
        <HugeiconsIcon icon={ComputerTerminal01Icon} size={16} className="mr-2" />
        No protocols match this query
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <ul className="relative block" style={{ height: virtualizer.getTotalSize(), width: "100%" }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const entry = entries[vItem.index];
          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              <CommandEntry entry={entry} />
            </div>
          );
        })}
      </ul>
    </div>
  );
}
