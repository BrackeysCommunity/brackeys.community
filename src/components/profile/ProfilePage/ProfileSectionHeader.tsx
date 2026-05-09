import { Add01Icon, ArrowRight01Icon, Edit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

interface ProfileSectionHeaderProps {
  /** Two-digit slug — drives the leading `§01` chip. */
  index: string;
  /** Title text — rendered uppercase in the wireframes' visual style. */
  title: string;
  /** Optional right-aligned action — usually "EDIT §" or "+ ADD" or
   * "VIEW ALL →". Pass a node so callers can wire whatever they need. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * The dotted-rule section heading used across the redesigned profile
 * (`§01 ABOUT ········· EDIT §`). The dotted line fills the gap between
 * the title and any trailing action so the layout reads as a single
 * coded "block delimiter" rather than a normal heading + button row.
 */
export function ProfileSectionHeader({
  index,
  title,
  action,
  className,
}: ProfileSectionHeaderProps) {
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

/** `EDIT §` action — jumps the edit flyout to this section's step. */
export function EditSectionAction({ onEdit }: { onEdit: () => void }) {
  return (
    <Button variant="outline" size="xs" onClick={onEdit} className="font-mono tracking-widest">
      <HugeiconsIcon icon={Edit02Icon} size={12} />
      EDIT
    </Button>
  );
}

/** "+ ADD" action — same flyout, scoped to a section that supports
 * inline create (PROJECTS, LINKS, SKILLS). */
export function AddSectionAction({ onAdd, label = "ADD" }: { onAdd: () => void; label?: string }) {
  return (
    <Button variant="outline" size="xs" onClick={onAdd} className="font-mono tracking-widest">
      <HugeiconsIcon icon={Add01Icon} size={12} />
      {label}
    </Button>
  );
}

/** "VIEW ALL →" used by sections that open into a longer index. */
export function ViewAllAction({ onClick }: { onClick?: () => void }) {
  return (
    <Button variant="outline" size="xs" onClick={onClick} className="font-mono tracking-widest">
      VIEW ALL
      <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
    </Button>
  );
}
