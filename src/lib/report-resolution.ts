import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { collabPostReports, commentReports } from "@/db/schema";
import { notify } from "@/lib/notifications";

export type ReportKind = "post" | "comment";

/** What the reporter is told: staff acted on the thing, or left it up. */
export type ReportOutcome = "actioned" | "no_action";

export type ResolvedReport = { id: number; reporterId: string };

/**
 * Resolve every open report on one subject, not just the row staff clicked.
 *
 * Two people reporting the same post used to leave two unrelated rows in the
 * queue: staff handled the first, the post moved out of `recruiting`, and the
 * second row's "Close post" became a silent no-op guarded on a status that
 * had already changed. One subject is one decision, so it resolves as one —
 * and every reporter hears the same answer.
 *
 * The update is a single statement, so siblings cannot be half-resolved. It
 * returns them so the caller can log each one against the report the
 * moderator actually acted on.
 */
export async function resolveReportsForSubject(params: {
  kind: ReportKind;
  /** `collab_posts.id` or `comments.id`. */
  subjectId: number;
  actorId: string;
}): Promise<ResolvedReport[]> {
  const set = { resolvedAt: new Date(), resolvedById: params.actorId };

  if (params.kind === "post") {
    return db
      .update(collabPostReports)
      .set(set)
      .where(
        and(eq(collabPostReports.postId, params.subjectId), isNull(collabPostReports.resolvedAt)),
      )
      .returning({ id: collabPostReports.id, reporterId: collabPostReports.reporterId });
  }

  return db
    .update(commentReports)
    .set(set)
    .where(and(eq(commentReports.commentId, params.subjectId), isNull(commentReports.resolvedAt)))
    .returning({ id: commentReports.id, reporterId: commentReports.reporterId });
}

/**
 * Tell the people who filed the reports what came of them.
 *
 * A report that vanishes into silence teaches people that reporting does
 * nothing, and the next thing they do is report in `#general` instead. The
 * copy says the outcome and stops there — no actor on the row (which
 * moderator acted is staff's business) and nothing about what happened to
 * the other account.
 *
 * Best-effort, like every other notify leg on a moderation path: an action
 * that already landed must not report failure because the notice didn't.
 */
export async function notifyReporters(params: {
  reports: ResolvedReport[];
  actorId: string;
  outcome: ReportOutcome;
  entityType: "collab_post" | "comment";
  entityId: number;
  subjectTitle: string;
  subjectUrl: string | null;
}): Promise<void> {
  // One notice per person, however many rows they filed.
  const reporterIds = new Set(params.reports.map((r) => r.reporterId));
  reporterIds.delete(params.actorId);

  for (const userId of reporterIds) {
    try {
      await notify({
        userId,
        type: "report_resolved",
        entityType: params.entityType,
        entityId: String(params.entityId),
        data: {
          outcome: params.outcome,
          subjectTitle: params.subjectTitle,
          subjectUrl: params.subjectUrl,
        },
      });
    } catch (err) {
      console.warn("[report-resolution] reporter notice failed", { userId, err });
    }
  }
}
