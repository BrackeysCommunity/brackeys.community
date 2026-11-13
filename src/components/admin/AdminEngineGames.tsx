import { sceneVersionName } from "@jams/engine/game";
import { shortId } from "@jams/engine/scene";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AdminPerson, AdminRow, AdminSection, ReasonField } from "@/components/admin/AdminUI";
import { CHANNEL_BADGE_LABEL } from "@/components/games/VersionList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Empty } from "@/components/ui/empty";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/time-ago";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { Text } from "@/components/ui/typography";
import { BLOCKED_BY } from "@/lib/engine/editor-live-host";
import { engineGamesAllowed } from "@/lib/engine/guard";
import { useFlag } from "@/lib/hooks/use-flag";
import { toastMutationError } from "@/lib/mutation-errors";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

type Queue = Awaited<ReturnType<typeof client.listGameModerationQueue>>;
type GameReport = Queue["reports"][number];
type ReviewRequest = Queue["reviews"][number];
type ImageFlag = Awaited<ReturnType<typeof client.listImageFlags>>["items"][number];
type SceneVersion = Awaited<ReturnType<typeof client.listSceneVersionQueue>>[number];
type SceneVersionRef = { projectId: string; scene: string; number: number };

type ReportAction = "dismiss" | "hide-release" | "hide-project";

const RESOLUTION_LABEL: Record<NonNullable<GameReport["resolution"]>, string> = {
  "hidden-release": "VERSION HIDDEN",
  "hidden-project": "GAME HIDDEN",
  dismissed: "DISMISSED",
};

/**
 * Staff's queue for hosted games: players' reports, first-public review
 * requests, release images the scanner flagged and live scene versions. Nothing renders while
 * `engine-games-enabled` is off for the viewer or the deployment may not
 * host games, so its procedures are never asked.
 */
export function AdminEngineGames() {
  const flagOn = useFlag("engine-games-enabled");
  if (!flagOn || !engineGamesAllowed()) return null;
  return <EngineGamesQueue />;
}

