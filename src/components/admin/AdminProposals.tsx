import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  AdminPager,
  AdminPerson,
  AdminPersonLink,
  AdminRow,
  AdminSection,
  ReasonField,
} from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Empty } from "@/components/ui/empty";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { timeAgo } from "@/lib/format-time";
import { toastMutationError } from "@/lib/mutation-errors";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

type Proposal = Awaited<ReturnType<typeof client.listModerationProposals>>["items"][number];

const PAGE_SIZE = 10;

const ACTION_LABELS: Record<string, string> = {
  team_update: "Team edit",
  team_slug: "Slug change",
  team_image_clear: "Image removal",
  team_member_remove: "Member removal",
  team_transfer: "Ownership transfer",
  team_title_edit: "Member title edit",
  team_project_update: "Project edit",
  team_project_remove: "Project removal",
  profile_update: "Profile edit",
  profile_stub_reset: "Handle reset",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function formatValue(value: unknown): string {
  if (value === null) return "(cleared)";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "string") return value || "(empty)";
  return JSON.stringify(value);
}

/**
 * The staff→admin handoff for team and profile edits (plan 23). Staff can
 * read the whole queue; only admins hold the approve/reject buttons — the
 * server enforces the same split.
 */
export function AdminProposals({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<"pending" | "handled">("pending");
  const [page, setPage] = useState(1);
  // Keyed by proposal so a note typed in one dialog can't leak into the next.
  const [notes, setNotes] = useState<Record<number, string>>({});
  const queryClient = useQueryClient();

  const proposals = useQuery(
    orpc.listModerationProposals.queryOptions({ input: { status, page, pageSize: PAGE_SIZE } }),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.listModerationProposals.key() });
  };

  const approve = useMutation({
    mutationFn: (input: { proposalId: number; note?: string }) =>
      client.approveModerationProposal(input),
    onSuccess: (result) => {
      if (result.applied) {
        toast.success("Proposal approved and applied.");
      } else {
        toast.warning(result.message ?? "Proposal handled without applying.");
      }
      invalidate();
    },
    onError: toastMutationError("admin.proposal_approve"),
  });
  const reject = useMutation({
    mutationFn: (input: { proposalId: number; note?: string }) =>
      client.rejectModerationProposal(input),
    onSuccess: () => {
      toast.success("Proposal rejected.");
      invalidate();
    },
    onError: toastMutationError("admin.proposal_reject"),
  });
  const busy = approve.isPending || reject.isPending;

  const items = proposals.data?.items ?? [];
  const total = proposals.data?.total ?? 0;

  const setStatusFilter = (next: "pending" | "handled") => {
    setStatus(next);
    setPage(1);
  };

  return (
    <AdminSection
      title="Moderation proposals"
      count={proposals.isPending ? undefined : total}
      hint={
        status === "pending"
          ? isAdmin
            ? "Edits staff proposed. Approving applies the change and notifies the owner."
            : "Edits staff proposed — an admin approves or rejects each one."
          : "Already approved, rejected, or superseded by a newer draft."
      }
      actions={
        <SegmentedControl
          size="sm"
          value={status}
          onChange={(next) => setStatusFilter(next as "pending" | "handled")}
        >
          <SegmentedControl.Item value="pending">Pending</SegmentedControl.Item>
          <SegmentedControl.Item value="handled">Handled</SegmentedControl.Item>
        </SegmentedControl>
      }
    >
      <AdminPager
        page={page}
        pageCount={proposals.data?.pageCount ?? 1}
        total={total}
        pageSize={PAGE_SIZE}
        unit="proposals"
        onPage={setPage}
      />

      {proposals.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Empty>
          {status === "pending"
            ? "No proposals waiting. Nothing needs a ruling right now."
            : "Nothing has been handled yet."}
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              isAdmin={isAdmin}
              busy={busy}
              note={notes[proposal.id] ?? ""}
              onNote={(next) => setNotes((prev) => ({ ...prev, [proposal.id]: next }))}
              onApprove={(note) =>
                approve.mutateAsync({ proposalId: proposal.id, ...(note ? { note } : {}) })
              }
              onReject={(note) =>
                reject.mutateAsync({ proposalId: proposal.id, ...(note ? { note } : {}) })
              }
            />
          ))}
        </div>
      )}
    </AdminSection>
  );
}

