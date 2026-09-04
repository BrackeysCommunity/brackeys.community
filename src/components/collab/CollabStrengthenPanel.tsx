import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { experienceReading, platformsReading, projectLengthReading } from "@/lib/collab-vocabulary";

import type { CollabPostDetailData } from "./collab-post-data";
import {
  CollabStrengthenFlyout,
  STRENGTHEN_COPY,
  type StrengthenField,
  usePostLinksMutation,
} from "./CollabStrengthenFlyout";

/**
 * Where the team and project questions live now that the post itself
 * doesn't ask them: on the owner's live post, each as an upgrade with its
 * payoff stated. Every row opens its own flyout holding just that
 * control; the done state offers a one-click undo for the links and a
 * way back into the flyout for the terms and art. Collapses to a single
 * line once every row is done.
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

  const remaining = rows.filter((r) => !r.done).length;

  const flyout = (
    <CollabStrengthenFlyout post={post} field={openField} onClose={() => setOpenField(null)} />
  );

  if (remaining === 0) {
    return (
      <>
        <Well variant="ghost" className="flex-row items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} className="text-success" />
            <Text size="sm">This post is fully set up.</Text>
          </div>
          <Button variant="ghost" size="xs" onClick={onOpenEdit} className="tracking-widest">
            EDIT
          </Button>
        </Well>
        {flyout}
      </>
    );
  }

  return (
    <>
      <Section
        id="strengthen"
        title="STRENGTHEN THIS POST"
        size="sm"
        blurb={`It's live. ${remaining === 1 ? "One more thing" : `${remaining} things`} would make it easier to find and act on.`}
      >
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const copy = STRENGTHEN_COPY[row.field];
            return (
              <Well
                key={row.field}
                variant="ghost"
                className={row.done ? "gap-1 p-3 opacity-80" : "gap-2 p-3"}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      {row.done ? (
                        <HugeiconsIcon
                          icon={CheckmarkCircle02Icon}
                          size={12}
                          className="shrink-0 text-success"
                        />
                      ) : null}
                      <MicroLabel as="span">{copy.title}</MicroLabel>
                    </div>
                    <Text size="xs" variant="muted" textWrap="pretty">
                      {row.done ? row.doneText : copy.payoff}
                    </Text>
                  </div>
                  {row.done ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={links.isPending}
                      onClick={row.doneAction.onClick}
                      className="tracking-widest"
                    >
                      {row.doneAction.label}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={links.isPending}
                      onClick={() => setOpenField(row.field)}
                      className="tracking-widest"
                    >
                      {row.action}
                    </Button>
                  )}
                </div>
              </Well>
            );
          })}
        </div>
      </Section>
      {flyout}
    </>
  );
}
