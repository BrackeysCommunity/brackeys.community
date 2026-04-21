import { ArrowDown01Icon, Copy01Icon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkedText } from "@/components/ui/typography/marked-text";
import { cn } from "@/lib/utils";

export interface CommandEntryData {
  id: string;
  index: number;
  label: string;
  bot: "hammer" | "pencil" | "marco";
  description: string;
  /** Optional extended body rendered via MarkedText when expanded. */
  body?: string;
  aliases?: string[];
  tags?: string[];
  popular?: boolean;
  copyText: string;
}

interface CommandEntryProps {
  entry: CommandEntryData;
}

const botBadgeVariant: Record<
  CommandEntryData["bot"],
  React.ComponentProps<typeof Badge>["variant"]
> = {
  hammer: "secondary",
  pencil: "default",
  marco: "outline",
};

export function CommandEntry({ entry }: CommandEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(entry.copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <li className="border-b border-muted/30 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        {/* Index */}
        <span className="w-6 shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground tabular-nums">
          {String(entry.index).padStart(2, "0")}
        </span>

        {/* Label + meta */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px] text-brackeys-yellow">
            {entry.label}
          </Badge>
          <Badge
            variant={botBadgeVariant[entry.bot]}
            className="font-mono text-[10px] tracking-widest uppercase"
          >
            {entry.bot}
          </Badge>
          {entry.popular && (
            <Badge variant="destructive" className="gap-1 font-mono text-[10px] uppercase">
              <HugeiconsIcon icon={StarIcon} size={10} />
              popular
            </Badge>
          )}
          {entry.aliases?.map((alias) => (
            <Badge key={alias} variant="outline" className="font-mono text-[10px]">
              /{alias}
            </Badge>
          ))}
        </div>

        {/* Expand chevron */}
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 text-muted-foreground"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
        </motion.span>
      </button>

      {/* Summary (collapsed) — grid-rows trick for smooth height tween */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-250 ease-out",
          expanded ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="overflow-hidden">
          <p className="truncate px-4 pb-2.5 pl-[52px] font-mono text-xs text-muted-foreground">
            {entry.description}
          </p>
        </div>
      </div>

      {/* Body (expanded) — same trick, inverse rows */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden border-l-2 border-primary/60 bg-muted/20">
          <div className="px-4 py-3 pl-[52px]">
            {entry.body ? (
              <MarkedText className="font-mono text-xs text-muted-foreground">
                {entry.body}
              </MarkedText>
            ) : (
              <p className="font-mono text-xs text-foreground">{entry.description}</p>
            )}

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-muted/30 pt-3">
              <div className="flex min-w-0 items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                <span className="shrink-0">Example:</span>
                <code className="truncate border border-brackeys-yellow/30 bg-brackeys-yellow-muted/20 px-1.5 py-0.5 text-brackeys-yellow normal-case">
                  {entry.copyText}
                </code>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={handleCopy}
                className="gap-1.5 font-mono text-[10px] tracking-widest uppercase"
              >
                <HugeiconsIcon icon={Copy01Icon} size={12} />
                {copied ? "OK!" : "Copy"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
