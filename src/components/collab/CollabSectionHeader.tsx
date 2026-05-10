import { Add01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

interface CollabSectionHeaderProps {
  /** Two-digit slug — drives the leading `§01` chip. */
  index: string;
  /** Title text — rendered uppercase. */
  title: string;
  /** Optional right-aligned action node. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Dotted-rule section heading: `§01 FIND ········· ACTION`. Mirrors the
 * coded-block style used across the redesigned profile.
 */
export function CollabSectionHeader({ index, title, action, className }: CollabSectionHeaderProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Text
        as="span"
        monospace
        size="xs"
        variant="muted"
        className="rounded bg-muted/40 px-1.5 py-0.5 tracking-widest tabular-nums"
      >
        §{index}
      </Text>
      <Heading
        as="h2"
        monospace
        className="text-base font-bold tracking-widest text-foreground uppercase"
      >
        {title}
      </Heading>
      <div aria-hidden className="flex-1 border-t border-dashed border-muted-foreground/30" />
      {action ? (
        <div className="flex items-center gap-1.5 text-muted-foreground">{action}</div>
      ) : null}
    </div>
  );
}

export function AddSectionAction({ onAdd, label = "ADD" }: { onAdd: () => void; label?: string }) {
  return (
    <Button variant="outline" size="xs" onClick={onAdd} className="font-mono tracking-widest">
      <HugeiconsIcon icon={Add01Icon} size={12} />
      {label}
    </Button>
  );
}

export function ViewAllAction({ onClick }: { onClick?: () => void }) {
  return (
    <Button variant="outline" size="xs" onClick={onClick} className="font-mono tracking-widest">
      VIEW ALL
      <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
    </Button>
  );
}