function EngineGamesQueue() {
  const [scope, setScope] = useState<"open" | "resolved">("open");
  const [versionScope, setVersionScope] = useState<"active" | "all">("active");
  // Keyed by row so a reason typed in one dialog can't leak into the next.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const includeResolved = scope === "resolved";

  const queue = useQuery(orpc.listGameModerationQueue.queryOptions({ input: { includeResolved } }));
  const releaseFiles = useQuery(
    orpc.listImageFlags.queryOptions({
      input: { includeResolved: false, ownerType: "engine_release_file", page: 1, pageSize: 50 },
    }),
  );
  const blobs = useQuery(
    orpc.listImageFlags.queryOptions({
      input: { includeResolved: false, ownerType: "engine_blob", page: 1, pageSize: 50 },
    }),
  );

  const versions = useQuery(
    orpc.listSceneVersionQueue.queryOptions({
      input: { includeHidden: versionScope === "all" },
    }),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.listGameModerationQueue.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.listImageFlags.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.listSceneVersionQueue.key() });
  };

  const resolveReport = useMutation({
    mutationFn: (input: { reportId: number; action: ReportAction; reason?: string }) =>
      client.resolveGameReport(input),
    onSuccess: (_result, input) => {
      invalidate();
      toast.success(
        input.action === "dismiss"
          ? "Report dismissed."
          : input.action === "hide-release"
            ? "Version hidden. Its publishers see the reason."
            : "Game hidden. Its publishers see the reason.",
      );
    },
    onError: toastMutationError("admin.game_report_resolve"),
  });
  const unhide = useMutation({
    mutationFn: (input: { projectId: string; version?: number }) => client.unhideRelease(input),
    onSuccess: (_result, input) => {
      invalidate();
      toast.success(input.version != null ? `v${input.version} is back.` : "The game is back.");
    },
    onError: toastMutationError("admin.game_unhide"),
  });
  const approve = useMutation({
    mutationFn: (input: { projectId: string }) => client.approveGamePublic(input),
    onSuccess: () => {
      invalidate();
      toast.success("Approved. The game is public, and later releases follow without review.");
    },
    onError: toastMutationError("admin.game_approve_public"),
  });
  const dismissFlag = useMutation({
    mutationFn: (flagId: number) =>
      client.resolveImageFlags({ flagIds: [flagId], action: "dismiss" }),
    onSuccess: () => {
      invalidate();
      toast.success("Flag dismissed. The releases it hid are back.");
    },
    onError: toastMutationError("admin.game_image_dismiss"),
  });

  const hideVersion = useMutation({
    mutationFn: (input: SceneVersionRef & { reason: string }) => client.hideSceneVersion(input),
    onSuccess: (_result, input) => {
      invalidate();
      toast.success(
        `${sceneVersionName(input.scene, input.number)} hidden. Pages running it reload, and its publishers see the reason.`,
      );
    },
    onError: toastMutationError("admin.scene_version_hide"),
  });
  const unhideVersion = useMutation({
    mutationFn: (input: SceneVersionRef & { reason: string }) => client.unhideSceneVersion(input),
    onSuccess: (_result, input) => {
      invalidate();
      toast.success(`${sceneVersionName(input.scene, input.number)} is back.`);
    },
    onError: toastMutationError("admin.scene_version_unhide"),
  });

  const busy =
    resolveReport.isPending ||
    unhide.isPending ||
    approve.isPending ||
    dismissFlag.isPending ||
    hideVersion.isPending ||
    unhideVersion.isPending;
  const reasonOf = (key: string) => reasons[key] ?? "";
  const setReason = (key: string) => (next: string) =>
    setReasons((prev) => ({ ...prev, [key]: next }));

  const reports = useMemo(
    () =>
      (queue.data?.reports ?? []).filter((r) =>
        includeResolved ? r.resolvedAt != null : r.resolvedAt == null,
      ),
    [queue.data, includeResolved],
  );
  const flags = useMemo(
    () =>
      [...(releaseFiles.data?.items ?? []), ...(blobs.data?.items ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [releaseFiles.data, blobs.data],
  );
  const reviews = queue.data?.reviews ?? [];

  return (
    <>
      <AdminSection
        title="Game reports"
        count={queue.isPending ? undefined : reports.length}
        hint={
          includeResolved
            ? "Already handled — kept for the record."
            : "Players' reports on hosted games, newest first."
        }
        actions={
          <SegmentedControl
            size="sm"
            value={scope}
            onChange={(next) => setScope(next as "open" | "resolved")}
          >
            <SegmentedControl.Item value="open">Open</SegmentedControl.Item>
            <SegmentedControl.Item value="resolved">Resolved</SegmentedControl.Item>
          </SegmentedControl>
        }
      >
        {queue.isPending ? (
          <QueueSkeleton />
        ) : reports.length === 0 ? (
          <Empty>
            {includeResolved
              ? "No game report has been resolved yet."
              : "No open game reports. Nothing needs you right now."}
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                busy={busy}
                reason={reasonOf(`report-${report.id}`)}
                onReason={setReason(`report-${report.id}`)}
                onResolve={async (action) => {
                  const reason = reasonOf(`report-${report.id}`).trim();
                  await resolveReport.mutateAsync({
                    reportId: report.id,
                    action,
                    ...(action !== "dismiss" && reason ? { reason } : {}),
                  });
                }}
                onUnhide={async (version) => {
                  if (!report.projectId) return;
                  await unhide.mutateAsync({
                    projectId: report.projectId,
                    ...(version != null ? { version } : {}),
                  });
                }}
              />
            ))}
          </div>
        )}
      </AdminSection>

      <AdminSection
        title="Public review"
        count={queue.isPending ? undefined : reviews.length}
        hint="Games asking to go public for the first time. One approval per game; later releases follow without review."
      >
        {queue.isPending ? (
          <QueueSkeleton />
        ) : reviews.length === 0 ? (
          <Empty>No game is waiting to go public.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {reviews.map((review) => (
              <ReviewRow
                key={review.projectId}
                review={review}
                busy={busy}
                onApprove={async () => {
                  await approve.mutateAsync({ projectId: review.projectId });
                }}
              />
            ))}
          </div>
        )}
      </AdminSection>

      <AdminSection
        title="Scene versions"
        count={versions.isSuccess ? versions.data.length : undefined}
        hint="Live scene versions across hosted games: reported, blocked or hidden first."
        actions={
          <SegmentedControl
            size="sm"
            value={versionScope}
            onChange={(next) => setVersionScope(next as "active" | "all")}
          >
            <SegmentedControl.Item value="active">Active</SegmentedControl.Item>
            <SegmentedControl.Item value="all">With hidden</SegmentedControl.Item>
          </SegmentedControl>
        }
      >
        {versions.isPending ? (
          <QueueSkeleton />
        ) : versions.isError ? (
          <Empty>Scene versions couldn't load. Try again in a moment.</Empty>
        ) : versions.data.length === 0 ? (
          <Empty>
            {versionScope === "all"
              ? "No hosted game has published a scene version yet."
              : "No live scene version needs a look."}
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {versions.data.map((version) => {
              const key = `scene-${version.id}`;
              const ref = {
                projectId: version.projectId,
                scene: version.scene,
                number: version.number,
              };
              return (
                <SceneVersionRow
                  key={`${version.projectId}-${version.scene}-${version.number}`}
                  version={version}
                  busy={busy}
                  reason={reasonOf(key)}
                  onReason={setReason(key)}
                  onHide={async () => {
                    await hideVersion.mutateAsync({ ...ref, reason: reasonOf(key).trim() });
                    setReason(key)("");
                  }}
                  onUnhide={async () => {
                    await unhideVersion.mutateAsync({ ...ref, reason: reasonOf(key).trim() });
                    setReason(key)("");
                  }}
                />
              );
            })}
          </div>
        )}
      </AdminSection>

      <AdminSection
        title="Flagged release images"
        count={releaseFiles.isPending || blobs.isPending ? undefined : flags.length}
        hint="Images the scanner flagged in hosted games. Every release listing one is hidden until it's reviewed."
      >
        {releaseFiles.isPending || blobs.isPending ? (
          <QueueSkeleton />
        ) : flags.length === 0 ? (
          <Empty>No release image is waiting for review.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {flags.map((flag) => (
              <FlagRow
                key={flag.id}
                flag={flag}
                busy={busy}
                onDismiss={async () => {
                  await dismissFlag.mutateAsync(flag.id);
                }}
              />
            ))}
          </div>
        )}
      </AdminSection>
    </>
  );
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function GameLink({ projectId, title }: { projectId: string | null; title: string }) {
  if (!projectId) {
    return (
      <Text size="sm" className="font-medium">
        {title}
      </Text>
    );
  }
  return (
    <Link
      to="/games/$projectId"
      params={{ projectId }}
      className="text-sm font-medium text-primary hover:underline"
    >
      {title}
    </Link>
  );
}

