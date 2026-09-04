import {
  ArrowRight01Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Image02Icon,
  Link04Icon,
  SlidersHorizontalIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { motion } from "framer-motion";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Section } from "@/components/ui/section";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { experienceReading, platformsReading, projectLengthReading } from "@/lib/collab-vocabulary";
import { PAGE_CUES } from "@/lib/sound";
import { cn } from "@/lib/utils";

import type { CollabPostDetailData } from "./collab-post-data";
import {
  CollabStrengthenFlyout,
  STRENGTHEN_COPY,
  type StrengthenField,
  usePostLinksMutation,
} from "./CollabStrengthenFlyout";

const FIELD_ICON: Record<StrengthenField, IconSvgElement> = {
  project: Link04Icon,
  team: UserGroupIcon,
  jam: Calendar03Icon,
  terms: SlidersHorizontalIcon,
  art: Image02Icon,
};

/** One rung per completed row: the word the meter shows and the nudge under it. */
const TIERS: { label: string; hint: string }[] = [
  { label: "BARE", hint: "A title and a pitch. Every upgrade below is a way to be found." },
  { label: "ROUGH", hint: "Good start. Each upgrade puts the post in front of more people." },
  { label: "TAKING SHAPE", hint: "Halfway. The board is starting to route people your way." },
  { label: "SOLID", hint: "Most people will find this. Two more and it's maxed." },
  { label: "ALMOST THERE", hint: "One left. Finish the set." },
  { label: "MAXED", hint: "Fully set up. Nothing on the board outranks it for setup." },
];

/**
 * Where the team and project questions live now that the post itself
 * doesn't ask them: on the owner's live post, as a strength meter over a
 * grid of upgrades. Every undone tile is one click into a flyout holding
 * just that control; a done tile shows what it's set to and offers the
 * undo (for the links) or a way back into the flyout (terms and art).
 */
