import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  AdminPager,
  AdminPerson,
  AdminRow,
  AdminSection,
  ReasonField,
} from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Confirm } from "@/components/ui/confirm";
import { Empty } from "@/components/ui/empty";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { timeAgo } from "@/lib/format-time";
import { toastMutationError } from "@/lib/mutation-errors";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

type TeamRow = Awaited<ReturnType<typeof client.listTeamsAdmin>>["items"][number];

const PAGE_SIZE = 10;

/**
 * The whole team directory, hidden ones included — the queue answers "what
 * was reported", this answers "what is out there". Hide is staff; delete is
 * admin-only.
 */
export function AdminTeams({ isAdmin }: { isAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(true);
  const [page, setPage] = useState(1);
  // Keyed by team so a reason typed in one dialog can't leak into the next.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const term = search.trim();
  const teams = useQuery(
    orpc.listTeamsAdmin.queryOptions({
      input: {
        ...(term ? { search: term } : {}),
        hiddenOnly,
        includeArchived,
        page,
        pageSize: PAGE_SIZE,
      },
    }),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.listTeamsAdmin.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.listTeamReports.key() });
  };

  const setHidden = useMutation({
    mutationFn: (input: { teamId: string; hidden: boolean; reason?: string }) =>
      client.setTeamHidden(input),
    onSuccess: (_result, input) => {
      toast.success(input.hidden ? "Team hidden." : "Team is visible again.");
      invalidate();
    },
    onError: toastMutationError("admin.team_set_hidden"),
  });
  const remove = useMutation({
    mutationFn: (input: { teamId: string; reason: string }) => client.deleteTeam(input),
    onSuccess: () => {
      toast.success("Team deleted.");
      invalidate();
    },
    onError: toastMutationError("admin.team_delete"),
  });
  const busy = setHidden.isPending || remove.isPending;

  const items = teams.data?.items ?? [];
  const total = teams.data?.total ?? 0;

  const setFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <AdminSection
      title="Teams"
      count={teams.isPending ? undefined : total}
      hint="Every team, hidden and archived included. Hiding keeps the page for staff and members; deleting is for teams that should never have existed."
    >
      <div className="flex flex-wrap items-center gap-4">
        <SearchField
          value={search}
          onChange={(next) => setFilter(() => setSearch(next))}
          placeholder="Name or slug…"
          containerClassName="min-w-56 flex-1"
        />
        <label htmlFor="admin-teams-hidden-only" className="flex items-center gap-2">
          <Checkbox
            id="admin-teams-hidden-only"
            checked={hiddenOnly}
            onCheckedChange={(checked) => setFilter(() => setHiddenOnly(!!checked))}
          />
          <MicroLabel as="span">HIDDEN ONLY</MicroLabel>
        </label>
        <label htmlFor="admin-teams-include-archived" className="flex items-center gap-2">
          <Checkbox
            id="admin-teams-include-archived"
            checked={includeArchived}
            onCheckedChange={(checked) => setFilter(() => setIncludeArchived(!!checked))}
          />
          <MicroLabel as="span">INCLUDE ARCHIVED</MicroLabel>
        </label>
      </div>

      <AdminPager
        page={page}
        pageCount={teams.data?.pageCount ?? 1}
        total={total}
        pageSize={PAGE_SIZE}
        unit="teams"
        onPage={setPage}
      />

      {teams.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Empty>{term || hiddenOnly ? "No teams match that." : "No teams yet."}</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((team) => (
            <TeamAdminRow
              key={team.id}
              team={team}
              isAdmin={isAdmin}
              busy={busy}
              reason={reasons[team.id] ?? ""}
              onReason={(next) => setReasons((prev) => ({ ...prev, [team.id]: next }))}
              onSetHidden={(hidden, reason) =>
                setHidden.mutateAsync({
                  teamId: team.id,
                  hidden,
                  ...(reason ? { reason } : {}),
                })
              }
              onDelete={(reason) => remove.mutateAsync({ teamId: team.id, reason })}
            />
          ))}
        </div>
      )}
    </AdminSection>
  );
}

