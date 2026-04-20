import { DiamondIcon, FlashIcon, Globe02Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useEffect } from "react";

import { Countdown } from "@/components/home/Countdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Well } from "@/components/ui/well";
import useDateNow from "@/lib/hooks/use-date-now";
import { jamStore, setJamData, setJamError, setJamLoading } from "@/lib/jam-store";
import type { JamEntry } from "@/lib/jam-store";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

const JAM_DEADLINE = new Date("2026-02-22T11:00:00Z");
const DEADLINE_LOCAL = JAM_DEADLINE.toLocaleString(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function LivePill({ over }: { over: boolean }) {
  if (over) {
    return (
      <Badge variant="outline" className="font-mono text-[10px] tracking-widest uppercase">
        // ENDED
      </Badge>
    );
  }
  return (
    <Badge
      variant="destructive"
      className="gap-1.5 font-mono text-[10px] tracking-widest uppercase"
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-destructive opacity-75" />
        <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
      </span>
      // LIVE
    </Badge>
  );
}

function EntryRow({ rank, entry }: { rank: number; entry: JamEntry }) {
  return (
    <a
      href={entry.game.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 border-b border-muted/30 px-3 py-2 transition-colors last:border-b-0 hover:bg-muted/50"
    >
      <span className="w-8 shrink-0 font-mono text-xs tracking-widest text-muted-foreground tabular-nums">
        #{rank}
      </span>
      <div className="h-8 w-8 shrink-0 overflow-hidden bg-muted/70">
        {entry.game.cover ? (
          <img
            src={entry.game.cover}
            alt=""
            className="h-full w-full object-cover grayscale transition-all duration-300 group-hover:grayscale-0"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{ backgroundColor: entry.game.cover_color ?? "#111" }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs font-bold text-foreground group-hover:text-primary">
          {entry.game.title}
        </div>
        <div className="truncate font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          {entry.game.user.name}
        </div>
      </div>
      <span className="shrink-0 font-mono text-xs tracking-widest text-info tabular-nums">
        {Math.round(entry.coolness)}
      </span>
      <HugeiconsIcon
        icon={LinkSquare02Icon}
        size={12}
        className="shrink-0 text-muted-foreground/40 group-hover:text-primary"
      />
    </a>
  );
}

function FallbackEntries() {
  const rows = [
    { title: "Ignore the Blackbird", author: "Ava Mori", score: "9.76" },
    { title: "Strange and Lazy", author: "sabinap", score: "9.68" },
    { title: "Flipchick", author: "pipewool", score: "9.61" },
    { title: "Don't Forget", author: "luv, las, cor", score: "9.58" },
    { title: "COLD PHOTOS", author: "coldstudio", score: "9.49" },
  ];
  return (
    <div className="flex flex-col">
      {rows.map((r, i) => (
        <div
          key={r.title}
          className="flex items-center gap-3 border-b border-muted/30 px-3 py-2 last:border-b-0"
        >
          <span className="w-8 shrink-0 font-mono text-xs tracking-widest text-muted-foreground tabular-nums">
            #{i + 1}
          </span>
          <div className="h-8 w-8 shrink-0 bg-muted/70" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs font-bold text-foreground">{r.title}</div>
            <div className="truncate font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              {r.author}
            </div>
          </div>
          <span className="shrink-0 font-mono text-xs tracking-widest text-info tabular-nums">
            {r.score}
          </span>
        </div>
      ))}
    </div>
  );
}

export function JamPanel({ className }: { className?: string }) {
  const { joinedCount, submissionCount, submissions, loading } = useStore(jamStore);
  const timeNow = useDateNow();
  const isOver = timeNow >= JAM_DEADLINE.getTime();

  const { data, isLoading, isError } = useQuery({
    ...orpc.getJamData.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
  useEffect(() => {
    setJamLoading(isLoading);
  }, [isLoading]);
  useEffect(() => {
    if (data) setJamData(data);
  }, [data]);
  useEffect(() => {
    if (isError) setJamError("Failed to load jam data");
  }, [isError]);

  const topEntries = [...submissions].sort((a, b) => b.coolness - a.coolness).slice(0, 10);

  return (
    <Well notchOpts={{ size: 16 }} className={className}>
      {/* Header */}
      <div className="mt-1 flex items-center justify-between border-b border-muted/40 bg-muted/50 px-4 py-2.5">
        <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
          JAM · 2026.1
        </span>
        <LivePill over={isOver} />
      </div>

      {/* Diagonal-striped deadline block */}
      <div
        className="flex flex-col items-center gap-2 border-b border-muted/40 px-5 py-6 text-center"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, transparent 0 10px, rgba(255,255,255,0.02) 10px 11px)",
        }}
      >
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          // DEADLINE
        </span>
        <Countdown targetDate={JAM_DEADLINE} precision="dhm" />
        <span className="font-mono text-[11px] tracking-wider text-muted-foreground">
          {DEADLINE_LOCAL}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 divide-x divide-muted/40 border-b border-muted/40">
        <div className="flex flex-col gap-1 px-4 py-3">
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            Entrants
          </span>
          <span
            className={cn(
              "font-mono text-2xl font-bold tracking-tight text-info tabular-nums",
              loading && "animate-pulse opacity-40",
            )}
          >
            {joinedCount ?? "—"}
          </span>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3">
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            Entries
          </span>
          <span
            className={cn(
              "font-mono text-2xl font-bold tracking-tight text-brackeys-fuscia tabular-nums",
              loading && "animate-pulse opacity-40",
            )}
          >
            {submissionCount ?? "—"}
          </span>
        </div>
      </div>

      {/* Top entries header */}
      <div className="flex items-center justify-between border-b border-muted/40 px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground uppercase">
          <HugeiconsIcon icon={DiamondIcon} size={10} className="text-primary" />
          Top Entries
        </span>
        <button
          type="button"
          className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase transition-colors hover:text-primary"
        >
          View All →
        </button>
      </div>

      {/* Top entries list */}
      <div className="flex flex-col">
        {topEntries.length > 0 ? (
          topEntries.map((entry, i) => <EntryRow key={entry.id} rank={i + 1} entry={entry} />)
        ) : (
          <FallbackEntries />
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-auto flex gap-2 border-t border-muted/40 p-3">
        <Button
          data-magnetic
          data-magnetic-strength=""
          data-cursor-no-drift
          variant="default"
          size="sm"
          className="flex-[3]"
          onClick={() => window.open("https://itch.io/jam/brackeys-14", "_blank")}
        >
          <HugeiconsIcon icon={FlashIcon} size={13} />
          Submit Entry
        </Button>
        <Button
          data-magnetic
          data-magnetic-strength=""
          data-cursor-no-drift
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => window.open("https://itch.io/jam/brackeys-14/entries", "_blank")}
        >
          <HugeiconsIcon icon={Globe02Icon} size={13} />
          Browse
        </Button>
      </div>
    </Well>
  );
}
