import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AdminPager, AdminPersonLink, AdminRow, AdminSection } from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Empty } from "@/components/ui/empty";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { timeAgo } from "@/lib/format-time";
import { toastMutationError } from "@/lib/mutation-errors";
import { client, orpc } from "@/orpc/client";

const PAGE_SIZE = 20;

type FlagList = Awaited<ReturnType<typeof client.listEntryFlags>>;
type FlagGroup = FlagList["groups"][number];
type EntryFlag = FlagGroup["flags"][number];
type ListInput = Parameters<typeof client.listEntryFlags>[0];
type KindFilter = NonNullable<ListInput["kind"]>;
type SourceFilter = NonNullable<ListInput["nsfwSource"]>;
type GroupBy = NonNullable<ListInput["groupBy"]>;

/** The shape the scan worker writes into `evidence` (jsonb, so read defensively). */
type FlagEvidence = {
  nsfwScore?: number;
  nsfwReason?: string;
  nsfwTags?: string[];
  scorer?: string;
  hashDistance?: number;
  coverUrl?: string | null;
  matchedEntry?: {
    entryId?: number;
    gameTitle?: string;
    gameUrl?: string;
    rateUrl?: string;
    coverUrl?: string | null;
    authorName?: string | null;
    submittedAt?: string | null;
  };
};

const KIND_LABEL: Record<EntryFlag["kind"], string> = {
  stolen_external: "STOLEN — EXTERNAL",
  stolen_internal: "MATCHED COVER",
  nsfw: "NSFW",
  other: "FLAGGED",
};

/** Why the classifier fired — a dead body is a different call than nudity. */
const NSFW_REASON_LABEL: Record<string, string> = {
  sexual: "SEXUAL / NUDITY",
  gore: "GORE / DEATH",
};

type Resolve = (input: { flagIds: number[]; action: "confirm" | "dismiss" }) => Promise<unknown>;

/**
 * The detection queue (plan 22): what the scan worker flagged, for a human
 * to confirm or dismiss. Confirm records the judgment and nothing else —
 * staff act on itch itself, and either resolution stands the detector down
 * for that entry. Rows are games (or covers) rather than flags, so a game
 * entered in five jams is one judgment.
 */
