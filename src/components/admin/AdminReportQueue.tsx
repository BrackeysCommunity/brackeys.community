import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  AdminEmpty,
  AdminRow,
  AdminSection,
  ReasonField,
  errText,
} from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { timeAgo } from "@/lib/format-time";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

type CommentReport = Awaited<ReturnType<typeof client.listCommentReports>>[number];
type PostReport = Awaited<ReturnType<typeof client.listReports>>[number];

/** One report, flattened to what the stacked reason list renders. */
type ReportEntry = {
  id: number;
  reason: string;
  createdAt: Date | null;
  reporterName: string | null;
};

/**
 * One row per *subject*, not per report. Three people reporting one post is
 * one decision — and since resolving any of them now resolves all three
 * (`resolveReportsForSubject`), three separate rows would have been three
 * buttons where two are already no-ops.
 */
type QueueGroup = {
  key: string;
  kind: "comment" | "post";
  /** Newest first; the head is what the action buttons act on. */
  entries: ReportEntry[];
  createdAt: Date | null;
  resolvedAt: Date | null;
  comment: CommentReport | null;
  post: PostReport | null;
};

/**
 * Open post + comment reports interleaved, newest first, each row linking
 * to the content in situ. The section that matters most on this page.
 */
export function AdminReportQueue({ isAdmin }: { isAdmin: boolean }) {
  const [scope, setScope] = useState<"open" | "resolved">("open");
  // Keyed by report so a reason typed in one dialog can't leak into the next.
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const queryClient = useQueryClient();

  const includeResolved = scope === "resolved";
  const commentReports = useQuery(
    orpc.listCommentReports.queryOptions({ input: { includeResolved } }),
  );
  const postReports = useQuery(orpc.listReports.queryOptions({ input: { includeResolved } }));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.listCommentReports.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.listReports.key() });
  };
  const onError = (err: unknown) => toast.error(errText(err));

  const resolveComment = useMutation({
    mutationFn: (input: {
      reportId: number;
      action: "dismiss" | "remove_comment";
      reason?: string;
    }) => client.resolveCommentReport(input),
    onSuccess: invalidate,
    onError,
  });
  const resolvePost = useMutation({
    mutationFn: (input: { reportId: number; action: "dismiss" | "close_post" }) =>
      client.resolvePostReport(input),
    onSuccess: invalidate,
    onError,
  });
  // Takes the whole group, like `reopen`: junk is junk however many times it
  // was filed, and leaving the siblings behind would put the row straight back.
  const deletePostReports = useMutation({
    mutationFn: (group: QueueGroup) =>
      Promise.all(group.entries.map((entry) => client.deleteReport({ reportId: entry.id }))),
    onSuccess: invalidate,
    onError,
  });
  // Reopens the whole group: a row that came back with two of its three
  // reports still closed would misreport what staff are looking at.
  const reopen = useMutation({
    mutationFn: (group: QueueGroup) =>
      Promise.all(
        group.entries.map((entry) => client.reopenReport({ reportId: entry.id, kind: group.kind })),
      ),
    onSuccess: (results) => {
      invalidate();
      const count = results.filter((r) => r.reopened).length;
      if (count > 0) {
        toast.success(
          count === 1 ? "Report is back in the queue." : `${count} reports are back in the queue.`,
        );
      } else {
        toast.warning(results[0]?.message ?? "Nothing to reopen.");
      }
    },
    onError,
  });

  const rows = useMemo<QueueGroup[]>(() => {
    // The toggle is a filter, not an expansion: the resolved view fetches
    // everything (the endpoints have no resolved-only mode) and drops the
    // open rows here, so a report never shows up under both.
    const inScope = <T extends { resolvedAt: Date | null }>(r: T) =>
      includeResolved ? r.resolvedAt != null : r.resolvedAt == null;

    const groups = new Map<string, QueueGroup>();
    const push = (key: string, seed: () => QueueGroup, entry: ReportEntry) => {
      const group = groups.get(key) ?? seed();
      group.entries.push(entry);
      groups.set(key, group);
    };

    for (const r of (commentReports.data ?? []).filter(inScope)) {
      push(
        `c-${r.commentId}`,
        () => ({
          key: `c-${r.commentId}`,
          kind: "comment",
          entries: [],
          createdAt: r.createdAt,
          resolvedAt: r.resolvedAt,
          comment: r,
          post: null,
        }),
        {
          id: r.id,
          reason: r.reason,
          createdAt: r.createdAt,
          reporterName: r.reporter?.name ?? null,
        },
      );
    }
    for (const r of (postReports.data ?? []).filter(inScope)) {
      push(
        `p-${r.postId}`,
        () => ({
          key: `p-${r.postId}`,
          kind: "post",
          entries: [],
          createdAt: r.createdAt,
          resolvedAt: r.resolvedAt,
          comment: null,
          post: r,
        }),
        {
          id: r.id,
          reason: r.reason,
          createdAt: r.createdAt,
          reporterName: r.reporter?.displayName ?? null,
        },
      );
    }

    for (const group of groups.values()) {
      group.entries.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      // The group is as old as its newest report — an incident sorts by when
      // it last drew a complaint, not when the first one landed.
      group.createdAt = group.entries[0]?.createdAt ?? group.createdAt;
    }
    return [...groups.values()].sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );
  }, [commentReports.data, postReports.data, includeResolved]);

  const loading = commentReports.isPending || postReports.isPending;
  const busy =
    resolveComment.isPending ||
    resolvePost.isPending ||
    deletePostReports.isPending ||
    reopen.isPending;

  return (
    <AdminSection
      title="Report queue"
      count={loading ? undefined : rows.length}
      hint={
        includeResolved
          ? "Already handled — kept for the record."
          : "One row per reported post or comment, newest first."
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
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <AdminEmpty>
          {includeResolved
            ? "Nothing has been resolved yet."
            : "The queue is empty. Nothing needs you right now."}
        </AdminEmpty>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            // Every action takes the newest report; the server resolves its
            // siblings in the same statement.
            const head = row.entries[0]!;
            return (
              <AdminRow key={row.key} muted={row.resolvedAt != null}>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge size="label" variant={row.kind === "comment" ? "secondary" : "default"}>
                      {row.kind === "comment" ? "COMMENT" : "POST"}
                    </Badge>
                    {row.entries.length > 1 ? (
                      <Badge size="label" variant="destructive">
                        {row.entries.length} REPORTS
                      </Badge>
                    ) : null}
                    {row.resolvedAt ? (
                      <Badge size="label" variant="outline">
                        RESOLVED
                      </Badge>
                    ) : null}
                    <Text size="xs" variant="muted">
                      {row.entries.length > 1 ? "last reported " : "reported "}
                      {head.createdAt ? timeAgo(head.createdAt) : "—"}
                      {row.entries.length === 1 && head.reporterName
                        ? ` by ${head.reporterName}`
                        : ""}
                    </Text>
                  </div>

                  <div className="flex flex-col gap-1">
                    {row.entries.map((entry) => (
                      <div key={entry.id} className="flex flex-col">
                        <Text size="sm" className="max-w-prose italic">
                          “{entry.reason}”
                        </Text>
                        {row.entries.length > 1 ? (
                          <Text size="xs" variant="muted">
                            {entry.reporterName ?? "Unknown"} ·{" "}
                            {entry.createdAt ? timeAgo(entry.createdAt) : "—"}
                          </Text>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  {row.kind === "comment" && row.comment ? (
                    <CommentTarget report={row.comment} />
                  ) : row.post ? (
                    <PostTarget report={row.post} />
                  ) : null}

                  {row.resolvedAt != null && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Confirm
                        title={
                          row.entries.length > 1
                            ? `Reopen these ${row.entries.length} reports?`
                            : "Reopen this report?"
                        }
                        message={
                          row.kind === "comment"
                            ? "The report goes back in the open queue for another look. A comment that was already removed stays removed."
                            : "The report goes back in the open queue for another look. A post that was already closed stays closed."
                        }
                        confirmText="Reopen"
                        onConfirm={async () => {
                          await reopen.mutateAsync(row);
                        }}
                      >
                        <Button variant="outline" size="xs" disabled={busy}>
                          Reopen
                        </Button>
                      </Confirm>
                    </div>
                  )}

                  {row.resolvedAt == null && (
                    <div className="flex flex-wrap items-center gap-2">
                      {row.kind === "comment" ? (
                        <>
                          <Confirm
                            title="Dismiss this report?"
                            message="The comment stays up and the report is marked resolved."
                            confirmText="Dismiss report"
                            onConfirm={async () => {
                              await resolveComment.mutateAsync({
                                reportId: head.id,
                                action: "dismiss",
                              });
                            }}
                          >
                            <Button variant="outline" size="xs" disabled={busy}>
                              Dismiss
                            </Button>
                          </Confirm>
                          <Confirm
                            title="Remove this comment?"
                            message={
                              <>
                                The comment is tombstoned for everyone and its author is notified.
                                This resolves the report.
                                <ReasonField
                                  id={`report-reason-${head.id}`}
                                  value={reasons[head.id] ?? ""}
                                  onChange={(next) =>
                                    setReasons((prev) => ({ ...prev, [head.id]: next }))
                                  }
                                />
                              </>
                            }
                            confirmText="Remove comment"
                            variant="destructive"
                            onConfirm={async () => {
                              const reason = reasons[head.id]?.trim();
                              await resolveComment.mutateAsync({
                                reportId: head.id,
                                action: "remove_comment",
                                ...(reason ? { reason } : {}),
                              });
                            }}
                          >
                            <Button variant="destructive" size="xs" disabled={busy}>
                              Remove comment
                            </Button>
                          </Confirm>
                        </>
                      ) : (
                        <>
                          <Confirm
                            title="Dismiss this report?"
                            message="The post stays open and the report is marked resolved."
                            confirmText="Dismiss report"
                            onConfirm={async () => {
                              await resolvePost.mutateAsync({
                                reportId: head.id,
                                action: "dismiss",
                              });
                            }}
                          >
                            <Button variant="outline" size="xs" disabled={busy}>
                              Dismiss
                            </Button>
                          </Confirm>
                          <Confirm
                            title="Close this post?"
                            message={
                              row.entries.length > 1
                                ? `The post stops accepting responses and its author is notified. This resolves all ${row.entries.length} reports on it.`
                                : "The post stops accepting responses and its author is notified. This resolves the report."
                            }
                            confirmText="Close post"
                            variant="destructive"
                            onConfirm={async () => {
                              await resolvePost.mutateAsync({
                                reportId: head.id,
                                action: "close_post",
                              });
                            }}
                          >
                            <Button variant="destructive" size="xs" disabled={busy}>
                              Close post
                            </Button>
                          </Confirm>
                          {isAdmin && (
                            <Confirm
                              title={
                                row.entries.length > 1
                                  ? `Delete these ${row.entries.length} reports?`
                                  : "Delete this report?"
                              }
                              message="Hard-deletes the report rows (for junk reports). The post is untouched."
                              confirmText="Delete report"
                              variant="destructive"
                              onConfirm={async () => {
                                await deletePostReports.mutateAsync(row);
                              }}
                            >
                              <Button variant="ghost" size="xs" disabled={busy}>
                                Delete report
                              </Button>
                            </Confirm>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </AdminRow>
            );
          })}
        </div>
      )}
    </AdminSection>
  );
}

function CommentTarget({ report }: { report: CommentReport }) {
  const author = report.commentAuthor;
  return (
    <div className="flex items-start gap-2 border-l-2 border-muted pl-3">
      <UserAvatar avatarUrl={author?.avatarUrl} username={author?.name} size={24} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <Text size="xs" variant="muted">
          {author?.name ?? "Deleted user"}
          {report.commentDeletedAt ? " · already removed" : ""}
        </Text>
        <Text size="sm" className="break-words">
          {report.commentContent ?? "(content unavailable)"}
        </Text>
        <ReportTargetLink report={report} />
      </div>
    </div>
  );
}

function ReportTargetLink({ report }: { report: CommentReport }) {
  if (report.subjectType === "collab_post" && report.subjectCollabPostId != null) {
    return (
      <Link
        to="/collab/$postId"
        params={{ postId: String(report.subjectCollabPostId) }}
        hash={`comment-${report.commentId}`}
        className="text-xs text-primary hover:underline"
      >
        View in place →
      </Link>
    );
  }
  if (report.subjectType === "profile" && report.subjectProfileUserId != null) {
    return (
      <Link
        to="/profile/$userId"
        params={{ userId: report.subjectProfileUserId }}
        hash={`comment-${report.commentId}`}
        className="text-xs text-primary hover:underline"
      >
        View in place →
      </Link>
    );
  }
  return null;
}

function PostTarget({ report }: { report: PostReport }) {
  return (
    <div className="flex items-start gap-2 border-l-2 border-muted pl-3">
      <UserAvatar
        avatarUrl={report.postAuthor?.avatarUrl}
        username={report.postAuthor?.displayName}
        size={24}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <Text size="xs" variant="muted">
          {report.postAuthor?.displayName ?? "Unknown"} · post is {report.postStatus}
        </Text>
        <Link
          to="/collab/$postId"
          params={{ postId: String(report.postId) }}
          className="text-sm text-primary hover:underline"
        >
          {report.postTitle}
        </Link>
      </div>
    </div>
  );
}
