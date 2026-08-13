import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { client, orpc } from "@/orpc/client";

type CommentReport = Awaited<ReturnType<typeof client.listCommentReports>>[number];
type PostReport = Awaited<ReturnType<typeof client.listReports>>[number];

type QueueRow =
  | {
      kind: "comment";
      key: string;
      createdAt: Date | null;
      resolvedAt: Date | null;
      reporterName: string | null;
      report: CommentReport;
    }
  | {
      kind: "post";
      key: string;
      createdAt: Date | null;
      resolvedAt: Date | null;
      reporterName: string | null;
      report: PostReport;
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
  const deletePostReport = useMutation({
    mutationFn: (reportId: number) => client.deleteReport({ reportId }),
    onSuccess: invalidate,
    onError,
  });

  const rows = useMemo<QueueRow[]>(() => {
    const fromComments = (commentReports.data ?? []).map((r) => ({
      kind: "comment" as const,
      key: `c-${r.id}`,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      reporterName: r.reporter?.name ?? null,
      report: r,
    }));
    const fromPosts = (postReports.data ?? []).map((r) => ({
      kind: "post" as const,
      key: `p-${r.id}`,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      reporterName: r.reporter?.displayName ?? null,
      report: r,
    }));
    // The toggle is a filter, not an expansion: the resolved view fetches
    // everything (the endpoints have no resolved-only mode) and drops the
    // open rows here, so a row never shows up under both.
    return [...fromComments, ...fromPosts]
      .filter((r) => (includeResolved ? r.resolvedAt != null : r.resolvedAt == null))
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }, [commentReports.data, postReports.data, includeResolved]);

  const loading = commentReports.isPending || postReports.isPending;
  const busy = resolveComment.isPending || resolvePost.isPending || deletePostReport.isPending;

  return (
    <AdminSection
      title="Report queue"
      count={loading ? undefined : rows.length}
      hint={
        includeResolved
          ? "Already handled — kept for the record."
          : "Post and comment reports, interleaved, newest first."
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
          {rows.map((row) => (
            <AdminRow key={row.key} muted={row.resolvedAt != null}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge size="label" variant={row.kind === "comment" ? "secondary" : "default"}>
                    {row.kind === "comment" ? "COMMENT" : "POST"}
                  </Badge>
                  {row.resolvedAt ? (
                    <Badge size="label" variant="outline">
                      RESOLVED
                    </Badge>
                  ) : null}
                  <Text size="xs" variant="muted">
                    reported {row.createdAt ? timeAgo(row.createdAt) : "—"}
                    {row.reporterName ? ` by ${row.reporterName}` : ""}
                  </Text>
                </div>

                <Text size="sm" className="max-w-prose italic">
                  “{row.report.reason}”
                </Text>

                {row.kind === "comment" ? (
                  <CommentTarget report={row.report} />
                ) : (
                  <PostTarget report={row.report} />
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
                              reportId: row.report.id,
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
                                id={`report-reason-${row.report.id}`}
                                value={reasons[row.report.id] ?? ""}
                                onChange={(next) =>
                                  setReasons((prev) => ({ ...prev, [row.report.id]: next }))
                                }
                              />
                            </>
                          }
                          confirmText="Remove comment"
                          variant="destructive"
                          onConfirm={async () => {
                            const reason = reasons[row.report.id]?.trim();
                            await resolveComment.mutateAsync({
                              reportId: row.report.id,
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
                              reportId: row.report.id,
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
                          message="The post stops accepting responses and its author is notified. This resolves the report."
                          confirmText="Close post"
                          variant="destructive"
                          onConfirm={async () => {
                            await resolvePost.mutateAsync({
                              reportId: row.report.id,
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
                            title="Delete this report?"
                            message="Hard-deletes the report row (for junk reports). The post is untouched."
                            confirmText="Delete report"
                            variant="destructive"
                            onConfirm={async () => {
                              await deletePostReport.mutateAsync(row.report.id);
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
          ))}
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