export function AdminEntryFlags() {
  const [scope, setScope] = useState<"open" | "resolved">("open");
  const [jamScope, setJamScope] = useState<"live" | "all">("live");
  const [kind, setKind] = useState<KindFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("game");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const includeResolved = scope === "resolved";
  const flags = useQuery(
    orpc.listEntryFlags.queryOptions({
      input: {
        includeResolved,
        jamScope,
        kind,
        nsfwSource: kind === "stolen_internal" ? "all" : source,
        groupBy,
        page,
        pageSize: PAGE_SIZE,
      },
    }),
  );

  const resolve = useMutation({
    mutationFn: (input: { flagIds: number[]; action: "confirm" | "dismiss" }) =>
      client.resolveEntryFlags(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.listEntryFlags.key() });
    },
    onError: toastMutationError("admin.entry_flag_resolve"),
  });

  const data = flags.data;
  const groups = data?.groups ?? [];

  function pick<T>(setter: (value: T) => void) {
    return (next: T) => {
      setter(next);
      setPage(1);
    };
  }

  return (
    <AdminSection
      title="Entry flags"
      count={flags.isPending ? undefined : data?.flagCount}
      hint={
        includeResolved
          ? "Already ruled on — the detector won't re-flag these."
          : "Covers the scan worker thinks a human should see, most confident first."
      }
      actions={
        <div className="flex items-center gap-2">
          <SegmentedControl
            size="sm"
            value={jamScope}
            onChange={pick((next) => setJamScope(next as "live" | "all"))}
          >
            <SegmentedControl.Item value="live">Live jams</SegmentedControl.Item>
            <SegmentedControl.Item value="all">All</SegmentedControl.Item>
          </SegmentedControl>
          <SegmentedControl
            size="sm"
            value={scope}
            onChange={pick((next) => setScope(next as "open" | "resolved"))}
          >
            <SegmentedControl.Item value="open">Open</SegmentedControl.Item>
            <SegmentedControl.Item value="resolved">Resolved</SegmentedControl.Item>
          </SegmentedControl>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterGroup label="Kind">
          <SegmentedControl
            size="sm"
            value={kind}
            onChange={pick((next) => setKind(next as KindFilter))}
          >
            <SegmentedControl.Item value="all">All</SegmentedControl.Item>
            <SegmentedControl.Item value="nsfw">NSFW</SegmentedControl.Item>
            <SegmentedControl.Item value="stolen_internal">Matched cover</SegmentedControl.Item>
          </SegmentedControl>
        </FilterGroup>
        {kind !== "stolen_internal" ? (
          <FilterGroup label="NSFW signal">
            <SegmentedControl
              size="sm"
              value={source}
              onChange={pick((next) => setSource(next as SourceFilter))}
            >
              <SegmentedControl.Item value="all">Either</SegmentedControl.Item>
              <SegmentedControl.Item value="creator">Creator-tagged</SegmentedControl.Item>
              <SegmentedControl.Item value="classifier">Our scorer</SegmentedControl.Item>
            </SegmentedControl>
          </FilterGroup>
        ) : null}
        <FilterGroup label="One row per">
          <SegmentedControl
            size="sm"
            value={groupBy}
            onChange={pick((next) => setGroupBy(next as GroupBy))}
          >
            <SegmentedControl.Item value="game">Game</SegmentedControl.Item>
            <SegmentedControl.Item value="cover">Identical cover</SegmentedControl.Item>
            <SegmentedControl.Item value="none">Flag</SegmentedControl.Item>
          </SegmentedControl>
        </FilterGroup>
      </div>

      {flags.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : groups.length === 0 ? (
        <Empty>
          {includeResolved
            ? "Nothing has been ruled on yet."
            : jamScope === "live"
              ? "Nothing flagged in live jams. Switch to All for history."
              : "The queue is empty. Nothing needs you right now."}
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => (
            <GroupRow
              key={group.key}
              group={group}
              groupBy={groupBy}
              busy={resolve.isPending}
              resolve={resolve.mutateAsync}
            />
          ))}
        </div>
      )}

      {data && data.pageCount > 1 ? (
        <AdminPager
          page={data.page}
          pageCount={data.pageCount}
          total={data.total}
          pageSize={data.pageSize}
          unit={groupBy === "none" ? "flags" : groupBy === "game" ? "games" : "covers"}
          onPage={setPage}
        />
      ) : null}
    </AdminSection>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <MicroLabel>{label.toUpperCase()}</MicroLabel>
      {children}
    </div>
  );
}

/**
 * One queue row: the group's most confident flag in full, then the other
 * flags behind the same game or cover as a compact list. The whole row can
 * be ruled on at once, or flag by flag.
 */
function GroupRow({
  group,
  groupBy,
  busy,
  resolve,
}: {
  group: FlagGroup;
  groupBy: GroupBy;
  busy: boolean;
  resolve: Resolve;
}) {
  const [lead, ...rest] = group.flags;
  if (!lead) return null;
  const openIds = group.flags.filter((f) => f.resolvedAt == null).map((f) => f.id);
  const allResolved = openIds.length === 0;

  return (
    <AdminRow muted={allResolved}>
      <div className="flex flex-col gap-3">
        <FlagHeader flag={lead} />
        <FlagBody flag={lead} />

        {rest.length > 0 ? (
          <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
            <Text size="xs" variant="muted">
              {groupBy === "cover" ? "Same cover on" : "Also flagged in"} {rest.length} more{" "}
              {rest.length === 1 ? "entry" : "entries"}
            </Text>
            {rest.map((flag) => (
              <SiblingFlag
                key={flag.id}
                flag={flag}
                lead={lead}
                showGame={groupBy === "cover" || flag.gameId !== lead.gameId}
                busy={busy}
                resolve={resolve}
              />
            ))}
          </div>
        ) : null}

        {allResolved ? (
          <ResolvedBy flag={lead} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <ResolveButtons
              flagIds={openIds}
              label={openIds.length > 1 ? `all ${openIds.length}` : undefined}
              busy={busy}
              resolve={resolve}
            />
          </div>
        )}
      </div>
    </AdminRow>
  );
}

