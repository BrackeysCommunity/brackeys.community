import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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

type FlagList = Awaited<ReturnType<typeof client.listImageFlags>>;
type ImageFlag = FlagList["items"][number];

/** The shape the media-scan worker writes into `evidence` (jsonb, read defensively). */
type FlagEvidence = {
  nsfwScore?: number;
  scorer?: string;
  quarantined?: boolean;
  quarantineThreshold?: number;
};

const KIND_LABEL: Record<ImageFlag["kind"], string> = {
  stolen_external: "STOLEN — EXTERNAL",
  stolen_internal: "MATCHED COVER",
  nsfw: "NSFW",
  other: "FLAGGED",
};

type Resolve = (input: { flagIds: number[]; action: "confirm" | "dismiss" }) => Promise<unknown>;

/**
 * The upload queue (plan 27): images members uploaded that the media-scan
 * worker flagged. Unlike entry flags, a ruling here acts on our own object
 * — confirm deletes it, dismiss puts a quarantined image back where it
 * was. Quarantined images are shown through the staff-only route since the
 * public URL 404s once the object has moved.
 */
export function AdminImageFlags() {
  const [scope, setScope] = useState<"open" | "resolved">("open");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const includeResolved = scope === "resolved";
  const flags = useQuery(
    orpc.listImageFlags.queryOptions({
      input: { includeResolved, page, pageSize: PAGE_SIZE },
    }),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.listImageFlags.key() });
  };

  const resolve = useMutation({
    mutationFn: (input: { flagIds: number[]; action: "confirm" | "dismiss" }) =>
      client.resolveImageFlags(input),
    onSuccess: invalidate,
    onError: toastMutationError("admin.image_flag_resolve"),
  });

  const rescan = useMutation({
    mutationFn: (objectKey: string) => client.requestImageRescan({ objectKey }),
    onSuccess: invalidate,
    onError: toastMutationError("admin.image_rescan"),
  });

  const data = flags.data;
  const items = data?.items ?? [];

  return (
    <AdminSection
      title="Upload flags"
      count={flags.isPending ? undefined : data?.total}
      hint={
        includeResolved
          ? "Already ruled on — the scanner won't re-flag these."
          : "Images members uploaded that the scanner thinks a human should see, most confident first."
      }
      actions={
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
            : "The queue is empty. Nothing needs you right now."}
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((flag) => (
            <FlagRow
              key={flag.id}
              flag={flag}
              busy={resolve.isPending || rescan.isPending}
              resolve={resolve.mutateAsync}
              rescan={rescan.mutateAsync}
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
  rescan,
}: {
  flag: ImageFlag;
  busy: boolean;
  resolve: Resolve;
  rescan: (objectKey: string) => Promise<unknown>;
}) {
  const evidence = (flag.evidence ?? {}) as FlagEvidence;
  const resolved = flag.resolvedAt != null;
  const quarantined = flag.scanStatus === "quarantined";

  return (
    <AdminRow muted={resolved}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="label" variant={flag.kind === "nsfw" ? "destructive" : "default"}>
            {KIND_LABEL[flag.kind]}
          </Badge>
          {flag.score != null ? (
            <Badge size="label" variant="outline">
              {Math.round(flag.score * 100)}%
            </Badge>
          ) : null}
          {quarantined ? (
            <Badge size="label" variant="destructive">
              HIDDEN — QUARANTINED
            </Badge>
          ) : flag.scanStatus === "purged" ? (
            <Badge size="label" variant="outline">
              DELETED
            </Badge>
          ) : flag.scanStatus === "cleared" ? (
            <Badge size="label" variant="outline">
              RESTORED
            </Badge>
          ) : null}
          {resolved ? (
            <Badge size="label" variant="outline">
              {flag.status === "confirmed" ? "CONFIRMED" : "DISMISSED"}
            </Badge>
          ) : null}
          <Text size="xs" variant="muted">
            {flag.ownerTypeLabel} · flagged {timeAgo(flag.createdAt)}
          </Text>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          {flag.imageUrl ? (
            // The staff route, not /images/: a quarantined object has left
            // the public namespace, and the queue judges the actual pixels.
            <a href={flag.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
              <img
                src={flag.imageUrl}
                alt=""
                loading="lazy"
                className="h-24 w-36 rounded object-cover"
              />
            </a>
          ) : (
            <div className="flex h-24 w-36 shrink-0 items-center justify-center rounded bg-muted/40">
              <Text size="xs" variant="muted">
                deleted
              </Text>
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <Text size="sm">
              On{" "}
              {flag.owner?.href ? (
                <Link
                  to={flag.owner.href}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {flag.owner.label}
                </Link>
              ) : (
                <span className="font-medium">{flag.owner?.label ?? flag.ownerTypeLabel}</span>
              )}
            </Text>
            <Text size="xs" variant="muted">
              Uploaded by{" "}
              {flag.uploader ? (
                <AdminPersonLink user={flag.uploader}>{flag.uploader.displayName}</AdminPersonLink>
              ) : (
                "an unknown member"
              )}
              {evidence.scorer ? <> · scorer {evidence.scorer}</> : null}
              {evidence.quarantineThreshold != null ? (
                <> · quarantine at {Math.round(evidence.quarantineThreshold * 100)}%</>
              ) : null}
            </Text>
            <Text size="xs" variant="muted" className="truncate">
              {flag.objectKey}
            </Text>
          </div>
        </div>

        {resolved ? (
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
            {flag.resolvedAt ? timeAgo(flag.resolvedAt) : null}
          </Text>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Confirm
              title="Delete this image?"
              message="Confirms the detection and deletes the object for good. The uploader keeps everything else on the page."
              confirmText="Delete image"
              onConfirm={async () => {
                await resolve({ flagIds: [flag.id], action: "confirm" });
              }}
            >
              <Button variant="default" size="xs" disabled={busy}>
                Confirm &amp; delete
              </Button>
            </Confirm>
            <Confirm
              title={quarantined ? "Restore this image?" : "Dismiss this flag?"}
              message={
                quarantined
                  ? "Marks the detection as wrong, puts the image back where it was, and stops the scanner from flagging it again."
                  : "Marks the detection as wrong or not worth acting on. The scanner won't flag this image for the same reason again."
              }
              confirmText={quarantined ? "Restore" : "Dismiss"}
              onConfirm={async () => {
                await resolve({ flagIds: [flag.id], action: "dismiss" });
              }}
            >
              <Button variant="outline" size="xs" disabled={busy}>
                {quarantined ? "Dismiss & restore" : "Dismiss"}
              </Button>
            </Confirm>
            {flag.scanStatus !== "purged" ? (
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => void rescan(flag.objectKey)}
              >
                Rescan
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </AdminRow>
  );
}
