import { ArrowDown01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineCode, MarkedText, MicroLabel, Text } from "@/components/ui/typography";
import type { BotId } from "@/data/commands";
import { HOVER_CUE, play, playReveal } from "@/lib/sound";
import { cn } from "@/lib/utils";

export interface CommandRowData {
  id: string;
  /** Rendered invocation — `/rule` or `[]xyproblem`. */
  label: string;
  bot: BotId;
  description: string;
  /** Optional extended body rendered via MarkedText when expanded. */
  body?: string;
  aliases?: string[];
  copyText: string;
  /** Optional shorter form shown alongside `copyText` (e.g. Marco's `[]name`). */
  altCopyText?: string;
}

/**
 * One command in a shelf's list frame: an expandable disclosure row on the
 * same dress as the jam board's dense list — hairline separators from the
 * parent, hover wash, reveal/dismiss cues on the toggle.
 */
export function CommandRow({ entry, className }: { entry: CommandRowData; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const toggle = () => {
    playReveal(!expanded);
    setExpanded(!expanded);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(entry.copyText);
    play("success");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <li className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        {...HOVER_CUE}
        className="flex w-full cursor-pointer items-baseline gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/20 focus-visible:bg-muted/20 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <MicroLabel variant="accent" className="shrink-0">
          {entry.label}
        </MicroLabel>
        {/* The summary hides while the body is open — for macros it *is* the
            body's first line, and doubling it reads as a stutter. */}
        <Text
          as="div"
          size="sm"
          variant="muted"
          ellipsis
          className={cn("min-w-0 flex-1 transition-opacity duration-200", expanded && "opacity-0")}
        >
          {entry.description}
        </Text>
        <motion.span
          animate={{ scaleY: expanded ? -1 : 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 18 }}
          className="inline-flex shrink-0 self-center text-muted-foreground"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
        </motion.span>
      </button>

      {/* Grid-rows height tween; inert when collapsed so tabbing skips the
          copy button and any links in the body. */}
      <div
        inert={!expanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-l-2 border-primary/60 bg-muted/10 px-4 py-3">
            {entry.body ? (
              <MarkedText className="text-xs text-muted-foreground">{entry.body}</MarkedText>
            ) : (
              <Text as="p" size="sm">
                {entry.description}
              </Text>
            )}

            {entry.aliases && entry.aliases.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MicroLabel className="shrink-0">ALIASES</MicroLabel>
                {entry.aliases.map((alias) => (
                  <Badge key={alias} size="label" variant="outline">
                    []{alias}
                  </Badge>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-muted/20 pt-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <MicroLabel className="shrink-0">EXAMPLE</MicroLabel>
                <InlineCode className="min-w-0 truncate text-xs">{entry.copyText}</InlineCode>
                {entry.altCopyText && (
                  <>
                    <MicroLabel className="shrink-0">OR</MicroLabel>
                    <InlineCode className="min-w-0 truncate text-xs">
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
                className="tracking-widest"
              >
                <HugeiconsIcon icon={Copy01Icon} size={12} />
                {copied ? "COPIED" : "COPY"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
