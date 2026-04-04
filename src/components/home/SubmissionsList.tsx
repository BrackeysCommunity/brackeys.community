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
          ? "bg-card/80 border-x border-primary/40 shadow-[0_6px_24px_rgba(0,0,0,0.6)] -translate-y-px z-20"
          : "z-0"
      }`}
    >
      {/* Main row: cover + title/meta + link button */}
      <div className="flex items-center gap-2.5">
        {/* Cover thumbnail */}
        <div className="shrink-0 w-10 h-10 overflow-hidden bg-muted/40">
          {entry.game.cover ? (
            <img
              src={entry.game.cover}
              alt={entry.game.title}
              className={`w-full h-full object-cover transition-all duration-300 ${
                expanded ? "grayscale-0" : "grayscale"
              }`}
            />
          ) : (
            <div
              className="w-full h-full"
              style={{ backgroundColor: entry.game.cover_color ?? "#111" }}
            />
          )}
        </div>

        {/* Title + author + platforms */}
        <div className="flex-1 flex flex-col gap-0.5 min-w-0">
          <code
            className={`font-mono text-xs font-bold px-1.5 py-0.5 border self-start truncate max-w-full transition-colors duration-150 ${
              expanded
                ? "text-primary border-primary/60 bg-primary/10"
                : "text-brackeys-yellow bg-brackeys-yellow/10 border-brackeys-yellow/30"
            }`}
          >
            {entry.game.title}
          </code>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px] text-muted-foreground/60 truncate">
              {entry.game.user.name}
            </span>
            {entry.game.platforms.slice(0, 4).map((p) => (
              <span
                key={p}
                className="font-mono text-[10px] font-bold tracking-widest px-1 py-px border border-muted/40 text-muted-foreground/50 leading-none"
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
          className={`flex items-center gap-1 px-2 py-1 bg-black border text-muted-foreground hover:text-white transition-all duration-150 shrink-0 font-mono text-[10px] font-bold uppercase ${
            expanded
              ? "opacity-100 border-primary/40 hover:border-primary"
              : "opacity-0 border-muted pointer-events-none"
          }`}
        >
          <HugeiconsIcon icon={LinkSquare02Icon} size={11} />
          View
        </a>
      </div>

      {/* Expandable description */}
      <div
        className={`overflow-hidden transition-all duration-250 ease-out ${
          expanded ? "max-h-24 opacity-100 mt-2" : "max-h-0 opacity-0 mt-0"
        }`}
      >
        <p className="text-xs font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-20 pr-1">
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
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground/40">
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
              className="absolute top-0 left-0 w-full border-b border-muted/20 list-none"
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
