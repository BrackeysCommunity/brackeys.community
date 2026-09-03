import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { experienceReading, platformsReading, projectLengthReading } from "@/lib/collab-vocabulary";
import { EVENTS } from "@/lib/event-taxonomy";
import { toastMutationError } from "@/lib/mutation-errors";
import { captureEvent } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { JamPickerField } from "./CollabCreateFlyout/JamPickerField";
import { ProjectPickerField } from "./CollabCreateFlyout/ProjectPickerField";
import { projectLengthForJam } from "./CollabCreateFlyout/shared";
import { TeamPickerField } from "./CollabCreateFlyout/TeamPickerField";
import type { CollabPostDetailData } from "./CollabPostDetail";

type StrengthenField = "project" | "team" | "jam" | "terms" | "art";

type LinksPatch = Parameters<typeof client.updatePostLinks>[0];

/**
 * Where the team and project questions live now that the post itself
 * doesn't ask them: on the owner's live post, each as an upgrade with its
 * payoff stated. Every row is one mutation — `updatePostLinks` for the
 * links, the edit wizard for the terms and art the wizard already owns.
 * Collapses to a single line once every row is done.
 */
export function CollabStrengthenPanel({
  post,
  onOpenEdit,
}: {
  post: CollabPostDetailData;
  /** Opens the edit wizard on THE POST, for the rows it still owns. */
  onOpenEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const [openRow, setOpenRow] = useState<StrengthenField | null>(null);

  // Only to decide the row's copy — the picker hides itself when empty.
  const { data: editable } = useQuery({
    ...orpc.listEditableProjects.queryOptions({ input: {} }),
    staleTime: STALE.listing,
  });
  const hasProjects = editable === undefined || editable.projects.length > 0;

  const links = useMutation({
    mutationFn: (patch: Omit<LinksPatch, "postId">) =>
      client.updatePostLinks({ postId: post.id, ...patch }),
    onSuccess: (_updated, patch) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId: post.id } }).queryKey,
      });
      const field: StrengthenField =
        patch.projectId !== undefined ? "project" : patch.teamId !== undefined ? "team" : "jam";
      const linked = patch[`${field}Id`] != null;
      if (linked) captureEvent(EVENTS.collabPostStrengthened, { post_id: post.id, field });
      toast.success(
        linked
          ? { project: "Game linked.", team: "Crew attached.", jam: "Jam tagged." }[field]
          : { project: "Game unlinked.", team: "Crew detached.", jam: "Jam untagged." }[field],
      );
      setOpenRow(null);
    },
    onError: toastMutationError("collab.strengthen"),
  });

  const termsDone =
    (post.platforms?.length ?? 0) > 0 && post.projectLength != null && post.experienceLevel != null;
  const artDone = post.images.length > 0 || post.project?.imageUrl != null;

  const rows: {
    field: StrengthenField;
    label: string;
    payoff: string;
    done: boolean;
    doneText: string;
    action: string;
    undo?: { label: string; patch: Omit<LinksPatch, "postId"> };
    control?: React.ReactNode;
  }[] = [
    {
      field: "project",
      label: "LINK THE GAME",
      payoff: "Shows the post on the project page and uses its cover.",
      done: post.project != null,
      doneText: post.project ? `Linked to ${post.project.title}` : "",
      action: "LINK",
      undo: { label: "UNLINK", patch: { projectId: null } },
      control: hasProjects ? (
        <ProjectPickerField
          value={undefined}
          selectedTeamId={post.team?.id}
          onChange={(project) => {
            if (project) links.mutate({ projectId: project.id });
          }}
        />
      ) : (
        <Text size="xs" variant="muted">
          Add the game to{" "}
          <Link to="/profile" className="text-primary hover:underline">
            your profile
          </Link>{" "}
          first, then link it here.
        </Text>
      ),
    },
    {
      field: "team",
      label: "ATTACH A CREW",
      payoff: "People you accept get invited to its roster.",
      done: post.team != null,
      doneText: post.team ? `${post.team.name} is behind this post` : "",
      action: "ATTACH",
      undo: { label: "DETACH", patch: { teamId: null } },
      control: (
        <TeamPickerField
          value={undefined}
          onChange={(teamId) => {
            if (teamId) links.mutate({ teamId });
          }}
        />
      ),
    },
    {
      field: "jam",
      label: "TAG THE JAM",
      payoff: "Reaches people who watch this jam; fills the timeline.",
      done: post.jam != null,
      doneText: post.jam ? `For ${post.jam.title}` : "",
      action: "TAG",
      undo: { label: "UNTAG", patch: { jamId: null } },
      control: (
        <JamPickerField
          value={undefined}
          onChange={(jam) => {
            if (jam) {
              links.mutate({
                jamId: jam.jamId,
                projectLength: projectLengthForJam(jam.startsAt, jam.endsAt),
              });
            }
          }}
        />
      ),
    },
    {
      field: "terms",
      label: "TERMS",
      payoff: "Platforms, timeline, experience — helps the right people filter to you.",
      done: termsDone,
      doneText: `${platformsReading(post.platforms)} · ${projectLengthReading(post.projectLength)} · ${experienceReading(post.experienceLevel)}`,
      action: "SET TERMS",
    },
    {
      field: "art",
      label: "ART",
      payoff: "A cover makes the card twice as visible on the board.",
      done: artDone,
      doneText: post.images.length > 0 ? "Using your image" : "Using the game's cover",
      action: "ADD ART",
    },
  ];

  const remaining = rows.filter((r) => !r.done).length;

  if (remaining === 0) {
    return (
      <Well variant="ghost" className="flex-row items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} className="text-success" />
          <Text size="sm">This post is fully set up.</Text>
        </div>
        <Button variant="ghost" size="xs" onClick={onOpenEdit} className="tracking-widest">
          EDIT
        </Button>
      </Well>
    );
  }

  return (
    <Section
      id="strengthen"
      title="STRENGTHEN THIS POST"
      size="sm"
      blurb={`It's live. ${remaining === 1 ? "One more thing" : `${remaining} things`} would make it easier to find and act on.`}
    >
      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const isOpen = openRow === row.field;
          const editRow = row.control === undefined;
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
                    <MicroLabel as="span">{row.label}</MicroLabel>
                  </div>
                  <Text size="xs" variant="muted" textWrap="pretty">
                    {row.done ? row.doneText : row.payoff}
                  </Text>
                </div>
                {row.done ? (
                  row.undo ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={links.isPending}
                      onClick={() => links.mutate(row.undo!.patch)}
                      className="tracking-widest"
                    >
                      {row.undo.label}
                    </Button>
                  ) : null
                ) : (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={links.isPending}
                    onClick={() => {
                      if (editRow) {
                        captureEvent(EVENTS.collabPostStrengthened, {
                          post_id: post.id,
                          field: row.field,
                          via: "wizard",
                        });
                        onOpenEdit();
                        return;
                      }
                      setOpenRow(isOpen ? null : row.field);
                    }}
                    className="tracking-widest"
                  >
                    {isOpen ? "CANCEL" : row.action}
                  </Button>
                )}
              </div>
              {isOpen && !row.done ? row.control : null}
            </Well>
          );
        })}
      </div>
    </Section>
  );
}
