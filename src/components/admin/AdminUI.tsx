import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { GraphPaper } from "@/components/ui/graph-paper";
import { Textarea } from "@/components/ui/textarea";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { profileLinkParams } from "@/lib/profile-links";
import { cn } from "@/lib/utils";

/** Shared furniture for the `/admin` sections — one voice across all five tabs. */

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * The page's masthead, built like every other detail hero — notched well,
 * gradient wash, graph ruling behind the headline. The counts live in it
 * rather than in prose: the first question staff arrive with is "how much
 * is waiting", and it should be answerable before the tabs are read.
 */
export function AdminHero({
  isAdmin,
  stats,
}: {
  isAdmin: boolean;
  stats: { label: string; value: number }[];
}) {
  return (
    <Well
      notchOpts
      // The gradient belongs to the surface alone — the notched corners fall
      // outside its clip path and `Well` fills them with the frame's lighter
      // face, so carrying the wash out there reads as a second panel behind.
      surfaceClassName="bg-card bg-linear-to-br from-deboss-surface via-deboss-surface to-primary/12 backdrop-blur-none"
    >
      <GraphPaper fade="bottom-left" />
      <div className="relative flex flex-wrap items-end justify-between gap-6 p-6">
        <div className="flex max-w-prose min-w-64 flex-col gap-2">
          <div className="flex items-center gap-2">
            <MicroLabel>MODERATION</MicroLabel>
            <Badge size="label" variant={isAdmin ? "default" : "outline"}>
              {isAdmin ? "ADMIN" : "STAFF"}
            </Badge>
          </div>
          <Heading as="h1" className="text-2xl tracking-widest uppercase">
            Keep the place worth being in
          </Heading>
          <Text size="sm" variant="muted">
            Reports, comments, and the vocabularies everything else is built from. Staff-only —
            {isAdmin
              ? " you can ban, delete, and prune the catalogues."
              : " bans and removals are admin-only."}
          </Text>
        </div>

        {stats.length > 0 && (
          <dl className="flex flex-wrap items-end gap-6">
            {stats.map((stat) => (
              // dt before dd in the DOM, reversed for display: the number
              // reads first, the label under it, without lying to a reader.
              <div key={stat.label} className="flex flex-col-reverse gap-0.5">
                <dt>
                  <MicroLabel as="span">{stat.label.toUpperCase()}</MicroLabel>
                </dt>
                <dd
                  className={cn(
                    "text-3xl leading-none font-bold tracking-tighter tabular-nums",
                    stat.value > 0 ? "text-foreground" : "text-foreground/30",
                  )}
                >
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </Well>
  );
}

export function AdminSection({
  title,
  count,
  hint,
  actions,
  children,
  className,
}: {
  title: string;
  /** Rendered as a badge beside the title. Omit while the query is pending. */
  count?: number;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border/60 pb-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <MicroLabel>{title.toUpperCase()}</MicroLabel>
            {count != null && (
              <Badge size="label" variant="outline">
                {count}
              </Badge>
            )}
          </div>
          {hint ? (
            <Text size="xs" variant="muted">
              {hint}
            </Text>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function AdminEmpty({ children }: { children: React.ReactNode }) {
  return (
    <Well className="items-center justify-center p-10" variant="ghost">
      <Text size="sm" variant="muted" align="center">
        {children}
      </Text>
    </Well>
  );
}

/** The shape every admin surface hydrates a person into. `urlStub` is
 * optional because the link falls back to the raw id — see
 * `profileLinkParams`. */
export type AdminPersonRef = {
  id: string;
  avatarUrl?: string | null;
  urlStub?: string | null;
} | null;

/**
 * Wraps anything in a link to a person's profile, and in a plain span when
 * there is nobody to link to (a deleted account, a guild-gate ban with no
 * actor). Triage is "who is this and what else have they done", and every
 * admin queue used to answer it with markup that did nothing.
 */
export function AdminPersonLink({
  user,
  children,
  className,
}: {
  user: AdminPersonRef;
  children: React.ReactNode;
  className?: string;
}) {
  if (!user) return <span className={className}>{children}</span>;
  return (
    <Link
      to="/profile/$userId"
      params={profileLinkParams(user)}
      className={cn("text-inherit hover:text-primary", className)}
    >
      {children}
    </Link>
  );
}

/** Avatar and name as one link, for the rows where they sit together. */
export function AdminPerson({
  user,
  name,
  size = 28,
  className,
}: {
  user: AdminPersonRef;
  /** What to call them when there is no row to link to. */
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <AdminPersonLink user={user} className={cn("flex min-w-0 items-center gap-2", className)}>
      <UserAvatar avatarUrl={user?.avatarUrl ?? null} username={name} size={size} />
      <Text as="span" size="sm" className="truncate font-medium">
        {name}
      </Text>
    </AdminPersonLink>
  );
}

/**
 * A row in one of the queues. Debossed like every other panel, with the
 * hover lift that says "this is a thing you act on" — the queues read as a
 * list of decisions rather than a table dump.
 */
export function AdminRow({
  children,
  muted = false,
  className,
}: {
  children: React.ReactNode;
  /** Handled / removed rows recede instead of disappearing. */
  muted?: boolean;
  className?: string;
}) {
  return (
    <Well
      className={cn(
        "gap-3 p-4 transition-colors hover:border-primary/40",
        muted && "opacity-60",
        className,
      )}
    >
      {children}
    </Well>
  );
}

export function AdminPager({
  page,
  pageCount,
  total,
  pageSize,
  unit,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  unit: string;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav aria-label="pagination" className="flex items-center justify-between gap-2 pb-1">
      <MicroLabel>
        {first}–{last} OF {total} {unit.toUpperCase()}
      </MicroLabel>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} data-icon="inline-start" />
            Prev
          </Button>
          <MicroLabel className="px-1">
            {page} / {pageCount}
          </MicroLabel>
          <Button
            variant="outline"
            size="xs"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            Next
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} data-icon="inline-end" />
          </Button>
        </div>
      )}
    </nav>
  );
}

/**
 * Free-text field that suggests the categories already in use. Typing is
 * never blocked — a new category is a legitimate answer — but the list is
 * right there, which is what keeps "Programming" from acquiring a
 * "programming" sibling.
 */
export function CategoryCombobox({
  value,
  onChange,
  categories,
  placeholder = "e.g. Design",
  disabled,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  categories: string[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <Combobox
      items={categories}
      value={value}
      onValueChange={(next: string | null) => onChange(next ?? "")}
      inputValue={value}
      onInputValueChange={(next: string) => onChange(next)}
      openOnInputClick
      disabled={disabled}
    >
      <ComboboxInput id={id} placeholder={placeholder} className="w-full" maxLength={100} />
      <ComboboxContent>
        <ComboboxList>
          {(category: string) => (
            <ComboboxItem key={category} value={category}>
              {category}
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty>New category</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * The "why" behind a moderation action, collected inside the confirm
 * dialog itself — the moment staff decide is the only moment they'll write
 * it, and a separate step would mean nobody ever does.
 *
 * Every element here is phrasing content: `AlertDialogDescription` renders
 * a `<p>`, so a `<div>` wrapper would be invalid markup and break
 * hydration. Spans and the textarea are legal children; a div is not.
 */
export function ReasonField({
  value,
  onChange,
  id,
  placeholder = "e.g. Off-topic self-promotion",
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  placeholder?: string;
}) {
  return (
    <span className="mt-3 flex flex-col gap-1">
      <label htmlFor={id}>
        <MicroLabel as="span">REASON (OPTIONAL)</MicroLabel>
      </label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={500}
        rows={2}
      />
      <MicroLabel as="span">SHOWN TO THEM — BLANK SENDS THE GENERIC NOTICE</MicroLabel>
    </span>
  );
}

/** Label + control pair used by the vocabulary add/edit forms. */
export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor}>
        <MicroLabel as="span">{label.toUpperCase()}</MicroLabel>
      </label>
      {children}
    </div>
  );
}