function ProposalRow({
  proposal,
  isAdmin,
  busy,
  note,
  onNote,
  onApprove,
  onReject,
}: {
  proposal: Proposal;
  isAdmin: boolean;
  busy: boolean;
  note: string;
  onNote: (next: string) => void;
  onApprove: (note?: string) => Promise<unknown>;
  onReject: (note?: string) => Promise<unknown>;
}) {
  const pending = proposal.status === "pending";
  const payload = asRecord(proposal.payload);
  const snapshot = asRecord(proposal.snapshot);
  const live = proposal.live != null ? asRecord(proposal.live) : null;
  const appliedPrevious =
    proposal.appliedPrevious != null ? asRecord(proposal.appliedPrevious) : null;

  const keys = Object.keys(payload).filter((key) => payload[key] !== undefined);
  const drifted =
    live != null && keys.some((key) => JSON.stringify(live[key]) !== JSON.stringify(snapshot[key]));

  const proposerName = proposal.proposer?.displayName ?? proposal.proposedByName ?? "Unknown";

  return (
    <AdminRow muted={!pending}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="label" variant="default">
            {actionLabel(proposal.action).toUpperCase()}
          </Badge>
          <ProposalTarget proposal={proposal} />
          {!pending ? (
            <Badge
              size="label"
              variant={
                proposal.status === "approved"
                  ? "success"
                  : proposal.status === "rejected"
                    ? "destructive"
                    : "outline"
              }
            >
              {proposal.status.toUpperCase()}
            </Badge>
          ) : null}
          {drifted ? (
            <Badge size="label" variant="destructive">
              CHANGED SINCE PROPOSED
            </Badge>
          ) : null}
          <Text size="xs" variant="muted">
            proposed by <AdminPersonLink user={proposal.proposer}>{proposerName}</AdminPersonLink> ·{" "}
            {proposal.createdAt ? timeAgo(proposal.createdAt) : "—"}
          </Text>
        </div>

        <Text size="sm" className="max-w-prose italic">
          “{proposal.reason}”
        </Text>

        {keys.length > 0 ? (
          <dl className="flex flex-col gap-0.5 border-l-2 border-muted pl-3">
            {keys.map((key) => (
              <div key={key} className="flex flex-wrap items-baseline gap-x-2">
                <dt>
                  <MicroLabel as="span">{key.replaceAll("_", " ").toUpperCase()}</MicroLabel>
                </dt>
                <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                  <Text as="span" size="xs" variant="muted" className="break-words line-through">
                    {formatValue(snapshot[key])}
                  </Text>
                  <Text as="span" size="xs" variant="muted" aria-hidden>
                    →
                  </Text>
                  <Text as="span" size="sm" className="break-words">
                    {formatValue(payload[key])}
                  </Text>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {!pending ? (
          <div className="flex flex-col gap-0.5">
            <Text size="xs" variant="muted">
              {proposal.status === "superseded"
                ? "superseded by a newer draft"
                : proposal.status === "approved"
                  ? "approved"
                  : "rejected"}
              {proposal.reviewer ? (
                <>
                  {" by "}
                  <AdminPersonLink user={proposal.reviewer}>
                    {proposal.reviewer.displayName}
                  </AdminPersonLink>
                </>
              ) : null}
              {proposal.reviewedAt ? ` · ${timeAgo(proposal.reviewedAt)}` : ""}
              {proposal.reviewNote ? ` — “${proposal.reviewNote}”` : ""}
            </Text>
            {appliedPrevious && Object.keys(appliedPrevious).length > 0 ? (
              <Text size="xs" variant="muted">
                previous values kept on record:{" "}
                {Object.entries(appliedPrevious)
                  .map(([key, value]) => `${key.replaceAll("_", " ")}: ${formatValue(value)}`)
                  .join(" · ")}
              </Text>
            ) : null}
          </div>
        ) : null}

        {pending && isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <Confirm
              title={`Reject this ${actionLabel(proposal.action).toLowerCase()}?`}
              message={
                <>
                  Nothing changes for the target; the proposer sees the ruling in the queue.
                  <ReasonField
                    id={`proposal-note-${proposal.id}`}
                    value={note}
                    onChange={onNote}
                    placeholder="e.g. Not worth an override — ask the owner first"
                  />
                </>
              }
              confirmText="Reject"
              variant="destructive"
              onConfirm={async () => {
                await onReject(note.trim() || undefined);
                onNote("");
              }}
            >
              <Button variant="outline" size="xs" disabled={busy}>
                Reject
              </Button>
            </Confirm>
            <Confirm
              title={`Approve this ${actionLabel(proposal.action).toLowerCase()}?`}
              message={
                <>
                  The change is applied now, under the proposer’s stated reason.
                  {drifted
                    ? " The target has changed since this was proposed — check the diff first."
                    : ""}
                  <ReasonField
                    id={`proposal-approve-note-${proposal.id}`}
                    value={note}
                    onChange={onNote}
                  />
                </>
              }
              confirmText="Approve"
              onConfirm={async () => {
                await onApprove(note.trim() || undefined);
                onNote("");
              }}
            >
              <Button size="xs" disabled={busy}>
                Approve
              </Button>
            </Confirm>
          </div>
        ) : null}
      </div>
    </AdminRow>
  );
}

function ProposalTarget({ proposal }: { proposal: Proposal }) {
  if (proposal.targetType === "team") {
    if (!proposal.targetTeam) {
      const snapshotName = asRecord(proposal.snapshot).name;
      return (
        <Badge size="label" variant="outline">
          TEAM DELETED{typeof snapshotName === "string" ? ` — ${snapshotName}` : ""}
        </Badge>
      );
    }
    return (
      <Link
        to="/teams/$teamId"
        params={{ teamId: proposal.targetTeam.slug }}
        className="text-sm font-medium text-primary hover:underline"
      >
        {proposal.targetTeam.name}
      </Link>
    );
  }
  return (
    <AdminPerson
      user={proposal.targetProfile}
      name={proposal.targetProfile?.displayName ?? "Unknown"}
      size={20}
    />
  );
}
