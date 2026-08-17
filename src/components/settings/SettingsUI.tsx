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
 * A selectable tile — the motion modes and, in a richer form, the theme
 * gallery. The active one is bordered in accent rather than filled, so a
 * grid of them stays readable in the light themes too.
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
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex cursor-pointer flex-col items-stretch gap-2 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "border-accent bg-accent/10"
          : "border-muted/40 bg-card/40 hover:border-muted hover:bg-card/70",
        className,
      )}
    >
      {children}
      {/* Spans, not divs — a `<button>` takes phrasing content only. */}
      <span className="flex min-w-0 flex-col gap-0.5">
        <Text
          as="span"
          size="xs"
          className={cn("tracking-widest uppercase", active ? "text-accent" : "text-foreground")}
        >
          {title}
        </Text>
        {description ? (
          <Text as="span" size="xs" variant="muted" className="line-clamp-2">
            {description}
          </Text>
        ) : null}
      </span>
    </button>
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