function ReportRow({
  report,
  busy,
  reason,
  onReason,
  onResolve,
  onUnhide,
}: {
  report: GameReport;
  busy: boolean;
  reason: string;
  onReason: (next: string) => void;
  onResolve: (action: ReportAction) => Promise<void>;
  onUnhide: (version: number | null) => Promise<void>;
}) {
  const resolved = report.resolvedAt != null;
  const gone = report.projectId == null;
  const reasonField = (
    <ReasonField
      id={`game-report-reason-${report.id}`}
      value={reason}
      onChange={onReason}
      required
    />
  );

  return (
    <AdminRow muted={resolved}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="label">GAME</Badge>
          {report.version != null ? (
            <Badge size="label" variant="outline">
              V{report.version}
            </Badge>
          ) : null}
          {report.projectHiddenAt != null ? (
            <Badge size="label" variant="destructive">
              GAME HIDDEN
            </Badge>
          ) : report.releaseHiddenAt != null ? (
            <Badge size="label" variant="destructive">
              VERSION HIDDEN
            </Badge>
          ) : null}
          {report.resolution ? (
            <Badge size="label" variant="outline">
              {RESOLUTION_LABEL[report.resolution]}
            </Badge>
          ) : null}
          <Text size="xs" variant="muted">
            reported <TimeAgo date={report.createdAt} />
          </Text>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <GameLink projectId={report.projectId} title={report.title} />
          {gone ? (
            <Text size="xs" variant="muted">
              game deleted — title from the report snapshot
            </Text>
          ) : null}
        </div>

        <Text size="sm" className="max-w-prose italic">
          “{report.reason}”
        </Text>
        <AdminPerson
          user={report.reporter}
          name={report.reporter?.displayName ?? "Unknown"}
          size={20}
        />

        {resolved ? (
          <div className="flex flex-wrap items-center gap-2">
            <Text size="xs" variant="muted">
              Resolved <TimeAgo date={report.resolvedAt} />
            </Text>
            <UnhideButtons report={report} busy={busy} onUnhide={onUnhide} />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Confirm
              title="Dismiss this report?"
              message={
                gone
                  ? "The game is already gone — this just closes the report."
                  : "The game stays up and the report is marked resolved."
              }
              confirmText="Dismiss report"
              onConfirm={() => onResolve("dismiss")}
            >
              <Button variant="outline" size="xs" disabled={busy}>
                Dismiss
              </Button>
            </Confirm>
            {!gone && report.version != null && report.releaseHiddenAt == null && (
              <Confirm
                title={`Hide v${report.version}?`}
                message={
                  <>
                    Nobody can play this version until it's unhidden, and its publishers see why.
                    This resolves the report.
                    {reasonField}
                  </>
                }
                confirmText="Hide version"
                variant="destructive"
                confirmDisabled={!reason.trim()}
                onConfirm={() => onResolve("hide-release")}
              >
                <Button variant="destructive" size="xs" disabled={busy}>
                  Hide version
                </Button>
              </Confirm>
            )}
            {!gone && report.projectHiddenAt == null && (
              <Confirm
                title="Hide this game?"
                message={
                  <>
                    Every version stops playing and the game page disappears for everyone but its
                    publishers and staff, who see why. This resolves the report.
                    {reasonField}
                  </>
                }
                confirmText="Hide game"
                variant="destructive"
                confirmDisabled={!reason.trim()}
                onConfirm={() => onResolve("hide-project")}
              >
                <Button variant="destructive" size="xs" disabled={busy}>
                  Hide game
                </Button>
              </Confirm>
            )}
            <UnhideButtons report={report} busy={busy} onUnhide={onUnhide} />
          </div>
        )}
      </div>
    </AdminRow>
  );
}

