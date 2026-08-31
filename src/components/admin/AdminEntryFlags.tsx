import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AdminPager, AdminPersonLink, AdminRow, AdminSection } from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Empty } from "@/components/ui/empty";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { timeAgo } from "@/lib/format-time";
import { toastMutationError } from "@/lib/mutation-errors";
import { client, orpc } from "@/orpc/client";

const PAGE_SIZE = 20;

type EntryFlag = Awaited<ReturnType<typeof client.listEntryFlags>>["items"][number];

/** The shape the scan worker writes into `evidence` (jsonb, so read defensively). */
type FlagEvidence = {
  nsfwScore?: number;
  nsfwReason?: string;
  nsfwCategories?: Record<string, number>;
  nsfwTags?: string[];
  hashDistance?: number;
  coverUrl?: string | null;
  matchedEntry?: {
    entryId?: number;
    gameTitle?: string;
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

/**
 * The detection queue (plan 22): what the scan worker flagged, for a human
 * to confirm or dismiss. Confirm records the judgment and nothing else —
 * staff act on itch itself, and either resolution stands the detector down
 * for that entry.
 */
export function AdminEntryFlags() {
  const [scope, setScope] = useState<"open" | "resolved">("open");
  const [jamScope, setJamScope] = useState<"live" | "all">("live");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const includeResolved = scope === "resolved";
  const flags = useQuery(
    orpc.listEntryFlags.queryOptions({
      input: { includeResolved, jamScope, page, pageSize: PAGE_SIZE },
    }),
  );

  const resolve = useMutation({
    mutationFn: (input: { flagId: number; action: "confirm" | "dismiss" }) =>
      client.resolveEntryFlag(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.listEntryFlags.key() });
    },
    onError: toastMutationError("admin.entry_flag_resolve"),
  });

  const data = flags.data;
  const items = data?.items ?? [];

  return (
    <AdminSection
      title="Entry flags"
      count={flags.isPending ? undefined : data?.total}
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
            onChange={(next) => {
              setJamScope(next as "live" | "all");
              setPage(1);
            }}
          >
            <SegmentedControl.Item value="live">Live jams</SegmentedControl.Item>
            <SegmentedControl.Item value="all">All</SegmentedControl.Item>
          </SegmentedControl>
          <SegmentedControl
            size="sm"
            value={scope}
            onChange={(next) => {
              setScope(next as "open" | "resolved");
              setPage(1);
            }}
          >
            <SegmentedControl.Item value="open">Open</SegmentedControl.Item>
            <SegmentedControl.Item value="resolved">Resolved</SegmentedControl.Item>
          </SegmentedControl>
        </div>
      }
    >
      {flags.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Empty>
          {includeResolved
            ? "Nothing has been ruled on yet."
            : jamScope === "live"
              ? "Nothing flagged in live jams. Switch to All for history."
              : "The queue is empty. Nothing needs you right now."}
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((flag) => (
            <FlagRow
              key={flag.id}
              flag={flag}
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
          unit="flags"
          onPage={setPage}
        />
      ) : null}
    </AdminSection>
  );
}

function FlagRow({
  flag,
  busy,
  resolve,
}: {
  flag: EntryFlag;
  busy: boolean;
  resolve: (input: { flagId: number; action: "confirm" | "dismiss" }) => Promise<unknown>;
}) {
  const evidence = (flag.evidence ?? {}) as FlagEvidence;
  const matched = flag.kind === "stolen_internal" ? evidence.matchedEntry : undefined;
  const nsfwReason = flag.kind === "nsfw" ? evidence.nsfwReason : undefined;
  const nsfwCategories = flag.kind === "nsfw" ? evidence.nsfwCategories : undefined;
  const nsfwTags =
    flag.kind === "nsfw" && evidence.nsfwTags?.length ? evidence.nsfwTags : undefined;

  return (
    <AdminRow muted={flag.resolvedAt != null}>
      <div className="flex flex-col gap-3">
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
          {flag.score != null ? (
            <Badge size="label" variant="outline">
              {Math.round(flag.score * 100)}%
            </Badge>
          ) : null}
          {flag.entryMissingSince ? (
            <Badge size="label" variant="destructive">
              ENTRY GONE FROM ITCH
            </Badge>
          ) : null}
          {flag.status !== "open" ? (
            <Badge size="label" variant="outline">
              {flag.status === "confirmed" ? "CONFIRMED" : "DISMISSED"}
            </Badge>
          ) : null}
          <Text size="xs" variant="muted">
            {flag.jamTitle} · flagged {timeAgo(flag.createdAt)}
          </Text>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <CoverCard
            label={matched ? "Flagged entry" : undefined}
            coverUrl={flag.gameCoverUrl}
            title={flag.gameTitle}
            href={flag.rateUrl}
            authorName={flag.authorName}
            authorUrl={flag.authorUrl}
            submittedAt={flag.submittedAt}
            detail={
              [
                nsfwTags ? `tagged ${nsfwTags.join(", ")}` : null,
                nsfwCategories
                  ? Object.entries(nsfwCategories)
                      .sort(([, a], [, b]) => b - a)
                      .map(([category, score]) => `${category} ${Math.round(score * 100)}%`)
                      .join(" · ")
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            }
          />
          {matched ? (
            <CoverCard
              label="Matches this earlier entry"
              coverUrl={matched.coverUrl ?? null}
              title={matched.gameTitle ?? "Unknown entry"}
              href={matched.rateUrl}
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

        {flag.resolvedAt != null ? (
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
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Confirm
              title="Confirm this flag?"
              message="Records that the detection was right. Nothing happens to the entry here — action, if any, is taken on itch itself."
              confirmText="Confirm flag"
              onConfirm={async () => {
                await resolve({ flagId: flag.id, action: "confirm" });
              }}
            >
              <Button variant="default" size="xs" disabled={busy}>
                Confirm
              </Button>
            </Confirm>
            <Confirm
              title="Dismiss this flag?"
              message="Marks the detection as wrong or not worth acting on. The scanner won't flag this entry for the same reason again."
              confirmText="Dismiss"
              onConfirm={async () => {
                await resolve({ flagId: flag.id, action: "dismiss" });
              }}
            >
              <Button variant="outline" size="xs" disabled={busy}>
                Dismiss
              </Button>
            </Confirm>
          </div>
        )}
      </div>
    </AdminRow>
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
