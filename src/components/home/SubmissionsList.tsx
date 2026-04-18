import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDebounceFn } from "ahooks";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useMemo, useState } from "react";

import type { JamEntry } from "@/lib/jam-store";

const PLATFORM_LABELS: Record<string, string> = {
  windows: "WIN",
  osx: "MAC",
  linux: "LNX",
  web: "WEB",
  android: "AND",
  ios: "iOS",
};

function SubmissionCard({ entry }: { entry: JamEntry }) {
  const [expanded, setExpanded] = useState(false);

  const { run: scheduleExpand, cancel: cancelExpand } = useDebounceFn(() => setExpanded(true), {
    wait: 140,
  });

  const handleMouseEnter = () => scheduleExpand();
  const handleMouseLeave = () => {
    cancelExpand();
    setExpanded(false);
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative flex flex-col px-3 py-2.5 transition-all duration-200 ${
        expanded
          ? "z-20 -translate-y-px border-x border-primary/40 bg-card/80 shadow-[0_6px_24px_rgba(0,0,0,0.6)]"
          : "z-0"
      }`}
    >
      {/* Main row: cover + title/meta + link button */}
      <div className="flex items-center gap-2.5">
        {/* Cover thumbnail */}
        <div className="h-10 w-10 shrink-0 overflow-hidden bg-muted/40">
          {entry.game.cover ? (
            <img
              src={entry.game.cover}
              alt={entry.game.title}
              className={`h-full w-full object-cover transition-all duration-300 ${
                expanded ? "grayscale-0" : "grayscale"
              }`}
            />
          ) : (
            <div
              className="h-full w-full"
              style={{ backgroundColor: entry.game.cover_color ?? "#111" }}
            />
          )}
        </div>

        {/* Title + author + platforms */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <code
            className={`max-w-full self-start truncate border px-1.5 py-0.5 font-mono text-xs font-bold transition-colors duration-150 ${
              expanded
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-brackeys-yellow/30 bg-brackeys-yellow/10 text-brackeys-yellow"
            }`}
          >
            {entry.game.title}
          </code>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-mono text-[10px] text-muted-foreground/60">
              {entry.game.user.name}
            </span>
            {entry.game.platforms.slice(0, 4).map((p) => (
              <span
                key={p}
                className="border border-muted/40 px-1 py-px font-mono text-[10px] leading-none font-bold tracking-widest text-muted-foreground/50"
              >
                {PLATFORM_LABELS[p] ?? p.toUpperCase()}
              </span>
            ))}
          </div>
        </div>

        {/* External link button — fades in on expand */}
        <a
          href={`https://itch.io${entry.url}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`flex shrink-0 items-center gap-1 border bg-black px-2 py-1 font-mono text-[10px] font-bold text-muted-foreground uppercase transition-all duration-150 hover:text-white ${
            expanded
              ? "border-primary/40 opacity-100 hover:border-primary"
              : "pointer-events-none border-muted opacity-0"
          }`}
        >
          <HugeiconsIcon icon={LinkSquare02Icon} size={11} />
          View
        </a>
      </div>

      {/* Expandable description */}
      <div
        className={`overflow-hidden transition-all duration-250 ease-out ${
          expanded ? "mt-2 max-h-24 opacity-100" : "mt-0 max-h-0 opacity-0"
        }`}
      >
        <p className="max-h-20 overflow-y-auto pr-1 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {entry.game.short_text || (
            <span className="text-muted-foreground/30 italic">No description provided.</span>
          )}
        </p>
      </div>
    </div>
  );
}

export function SubmissionsList({ entries }: { entries: JamEntry[] }) {
  const [viewport, setViewport] = useState<Element | null>(null);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => viewport,
    estimateSize: () => 60,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (i) => entries[i].id,
  });

  const osEvents = useMemo(
    () => ({
      initialized: (instance: { elements(): { viewport: Element } }) =>
        setViewport(instance.elements().viewport),
    }),
    [],
  );

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/40">
        <span className="font-mono text-xs tracking-widest uppercase">No entries yet</span>
      </div>
    );
  }

  return (
    <OverlayScrollbarsComponent
      element="div"
      className="h-full"
      options={{
        scrollbars: {
          theme: "os-theme-dark",
          autoHide: "scroll",
          autoHideDelay: 800,
        },
      }}
      events={osEvents}
      defer
    >
      <ul className="relative" style={{ height: virtualizer.getTotalSize(), width: "100%" }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const entry = entries[vItem.index];
          return (
            <li
              key={vItem.key}
              ref={virtualizer.measureElement}
              data-index={vItem.index}
              className="absolute top-0 left-0 w-full list-none border-b border-muted/20"
              style={{ transform: `translateY(${vItem.start}px)` }}
            >
              <SubmissionCard entry={entry} />
            </li>
          );
        })}
      </ul>
    </OverlayScrollbarsComponent>
  );
}
