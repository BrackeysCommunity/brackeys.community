import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";

import { ProfileSectionHeader } from "@/components/profile/ProfilePage/ProfileSectionHeader";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { signInWithDiscord } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/** Shared furniture for the `/settings` panes — one voice across all four. */

export function SettingsSection({
  index,
  title,
  hint,
  action,
  children,
}: {
  index: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <ProfileSectionHeader index={index} title={title} action={action} />
        {hint ? (
          <Text size="xs" variant="muted" className="max-w-prose">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Selected-tile classes for a `Button variant="outline"`. `--emboss-shadow`
 * is what `chonk-emboss` paints both the border and the drop edge from, so
 * one variable turns the whole frame primary; `aria-pressed` then flattens
 * the lift, which is how every other toggle in the app reads as "on".
 */
const OPTION_ACTIVE =
  "bg-primary/10 text-primary [--emboss-shadow:var(--primary)] hover:bg-primary/15 dark:bg-primary/10 dark:hover:bg-primary/15";

/**
 * A selectable tile — the theme gallery, and any option that needs a preview
 * above its label. A real `Button` so it carries the house click cues, the
 * emboss lift, and the depressed selected state.
 */
export function OptionCard({
  active,
  title,
  description,
  onClick,
  className,
  children,
}: {
  active: boolean;
  title: string;
  description?: string;
  onClick: () => void;
  className?: string;
  /** Rendered above the title — the theme cards' live preview. */
  children?: React.ReactNode;
}) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-auto w-full flex-col items-stretch justify-start gap-2 p-3 text-left whitespace-normal",
        active && OPTION_ACTIVE,
        className,
      )}
    >
      {children}
      {/* Spans, not divs — a `<button>` takes phrasing content only. */}
      <span className="flex min-w-0 flex-col gap-0.5">
        <Text
          as="span"
          size="xs"
          className={cn("tracking-widest uppercase", active ? "text-primary" : "text-foreground")}
        >
          {title}
        </Text>
        {description ? (
          <Text as="span" size="xs" variant="muted" className="line-clamp-2">
            {description}
          </Text>
        ) : null}
      </span>
    </Button>
  );
}

/**
 * One segment of a joined choice group — the motion modes. Same selected
 * read as {@link OptionCard}, laid out as a two-line button so a `ButtonGroup`
 * can collapse the seams between them.
 */
export function OptionSegment({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // `shrink` undoes the button's own `shrink-0` so the three segments
        // split the row evenly instead of sizing to their longest label.
        "h-auto flex-1 shrink flex-col items-start justify-start gap-0.5 px-3 py-2.5 text-left whitespace-normal",
        active && OPTION_ACTIVE,
      )}
    >
      <Text
        as="span"
        size="xs"
        className={cn("tracking-widest uppercase", active ? "text-primary" : "text-foreground")}
      >
        {title}
      </Text>
      {description ? (
        <Text as="span" size="xs" variant="muted">
          {description}
        </Text>
      ) : null}
    </Button>
  );
}

/** Label + hint on the left, one control on the right. */
export function SettingRow({
  label,
  hint,
  icon,
  control,
}: {
  label: string;
  hint: string;
  icon?: IconSvgElement;
  control: React.ReactNode;
}) {
  return (
    <Well className="flex-row items-center gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Text size="xs" className="flex items-center gap-2 tracking-widest uppercase">
          {icon ? <HugeiconsIcon icon={icon} size={14} className="text-muted-foreground" /> : null}
          {label}
        </Text>
        <Text size="xs" variant="muted">
          {hint}
        </Text>
      </div>
      {control}
    </Well>
  );
}

/** What the signed-out viewer gets in the account-bound panes. */
export function SignedOutNotice({ children }: { children: React.ReactNode }) {
  return (
    <Well className="items-center gap-3 p-10" variant="ghost">
      <Text size="sm" variant="muted" align="center" className="max-w-sm">
        {children}
      </Text>
      <Button
        variant="default"
        size="sm"
        className="text-xs font-bold tracking-widest"
        onClick={() => signInWithDiscord()}
      >
        LOGIN
      </Button>
    </Well>
  );
}