function FlagHeader({ flag }: { flag: EntryFlag }) {
  const evidence = (flag.evidence ?? {}) as FlagEvidence;
  const nsfwReason = flag.kind === "nsfw" ? evidence.nsfwReason : undefined;
  const nsfwTags =
    flag.kind === "nsfw" && evidence.nsfwTags?.length ? evidence.nsfwTags : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge size="label" variant={flag.kind === "nsfw" ? "destructive" : "default"}>
        {KIND_LABEL[flag.kind]}
      </Badge>
      {nsfwReason ? (
        <Badge size="label" variant="destructive">
          {NSFW_REASON_LABEL[nsfwReason] ?? nsfwReason.toUpperCase()}
        </Badge>
      ) : null}
      {nsfwTags ? (
        <Badge size="label" variant="destructive">
          CREATOR-TAGGED ADULT
        </Badge>
      ) : null}
      <ScoreBadge flag={flag} />
      {flag.entryMissingSince ? (
        <Badge size="label" variant="destructive">
          ENTRY GONE FROM ITCH
        </Badge>
      ) : null}
      <StatusBadge flag={flag} />
      <Text size="xs" variant="muted">
        {flag.jamTitle} · flagged {timeAgo(flag.createdAt)}
      </Text>
    </div>
  );
}

function ScoreBadge({ flag }: { flag: EntryFlag }) {
  if (flag.score == null) return null;
  const evidence = (flag.evidence ?? {}) as FlagEvidence;
  // Creator-tag flags pin the score to 1; the badge only means something
  // for our scorer's own verdict, so say whose number it is.
  const tagged = flag.kind === "nsfw" && Boolean(evidence.nsfwTags?.length);
  return (
    <Badge size="label" variant="outline">
      {tagged ? "TAGGED" : `${Math.round(flag.score * 100)}%`}
    </Badge>
  );
}

function StatusBadge({ flag }: { flag: EntryFlag }) {
  if (flag.status === "open") return null;
  return (
    <Badge size="label" variant="outline">
      {flag.status === "confirmed" ? "CONFIRMED" : "DISMISSED"}
    </Badge>
  );
}