function TeamAdminRow({
  team,
  isAdmin,
  busy,
  reason,
  onReason,
  onSetHidden,
  onDelete,
}: {
  team: TeamRow;
  isAdmin: boolean;
  busy: boolean;
  reason: string;
  onReason: (next: string) => void;
  onSetHidden: (hidden: boolean, reason?: string) => Promise<unknown>;
  onDelete: (reason: string) => Promise<unknown>;
}) {
  // Delete is two clicks apart on purpose: arm, then confirm with a reason.
  const [armedDelete, setArmedDelete] = useState(false);
  const hidden = team.hiddenAt != null;
  const trimmed = reason.trim();

  return (
    <AdminRow muted={team.status === "archived"}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/teams/$teamId"
              params={{ teamId: team.slug }}
              className="text-sm font-medium text-primary hover:underline"
            >
              {team.name}
            </Link>
            <MicroLabel as="span">/{team.slug}</MicroLabel>
            {team.status === "archived" ? (
              <Badge size="label" variant="outline">
                ARCHIVED
              </Badge>
            ) : null}
            {hidden ? (
              <Badge size="label" variant="destructive">
                HIDDEN
              </Badge>
            ) : null}
            {team.openReportCount > 0 ? (
              <Badge size="label" variant="secondary">
                {team.openReportCount} OPEN {team.openReportCount === 1 ? "REPORT" : "REPORTS"}
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AdminPerson user={team.owner} name={team.owner?.displayName ?? "No owner"} size={20} />
            <Text as="span" size="xs" variant="muted">
              · created {team.createdAt ? timeAgo(team.createdAt) : "—"}
            </Text>
          </div>
          {hidden && team.hiddenReason ? (
            <Text size="xs" variant="muted">
              hidden — {team.hiddenReason}
            </Text>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {hidden ? (
            <Confirm
              title={`Unhide “${team.name}”?`}
              message="The team page is public again for everyone."
              confirmText="Unhide team"
              onConfirm={async () => {
                await onSetHidden(false);
              }}
            >
              <Button variant="outline" size="xs" disabled={busy}>
                Unhide
              </Button>
            </Confirm>
          ) : (
            <Confirm
              title={`Hide “${team.name}”?`}
              message={
                <>
                  The team page disappears for everyone but staff and its members. A reason is
                  required.
                  <ReasonField
                    id={`team-hide-reason-${team.id}`}
                    value={reason}
                    onChange={onReason}
                  />
                </>
              }
              confirmText="Hide team"
              variant="destructive"
              confirmDisabled={trimmed.length === 0}
              onConfirm={async () => {
                await onSetHidden(true, trimmed);
                onReason("");
              }}
            >
              <Button variant="outline" size="xs" disabled={busy}>
                Hide
              </Button>
            </Confirm>
          )}

          {isAdmin &&
            (armedDelete ? (
              <>
                <Confirm
                  title={`Delete “${team.name}”?`}
                  message={
                    <>
                      The team, its membership, and its projects are gone for good. A reason is
                      required.
                      <ReasonField
                        id={`team-delete-reason-${team.id}`}
                        value={reason}
                        onChange={onReason}
                      />
                    </>
                  }
                  confirmText="Delete team"
                  variant="destructive"
                  confirmDisabled={trimmed.length === 0}
                  onConfirm={async () => {
                    await onDelete(trimmed);
                    onReason("");
                    setArmedDelete(false);
                  }}
                >
                  <Button variant="destructive" size="xs" disabled={busy}>
                    Really delete
                  </Button>
                </Confirm>
                <Button variant="ghost" size="xs" onClick={() => setArmedDelete(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => setArmedDelete(true)}
              >
                Delete
              </Button>
            ))}
        </div>
      </div>
    </AdminRow>
  );
}
