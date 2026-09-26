import { ArrowRight01Icon, Cancel01Icon, FilterHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { AdminPager, AdminPerson, AdminRow, AdminSection } from "@/components/admin/AdminUI";
import {
  describeLogEntry,
  type LogAction,
  type LogFact,
  type LogPerson,
  type LogTarget,
} from "@/components/admin/log-entry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { FilterMenu } from "@/components/ui/filter-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/time-ago";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { MicroLabel, Quote, Text } from "@/components/ui/typography";
import { formatDate } from "@/lib/format-date";
import { jamLinkParams } from "@/lib/jam-links";
import { profileLinkParams } from "@/lib/profile-links";
import { teamLinkParams } from "@/lib/team-links";
import { orpc } from "@/orpc/client";

const PAGE_SIZE = 25;

/** Governs the dropdown only; the server filters on a plain string. */
const ACTIONS: { value: string; label: string }[] = [
  { value: "", label: "Every action" },
  { value: "user_banned", label: "Bans" },
  { value: "user_unbanned", label: "Unbans" },
  { value: "comment_removed", label: "Comments removed" },
  { value: "comment_restored", label: "Comments restored" },
  { value: "post_closed", label: "Posts closed" },
  { value: "post_reopened", label: "Posts reopened" },
  { value: "post_deleted", label: "Posts deleted" },
  { value: "post_shared_to_discord", label: "Posts shared to Discord" },
  { value: "comment_report_dismissed", label: "Comment reports dismissed" },
  { value: "post_report_dismissed", label: "Post reports dismissed" },
  { value: "post_report_deleted", label: "Post reports deleted" },
  { value: "report_reopened", label: "Reports reopened" },
  { value: "skill_request_approved", label: "Skills approved" },
  { value: "skill_request_rejected", label: "Skills rejected" },
  { value: "jam_hero_pinned", label: "Hero jams pinned" },
  { value: "jam_hero_unpinned", label: "Hero jams unpinned" },
  { value: "vocabulary_created", label: "Vocabulary created" },
  { value: "vocabulary_renamed", label: "Vocabulary renamed" },
  { value: "vocabulary_deleted", label: "Vocabulary deleted" },
  { value: "vocabulary_merged", label: "Vocabulary merged" },
  { value: "team_updated", label: "Teams edited" },
  { value: "team_slug_updated", label: "Team handles changed" },
  { value: "team_image_cleared", label: "Team images cleared" },
  { value: "team_image_set", label: "Team images replaced" },
  { value: "team_member_removed", label: "Team members removed" },
  { value: "team_member_added", label: "Team members added by staff" },
  { value: "team_member_invited", label: "Team invites by staff" },
  { value: "team_member_title_updated", label: "Roster titles edited" },
  { value: "team_ownership_transferred", label: "Team ownership transferred" },
  { value: "team_project_updated", label: "Showcase entries edited" },
  { value: "team_project_removed", label: "Showcase entries removed" },
  { value: "team_hidden", label: "Teams hidden" },
  { value: "team_unhidden", label: "Teams unhidden" },
  { value: "team_deleted", label: "Teams deleted" },
  { value: "team_report_dismissed", label: "Team reports dismissed" },
  { value: "project_unpublished", label: "Projects unpublished" },
  { value: "project_republished", label: "Projects republished" },
  { value: "project_deleted", label: "Projects deleted" },
  { value: "moderation_proposed", label: "Proposals filed" },
  { value: "moderation_proposal_approved", label: "Proposals approved" },
  { value: "moderation_proposal_rejected", label: "Proposals rejected" },
  { value: "profile_updated", label: "Profiles edited" },
  { value: "entry_flag_confirmed", label: "Entry flags confirmed" },
  { value: "entry_flag_dismissed", label: "Entry flags dismissed" },
  { value: "image_flag_confirmed", label: "Upload flags confirmed" },
  { value: "image_flag_dismissed", label: "Upload flags dismissed" },
  { value: "image_rescan_requested", label: "Upload rescans requested" },
  { value: "forum_post_hidden", label: "Forum posts hidden" },
  { value: "forum_post_unhidden", label: "Forum posts unhidden" },
  { value: "forum_post_pinned", label: "Forum posts pinned" },
  { value: "forum_post_unpinned", label: "Forum posts unpinned" },
  { value: "forum_post_moved", label: "Forum posts moved" },
  { value: "forum_post_retagged", label: "Forum posts retagged" },
  { value: "forum_post_deleted", label: "Forum posts removed" },
  { value: "forum_post_report_dismissed", label: "Forum reports dismissed" },
];

const ACTION_LABEL = new Map(ACTIONS.map((a) => [a.value, a.label]));

type PersonFilter = { id: string; name: string };
type TargetFilter = { type: string; id: string; label: string };

/** `listBans` shows the current ban record; this shows every decision behind it. */
export function AdminLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState<PersonFilter | null>(null);
  const [subject, setSubject] = useState<PersonFilter | null>(null);
  const [target, setTarget] = useState<TargetFilter | null>(null);

  const log = useQuery(
    orpc.listModerationActions.queryOptions({
      input: {
        page,
        pageSize: PAGE_SIZE,
        ...(action ? { action } : {}),
        ...(actor ? { actorId: actor.id } : {}),
        ...(subject ? { subjectUserId: subject.id } : {}),
        ...(target ? { targetType: target.type, targetId: target.id } : {}),
      },
    }),
  );

  const rows = log.data?.actions ?? [];
  const refs = log.data?.refs;

  const filterBy = {
    actor: (next: PersonFilter) => {
      setActor(next);
      setPage(1);
    },
    subject: (next: PersonFilter) => {
      setSubject(next);
      setPage(1);
    },
    target: (next: TargetFilter) => {
      setTarget(next);
      setPage(1);
    },
  };

  const chips = [
    actor && { key: "actor", label: `By ${actor.name}`, clear: () => setActor(null) },
    subject && { key: "subject", label: `On ${subject.name}`, clear: () => setSubject(null) },
    target && { key: "target", label: `History of ${target.label}`, clear: () => setTarget(null) },
  ].filter((chip) => chip != null);

  return (
    <AdminSection
      title="Moderation log"
      count={log.isPending ? undefined : log.data?.total}
      hint="Every staff action: what it touched, what changed, and the reason typed at the time. Use the filter buttons on a row to follow a moderator, a member, or one item's history."
      actions={
        <FilterMenu
          label="ACTION"
          options={ACTIONS}
          value={action}
          onChange={(next) => {
            setAction(next);
            setPage(1);
          }}
        />
      }
    >
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <MicroLabel>FILTERED</MicroLabel>
          {chips.map((chip) => (
            <Button
              key={chip.key}
              variant="outline"
              size="xs"
              onClick={() => {
                chip.clear();
                setPage(1);
              }}
            >
              {chip.label}
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} data-icon="inline-end" />
            </Button>
          ))}
        </div>
      ) : null}

      <AdminPager
        page={page}
        pageCount={log.data?.pageCount ?? 1}
        total={log.data?.total ?? 0}
        pageSize={PAGE_SIZE}
        unit="actions"
        onPage={setPage}
      />

      {log.isPending || !refs ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <Empty>Nothing matches that filter.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <LogRow key={row.id} row={row} refs={refs} filterBy={filterBy} />
          ))}
        </div>
      )}
    </AdminSection>
  );
}