export function CollabStrengthenPanel({
  post,
  onOpenEdit,
}: {
  post: CollabPostDetailData;
  /** Opens the edit wizard, for everything the rows don't cover. */
  onOpenEdit: () => void;
}) {
  const [openField, setOpenField] = useState<StrengthenField | null>(null);
  const links = usePostLinksMutation(post);

  const termsDone =
    (post.platforms?.length ?? 0) > 0 && post.projectLength != null && post.experienceLevel != null;
  const artDone = post.images.length > 0 || post.project?.imageUrl != null;

  const rows: {
    field: StrengthenField;
    done: boolean;
    doneText: string;
    action: string;
    /** The done state's control: undo the link, or reopen the flyout. */
    doneAction: { label: string; onClick: () => void };
  }[] = [
    {
      field: "project",
      done: post.project != null,
      doneText: post.project ? `Linked to ${post.project.title}` : "",
      action: "LINK",
      doneAction: { label: "UNLINK", onClick: () => links.mutate({ projectId: null }) },
    },
    {
      field: "team",
      done: post.team != null,
      doneText: post.team ? `${post.team.name} is behind this post` : "",
      action: "ATTACH",
      doneAction: { label: "DETACH", onClick: () => links.mutate({ teamId: null }) },
    },
    {
      field: "jam",
      done: post.jam != null,
      doneText: post.jam ? `For ${post.jam.title}` : "",
      action: "TAG",
      doneAction: { label: "UNTAG", onClick: () => links.mutate({ jamId: null }) },
    },
    {
      field: "terms",
      done: termsDone,
      doneText: `${platformsReading(post.platforms)} · ${projectLengthReading(post.projectLength)} · ${experienceReading(post.experienceLevel)}`,
      action: "SET TERMS",
      doneAction: { label: "CHANGE", onClick: () => setOpenField("terms") },
    },
    {
      field: "art",
      done: artDone,
      doneText: post.images.length > 0 ? "Using your image" : "Using the game's cover",
      action: "ADD ART",
      doneAction: { label: "MANAGE", onClick: () => setOpenField("art") },
    },
  ];

  const doneCount = rows.filter((r) => r.done).length;
  const maxed = doneCount === rows.length;

  const flyout = (
    <CollabStrengthenFlyout post={post} field={openField} onClose={() => setOpenField(null)} />
  );

  return (
    <>
      <Section
        id="strengthen"
        title="STRENGTHEN THIS POST"
        size="sm"
        action={
          <Button variant="ghost" size="xs" onClick={onOpenEdit} className="tracking-widest">
            EDIT POST
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <StrengthMeter done={doneCount} total={rows.length} />
          <div
            className={cn("grid gap-2 sm:grid-cols-2", maxed ? "lg:grid-cols-5" : "lg:grid-cols-3")}
          >
            {rows.map((row) => {
              const copy = STRENGTHEN_COPY[row.field];
              const icon = FIELD_ICON[row.field];
              if (row.done) {
                return (
                  <Well
                    key={row.field}
                    variant="ghost"
                    className="gap-2 border-success/30 bg-success/5 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-success/15 text-success">
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
                      </span>
                      <MicroLabel as="span" className="text-success">
                        {copy.title}
                      </MicroLabel>
                    </div>
                    <Text size="xs" variant="muted" textWrap="pretty" className="line-clamp-2">
                      {row.doneText}
                    </Text>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={links.isPending}
                      onClick={row.doneAction.onClick}
                      className="mt-auto self-start tracking-widest"
                    >
                      {row.doneAction.label}
                    </Button>
                  </Well>
                );
              }
              return (
                <Chonk
                  key={row.field}
                  variant="surface"
                  render={
                    <button
                      type="button"
                      disabled={links.isPending}
                      onClick={() => setOpenField(row.field)}
                      {...PAGE_CUES}
                    />
                  }
                  className="group flex-col gap-2 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/40 text-muted-foreground transition-colors group-hover:bg-warning/15 group-hover:text-warning">
                      <HugeiconsIcon icon={icon} size={14} />
                    </span>
                    <MicroLabel as="span" variant="primary" className="flex-1">
                      {copy.title}
                    </MicroLabel>
                    <MicroLabel
                      as="span"
                      className="rounded bg-warning/15 px-1.5 py-0.5 text-warning tabular-nums"
                    >
                      +1
                    </MicroLabel>
                  </div>
                  <Text size="xs" variant="muted" textWrap="pretty" className="flex-1">
                    {copy.payoff}
                  </Text>
                  <span className="flex items-center gap-1 text-[10px] tracking-widest text-foreground">
                    {row.action}
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      size={12}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </Chonk>
              );
            })}
          </div>
        </div>
      </Section>
      {flyout}
    </>
  );
}

/**
 * The score: one segment per upgrade, filled in order as rows complete.
 * The next empty segment breathes so the eye lands on "one more".
 */
function StrengthMeter({ done, total }: { done: number; total: number }) {
  const tier = TIERS[Math.min(done, TIERS.length - 1)]!;
  const maxed = done >= total;
  return (
    <Well className="gap-3 p-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <MicroLabel as="span">POST STRENGTH</MicroLabel>
          <Heading
            as="h3"
            size="2xl"
            variant={maxed ? "success" : "primary"}
            className="leading-none"
          >
            {tier.label}
          </Heading>
        </div>
        <div className="flex items-baseline gap-1">
          <Text as="span" bold tabular className="text-2xl leading-none tracking-tight">
            {done}
          </Text>
          <Text size="sm" variant="muted" tabular>
            / {total}
          </Text>
        </div>
      </div>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: total }, (_, i) => {
          const filled = i < done;
          const next = i === done;
          return (
            <motion.span
              key={i}
              aria-hidden
              initial={false}
              animate={{ scaleY: filled ? 1 : 0.6, opacity: filled ? 1 : next ? 0.7 : 0.35 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className={cn(
                "h-2 origin-bottom rounded-full",
                filled ? "bg-success" : next ? "animate-pulse bg-warning" : "bg-muted",
              )}
            />
          );
        })}
      </div>
      <Text size="xs" variant="muted" textWrap="pretty">
        {tier.hint}
      </Text>
    </Well>
  );
}