function UnhideButtons({
  report,
  busy,
  onUnhide,
}: {
  report: GameReport;
  busy: boolean;
  onUnhide: (version: number | null) => Promise<void>;
}) {
  if (report.projectId == null) return null;
  if (report.projectHiddenAt != null) {
    return (
      <Confirm
        title="Unhide this game?"
        message="Its versions play again for their audiences. Versions hidden one by one stay hidden."
        confirmText="Unhide game"
        onConfirm={() => onUnhide(null)}
      >
        <Button variant="outline" size="xs" disabled={busy}>
          Unhide game
        </Button>
      </Confirm>
    );
  }
  if (report.version != null && report.releaseHiddenAt != null) {
    return (
      <Confirm
        title={`Unhide v${report.version}?`}
        message="The version plays again for the game's audience."
        confirmText="Unhide version"
        onConfirm={() => onUnhide(report.version)}
      >
        <Button variant="outline" size="xs" disabled={busy}>
          Unhide version
        </Button>
      </Confirm>
    );
  }
  return null;
}

function ReviewRow({
  review,
  busy,
  onApprove,
}: {
  review: ReviewRequest;
  busy: boolean;
  onApprove: () => Promise<void>;
}) {
  return (
    <AdminRow>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="label">FIRST PUBLIC</Badge>
          {review.hiddenAt != null ? (
            <Badge size="label" variant="destructive">
              GAME HIDDEN
            </Badge>
          ) : null}
          <Text size="xs" variant="muted">
            asked <TimeAgo date={review.requestedAt} />
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <GameLink projectId={review.projectId} title={review.name} />
          {review.teamName ? (
            <Text size="xs" variant="muted">
              by {review.teamName}
            </Text>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Confirm
            title="Approve this game going public?"
            message="It becomes public now, and every later release follows without another review."
            confirmText="Approve public"
            onConfirm={onApprove}
          >
            <Button size="xs" disabled={busy}>
              Approve public
            </Button>
          </Confirm>
        </div>
      </div>
    </AdminRow>
  );
}

function SceneVersionRow({
  version,
  busy,
  reason,
  onReason,
  onHide,
  onUnhide,
}: {
  version: SceneVersion;
  busy: boolean;
  reason: string;
  onReason: (next: string) => void;
  onHide: () => Promise<void>;
  onUnhide: () => Promise<void>;
}) {
  const name = sceneVersionName(version.scene, version.number);
  const { hidden, blocked, reports } = version;

  return (
    <AdminRow muted={hidden != null}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="label">SCENE</Badge>
          {version.pointers.length === 0 ? (
            <Badge size="label" variant="outline">
              NO CHANNEL
            </Badge>
          ) : (
            version.pointers.map((channel) => (
              <Badge key={channel} size="label" variant="outline">
                {CHANNEL_BADGE_LABEL[channel]}
              </Badge>
            ))
          )}
          {blocked != null ? (
            <Badge size="label" variant="destructive">
              BLOCKED
            </Badge>
          ) : null}
          {hidden != null ? (
            <Badge size="label" variant="destructive">
              HIDDEN
            </Badge>
          ) : null}
          <Text size="xs" variant="muted">
            published <TimeAgo date={version.createdAt} />
          </Text>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <GameLink projectId={version.projectId} title={version.projectName} />
          <Text size="sm" className="font-medium">
            {name}
          </Text>
          <SimpleTooltip content={`Compatibility key ${version.compatKey}`} maxWidth={320}>
            <Text size="xs" variant="muted" tabIndex={0}>
              compat {shortId(version.compatKey)}
            </Text>
          </SimpleTooltip>
        </div>

        <Text size="xs" variant="muted">
          Players' reports: {reports.ok} updated fine · {reports.failed} failed
        </Text>

        {blocked != null ? (
          <Text size="sm" className="max-w-prose">
            {BLOCKED_BY[blocked.by]} <TimeAgo date={blocked.at} />
            {blocked.reason ? <span className="italic">: “{blocked.reason}”</span> : null}
          </Text>
        ) : null}
        {hidden != null ? (
          <Text size="sm" className="max-w-prose">
            Hidden <TimeAgo date={hidden.at} />
            {hidden.reason ? <span className="italic">: “{hidden.reason}”</span> : null}
          </Text>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {hidden == null ? (
            <Confirm
              title={`Hide ${name}?`}
              message={
                <>
                  Its files stop being served at once, and every page running it reloads with the
                  release's own scene. Its publishers see why.
                  <ReasonField
                    id={`scene-version-reason-${version.id}`}
                    value={reason}
                    onChange={onReason}
                    required
                  />
                </>
              }
              confirmText="Hide scene version"
              variant="destructive"
              confirmDisabled={!reason.trim()}
              onConfirm={onHide}
            >
              <Button variant="destructive" size="xs" disabled={busy}>
                Hide
              </Button>
            </Confirm>
          ) : (
            <Confirm
              title={`Unhide ${name}?`}
              message={
                <>
                  Its files are served again, and a channel still pointing at it plays it from the
                  next load.
                  <ReasonField
                    id={`scene-version-reason-${version.id}`}
                    value={reason}
                    onChange={onReason}
                    required
                  />
                </>
              }
              confirmText="Unhide scene version"
              confirmDisabled={!reason.trim()}
              onConfirm={onUnhide}
            >
              <Button variant="outline" size="xs" disabled={busy}>
                Unhide
              </Button>
            </Confirm>
          )}
        </div>
      </div>
    </AdminRow>
  );
}

function FlagRow({
  flag,
  busy,
  onDismiss,
}: {
  flag: ImageFlag;
  busy: boolean;
  onDismiss: () => Promise<void>;
}) {
  return (
    <AdminRow>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="label" variant={flag.kind === "nsfw" ? "destructive" : "default"}>
            {flag.kind === "nsfw" ? "NSFW" : "FLAGGED"}
          </Badge>
          {flag.score != null ? (
            <Badge size="label" variant="outline">
              {Math.round(flag.score * 100)}%
            </Badge>
          ) : null}
          <Badge size="label" variant="destructive">
            RELEASES HIDDEN
          </Badge>
          <Text size="xs" variant="muted">
            {flag.ownerTypeLabel} · flagged <TimeAgo date={flag.createdAt} />
          </Text>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          {flag.imageUrl ? (
            // The staff route: the queue judges the stored pixels, which
            // the play frame no longer serves while the releases are hidden.
            <a href={flag.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
              <img
                src={flag.imageUrl}
                alt=""
                loading="lazy"
                className="h-24 w-36 rounded object-cover"
              />
            </a>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <GameLink projectId={flag.ownerId} title={flag.owner?.label ?? flag.ownerId} />
            <Text size="xs" variant="muted" className="truncate">
              {flag.objectKey}
            </Text>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Confirm
            title="Dismiss this flag?"
            message="Marks the detection as wrong and unhides every release it hid. The scanner won't flag this image for the same reason again."
            confirmText="Dismiss and unhide"
            onConfirm={onDismiss}
          >
            <Button variant="outline" size="xs" disabled={busy}>
              Dismiss
            </Button>
          </Confirm>
        </div>
      </div>
    </AdminRow>
  );
}