function LogRow({
  row,
  refs,
  filterBy,
}: {
  row: LogAction;
  refs: NonNullable<Parameters<typeof describeLogEntry>[1]>;
  filterBy: {
    actor: (next: PersonFilter) => void;
    subject: (next: PersonFilter) => void;
    target: (next: TargetFilter) => void;
  };
}) {
  const detail = describeLogEntry(row, refs);
  const actionLabel = ACTION_LABEL.get(row.action) ?? row.action;
  const targetLabel =
    detail.target?.label ?? `${row.targetType.replace(/_/g, " ")} ${row.targetId ?? ""}`;
  const hasMetadata = Object.keys(row.metadata).length > 0;

  return (
    <AdminRow className="gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge size="label" variant="outline">
          {actionLabel}
        </Badge>
        <SimpleTooltip
          content={formatDate(row.createdAt, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        >
          <MicroLabel>
            <TimeAgo date={row.createdAt} />
          </MicroLabel>
        </SimpleTooltip>
        {detail.target ? (
          <span className="flex min-w-0 items-center gap-1">
            <HugeiconsIcon icon={ArrowRight01Icon} size={12} className="text-muted-foreground" />
            <TargetLink target={detail.target} />
          </span>
        ) : null}
        {row.targetId ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            tooltip="Every action on this item"
            aria-label="Every action on this item"
            onClick={() =>
              filterBy.target({ type: row.targetType, id: row.targetId!, label: targetLabel })
            }
          >
            <HugeiconsIcon icon={FilterHorizontalIcon} strokeWidth={2} />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <MicroLabel>BY</MicroLabel>
          {row.actor ? (
            <FilterablePerson
              person={row.actor}
              hint="Everything this moderator did"
              onFilter={() => filterBy.actor({ id: row.actor!.id, name: row.actor!.displayName })}
            />
          ) : (
            // A null actor is the app itself — today, the guild-ban gate.
            <Text size="sm" variant="muted">
              {row.actorName ?? "Brackeys"}
            </Text>
          )}
        </div>

        {row.subject ? (
          <div className="flex items-center gap-2">
            <MicroLabel>ON</MicroLabel>
            <FilterablePerson
              person={row.subject}
              hint="Everything done to this member"
              onFilter={() =>
                filterBy.subject({ id: row.subject!.id, name: row.subject!.displayName })
              }
            />
          </div>
        ) : null}
      </div>

      {detail.facts.length > 0 ? (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          {detail.facts.map((fact, i) => (
            <FactRow key={`${fact.label}-${i}`} fact={fact} />
          ))}
        </dl>
      ) : null}

      {detail.quote ? (
        <div className="flex flex-col gap-1">
          <MicroLabel>{detail.quote.label.toUpperCase()}</MicroLabel>
          <Quote className="my-0">
            <span className="line-clamp-6 whitespace-pre-wrap">{detail.quote.text}</span>
          </Quote>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <MicroLabel>REASON</MicroLabel>
        {row.reason ? (
          <Text size="sm" textWrap="pretty">
            “{row.reason}”
          </Text>
        ) : (
          <Text size="sm" variant="muted">
            None given
          </Text>
        )}
      </div>

      {hasMetadata ? (
        <details className="group">
          <summary className="w-fit cursor-pointer text-xs text-muted-foreground hover:text-primary">
            Raw record #{row.id}
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
            {JSON.stringify(
              { targetType: row.targetType, targetId: row.targetId, ...row.metadata },
              null,
              2,
            )}
          </pre>
        </details>
      ) : null}
    </AdminRow>
  );
}

function FilterablePerson({
  person,
  hint,
  onFilter,
}: {
  person: LogPerson;
  hint: string;
  onFilter: () => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <AdminPerson user={person} name={person.displayName} size={20} />
      <Button variant="ghost" size="icon-xs" tooltip={hint} aria-label={hint} onClick={onFilter}>
        <HugeiconsIcon icon={FilterHorizontalIcon} strokeWidth={2} />
      </Button>
    </span>
  );
}

function FactRow({ fact }: { fact: LogFact }) {
  return (
    <>
      <dt className="pt-0.5">
        <MicroLabel>{fact.label.toUpperCase()}</MicroLabel>
      </dt>
      <dd className="min-w-0">
        {"person" in fact ? (
          fact.person ? (
            <AdminPerson user={fact.person} name={fact.person.displayName} size={18} />
          ) : (
            <Text size="sm" variant="muted">
              {fact.fallback}
            </Text>
          )
        ) : "from" in fact ? (
          <Text as="span" size="sm" className="break-words">
            <span className="text-muted-foreground line-through decoration-destructive/60">
              {fact.from}
            </span>
            <span className="px-1.5 text-muted-foreground">→</span>
            <span className="font-medium">{fact.to}</span>
          </Text>
        ) : (
          <Text as="span" size="sm" className="line-clamp-4 break-words whitespace-pre-wrap">
            {fact.value}
          </Text>
        )}
      </dd>
    </>
  );
}

const TARGET_LINK = "min-w-0 truncate text-sm font-medium hover:text-primary hover:underline";

function TargetLink({ target }: { target: LogTarget }) {
  switch (target.kind) {
    case "collab":
      return (
        <Link
          to="/collab/$postId"
          params={{ postId: target.postId }}
          hash={target.hash}
          className={TARGET_LINK}
        >
          {target.label}
        </Link>
      );
    case "forum":
      return (
        <Link
          to="/forum/$postId"
          params={{ postId: target.postId }}
          hash={target.hash}
          className={TARGET_LINK}
        >
          {target.label}
        </Link>
      );
    case "profile":
      return (
        <Link
          to="/profile/$userId"
          params={profileLinkParams(target.person)}
          hash={target.hash}
          className={TARGET_LINK}
        >
          {target.label}
        </Link>
      );
    case "team":
      return (
        <Link to="/teams/$teamId" params={teamLinkParams(target.team)} className={TARGET_LINK}>
          {target.label}
        </Link>
      );
    case "project":
      return (
        <Link
          to="/projects/$projectSlug"
          params={{ projectSlug: target.slug }}
          className={TARGET_LINK}
        >
          {target.label}
        </Link>
      );
    case "jam":
      return (
        <Link to="/jams/$jamSlug" params={jamLinkParams(target.jam)} className={TARGET_LINK}>
          {target.label}
        </Link>
      );
    case "image":
      return (
        <a href={target.href} target="_blank" rel="noreferrer" className={TARGET_LINK}>
          {target.label}
        </a>
      );
    case "text":
      return (
        <Text as="span" size="sm" variant="muted" className="truncate">
          {target.label}
        </Text>
      );
  }
}