function FlagBody({ flag }: { flag: EntryFlag }) {
  const evidence = (flag.evidence ?? {}) as FlagEvidence;
  const matched = flag.kind === "stolen_internal" ? evidence.matchedEntry : undefined;
  const nsfwTags =
    flag.kind === "nsfw" && evidence.nsfwTags?.length ? evidence.nsfwTags : undefined;
  return (
    <div className="flex flex-wrap items-start gap-4">
      <CoverCard
        label={matched ? "Flagged entry" : undefined}
        coverUrl={flag.gameCoverUrl}
        title={flag.gameTitle}
        href={flag.gameUrl}
        authorName={flag.authorName}
        authorUrl={flag.authorUrl}
        submittedAt={flag.submittedAt}
        detail={nsfwTags ? `tagged ${nsfwTags.join(", ")}` : undefined}
      />
      {matched ? (
        <CoverCard
          label="Matches this earlier entry"
          coverUrl={matched.coverUrl ?? null}
          title={matched.gameTitle ?? "Unknown entry"}
          href={matched.gameUrl}
          authorName={matched.authorName ?? null}
          authorUrl={null}
          submittedAt={matched.submittedAt ? new Date(matched.submittedAt) : null}
          detail={
            evidence.hashDistance != null
              ? evidence.hashDistance === 0
                ? "identical hash"
                : `hash distance ${evidence.hashDistance}`
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

/**
 * A non-lead flag in a group: one line carrying only what differs from the
 * lead (kind, a scorer percentage, a ruling), with its own controls shown
 * on hover or keyboard focus — the row-level buttons are the usual path.
 */
function SiblingFlag({
  flag,
  lead,
  showGame,
  busy,
  resolve,
}: {
  flag: EntryFlag;
  lead: EntryFlag;
  showGame: boolean;
  busy: boolean;
  resolve: Resolve;
}) {
  const evidence = (flag.evidence ?? {}) as FlagEvidence;
  const tagged = flag.kind === "nsfw" && Boolean(evidence.nsfwTags?.length);
  return (
    <div className="group flex min-h-6 flex-wrap items-center gap-2">
      {flag.kind !== lead.kind ? (
        <Badge size="label" variant={flag.kind === "nsfw" ? "destructive" : "default"}>
          {KIND_LABEL[flag.kind]}
        </Badge>
      ) : null}
      {!tagged ? <ScoreBadge flag={flag} /> : null}
      <StatusBadge flag={flag} />
      <Text size="xs" variant="muted" className="min-w-0 truncate">
        {showGame ? (
          <>
            <a
              href={flag.gameUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground hover:underline"
            >
              {flag.gameTitle}
            </a>
            {" · "}
          </>
        ) : null}
        <a href={flag.rateUrl} target="_blank" rel="noreferrer" className="hover:underline">
          {flag.jamTitle}
        </a>
        {flag.submittedAt ? <> · submitted {timeAgo(flag.submittedAt)}</> : null}
      </Text>
      {flag.resolvedAt == null ? (
        <div className="flex items-center gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <ResolveButtons flagIds={[flag.id]} busy={busy} resolve={resolve} />
        </div>
      ) : null}
    </div>
  );
}

function ResolveButtons({
  flagIds,
  label,
  busy,
  resolve,
}: {
  flagIds: number[];
  /** Appended to the button text, e.g. "all 5". */
  label?: string;
  busy: boolean;
  resolve: Resolve;
}) {
  const many = flagIds.length > 1;
  return (
    <>
      <Confirm
        title={many ? `Confirm ${flagIds.length} flags?` : "Confirm this flag?"}
        message="Records that the detection was right. Nothing happens to the entry here — action, if any, is taken on itch itself."
        confirmText={many ? "Confirm all" : "Confirm flag"}
        onConfirm={async () => {
          await resolve({ flagIds, action: "confirm" });
        }}
      >
        <Button variant="default" size="xs" disabled={busy}>
          Confirm{label ? ` ${label}` : ""}
        </Button>
      </Confirm>
      <Confirm
        title={many ? `Dismiss ${flagIds.length} flags?` : "Dismiss this flag?"}
        message="Marks the detection as wrong or not worth acting on. The scanner won't flag these entries for the same reason again."
        confirmText={many ? "Dismiss all" : "Dismiss"}
        onConfirm={async () => {
          await resolve({ flagIds, action: "dismiss" });
        }}
      >
        <Button variant="outline" size="xs" disabled={busy}>
          Dismiss{label ? ` ${label}` : ""}
        </Button>
      </Confirm>
    </>
  );
}

function ResolvedBy({ flag }: { flag: EntryFlag }) {
  if (flag.resolvedAt == null) return null;
  return (
    <Text size="xs" variant="muted">
      {flag.status === "confirmed" ? "Confirmed" : "Dismissed"}{" "}
      {flag.resolvedBy ? (
        <>
          by{" "}
          <AdminPersonLink user={flag.resolvedBy}>
            {flag.resolvedBy.displayName}
          </AdminPersonLink>{" "}
        </>
      ) : null}
      {timeAgo(flag.resolvedAt)}
    </Text>
  );
}

function CoverCard({
  label,
  coverUrl,
  title,
  href,
  authorName,
  authorUrl,
  submittedAt,
  detail,
}: {
  label?: string;
  coverUrl: string | null;
  title: string;
  href?: string;
  authorName: string | null;
  authorUrl?: string | null;
  submittedAt: Date | null;
  detail?: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      {coverUrl ? (
        // Raw scraped cover on purpose: the queue judges the actual image,
        // so no CF transform between the mod and the evidence.
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          className="h-20 w-[6.3rem] shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-20 w-[6.3rem] shrink-0 items-center justify-center rounded bg-muted/40">
          <Text size="xs" variant="muted">
            no cover
          </Text>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        {label ? (
          <Text size="xs" variant="muted" className="uppercase">
            {label}
          </Text>
        ) : null}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium underline-offset-2 hover:underline"
          >
            {title}
          </a>
        ) : (
          <Text as="span" className="truncate font-medium">
            {title}
          </Text>
        )}
        <Text size="xs" variant="muted" className="truncate">
          {authorUrl && authorName ? (
            <a href={authorUrl} target="_blank" rel="noreferrer" className="hover:underline">
              {authorName}
            </a>
          ) : (
            (authorName ?? "Unknown author")
          )}
          {submittedAt ? <> · submitted {timeAgo(submittedAt)}</> : null}
          {detail ? <> · {detail}</> : null}
        </Text>
      </div>
    </div>
  );
}
