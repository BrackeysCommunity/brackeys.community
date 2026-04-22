import { ArrowDown01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineCode } from "@/components/ui/typography/inline-code";
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
  copyText: string;
  /** Optional shorter form shown alongside `copyText` (e.g. Marco's `[]name`). */
  altCopyText?: string;
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
    <li className="group/row relative border-b border-muted-foreground/20 transition-colors hover:bg-muted/40 has-[>button:focus-visible]:bg-muted/30 has-[>button:focus-visible]:outline-2 has-[>button:focus-visible]:-outline-offset-2 has-[>button:focus-visible]:outline-primary">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full flex-col text-left focus:outline-none focus-visible:outline-none"
      >
        <div className="flex w-full items-center gap-3 px-4 py-2.5">
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
            {entry.aliases?.map((alias) => (
              <Badge key={alias} variant="outline" className="font-mono text-[10px]">
                []{alias}
              </Badge>
            ))}
          </div>

          {/* Expand chevron */}
          <motion.span
            animate={{ scaleY: expanded ? -1 : 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 18 }}
            className="inline-flex shrink-0 text-muted-foreground"
          >
            <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
          </motion.span>
        </div>

        {/* Summary (collapsed) — grid-rows trick for smooth height tween */}
        <div
          className={cn(
            "grid w-full transition-[grid-template-rows,opacity] duration-250 ease-out",
            expanded ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
          )}
        >
          <div className="overflow-hidden">
            <MarkedText
              inline
              className="block truncate px-4 pb-2.5 pl-[52px] text-xs text-muted-foreground"
            >
              {entry.description}
            </MarkedText>
          </div>
        </div>
      </button>

      {/* Body (expanded) — same trick, inverse rows; inert when collapsed so
          tabbing skips over interactive children (copy button, links). */}
      <div
        inert={!expanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden border-l-2 border-primary/60 bg-muted/20">
          <div className="px-4 py-3 pl-[52px]">
            {entry.body ? (
              <MarkedText className="text-xs text-muted-foreground">{entry.body}</MarkedText>
            ) : (
              <p className="text-xs text-foreground">{entry.description}</p>
            )}

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-muted/30 pt-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span className="shrink-0 font-mono text-xs tracking-widest text-muted-foreground uppercase">
                  Example:
                </span>
                <InlineCode className="min-w-0 truncate border-brackeys-yellow/40 bg-brackeys-yellow-muted/20 px-2 py-1 text-xs text-brackeys-yellow [--emboss-shadow:var(--color-brackeys-yellow)]">
                  {entry.copyText}
                </InlineCode>
                {entry.altCopyText && (
                  <>
                    <span className="shrink-0 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                      or
                    </span>
                    <InlineCode className="min-w-0 truncate border-brackeys-yellow/40 bg-brackeys-yellow-muted/20 px-2 py-1 text-xs text-brackeys-yellow [--emboss-shadow:var(--color-brackeys-yellow)]">
                      {entry.altCopyText}
                    </InlineCode>
                  </>
                )}
              </div>
              <Button
                data-magnetic
                data-cursor-no-drift
                variant="outline"
                size="xs"
                onClick={handleCopy}
                className="gap-1.5 font-mono text-[10px] tracking-widest uppercase focus-visible:border-primary focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:ring-0 focus-visible:[--emboss-shadow:color-mix(in_srgb,var(--primary)_50%,black)]"
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
