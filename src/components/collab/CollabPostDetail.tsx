import {
  Cancel01Icon,
  Delete02Icon,
  Flag01Icon,
  LinkSquare01Icon,
  PencilEdit01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MediaCardImage } from "@/components/ui/media-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Heading, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import {
  draftFromPost,
  isEditablePostType,
  setCollabFilters,
  startWizardEdit,
} from "@/lib/collab-store";
import { formatRate } from "@/lib/format-rate";
import { formatCountdown, formatJamShortDates } from "@/lib/jam-countdown";
import { jamLinkParams } from "@/lib/jam-links";
import { profileLinkParams } from "@/lib/profile-links";
import { projectLinkParams, projectTypeLabel } from "@/lib/project-links";
import { teamLinkParams } from "@/lib/team-links";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

import { CollabPostResponseForm } from "./CollabPostResponseForm";
import { CollabPostResponseList } from "./CollabPostResponseList";

const TYPE_LABELS: Record<string, string> = {
  paid: "PAID WORK",
  hobby: "HOBBY",
  playtest: "PLAYTEST",
  mentor: "MENTORSHIP",
};

const COMP_TYPE_LABELS: Record<string, string> = {
  hourly: "Hourly",
  fixed: "Fixed",
  rev_share: "Revenue Share",
  negotiable: "Negotiable",
};

const CONTACT_TYPE_LABELS: Record<string, string> = {
  discord_dm: "Discord DM",
  discord_server: "Discord Server",
  email: "Email",
  other: "Other",
};

/**
 * Full detail view for one post — header, scrollable body, action
 * footer. Rendered inside the desktop inspector pane and inside the
 * mobile popover, so both surfaces stay identical by construction.
 */
export function CollabPostDetail({
  postId,
  currentUserId,
  onClose,
  onEdit,
  compact,
  showClose = true,
  frameless,
}: {
  postId: number;
  currentUserId: string | null;
  onClose: () => void;
  /** Opens the create flyout in edit mode. Omitted where no flyout is
   *  mounted, in which case the EDIT action simply doesn't render. */
  onEdit?: () => void;
  /** Sidebar width — stacks the detail grid and tightens the gutters. */
  compact?: boolean;
  /** The drawer turns this off: swiping down or tapping the scrim
   *  already closes it, so an × would be a third way to do one thing. */
  showClose?: boolean;
  /** Drops the panel's own frame — the drawer is already the surface,
   *  so a `Well` inside it would draw a second container. */
  frameless?: boolean;
}) {
  const queryClient = useQueryClient();
  const queryOptions = orpc.getPost.queryOptions({ input: { postId } });
  const { data: post, isLoading } = useQuery({ ...queryOptions, staleTime: 30 * 1000 });

  const closeMutation = useMutation({
    mutationFn: () => client.closePost({ postId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryOptions.queryKey }),
  });
  const reopenMutation = useMutation({
    mutationFn: () => client.reopenPost({ postId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryOptions.queryKey }),
  });
  const extendMutation = useMutation({
    mutationFn: () => client.extendPost({ postId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryOptions.queryKey }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => client.deletePost({ postId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["listPosts"] });
      onClose();
    },
  });

  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSuccess, setReportSuccess] = useState(false);
  const reportMutation = useMutation({
    mutationFn: () => client.reportPost({ postId, reason: reportReason }),
    onSuccess: () => {
      setReportSuccess(true);
      setShowReport(false);
      setReportReason("");
    },
  });

  const isOwner = post?.isOwner ?? (!!currentUserId && post?.authorId === currentUserId);
  // Owner-closed and sweep-expired are both "no longer taking responses";
  // the badge tells them apart, everything else treats them the same.
  const isExpired = post?.status === "expired";
  const isClosed = post?.status === "party_full" || isExpired;
  const closesIn = post && !isClosed && post.expiresAt ? formatCountdown(post.expiresAt) : null;

  // Posts created since v1 store the numbers and format here; the text
  // column is what pre-v1 rows still carry.
  const rateDisplay = post
    ? formatRate(post.compensationType, post.compensationMin, post.compensationMax) ||
      post.compensation ||
      ""
    : "";

  return (
    <DetailFrame frameless={frameless}>
      {/* Header */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 border-b border-muted/40 py-3",
          compact ? "px-4" : "px-5",
        )}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          {isLoading ? (
            <Skeleton className="h-[1.375rem] w-56" />
          ) : (
            <Heading as="h2" className="line-clamp-1 text-base tracking-widest uppercase">
              {post?.title ?? "POST NOT FOUND"}
            </Heading>
          )}
          <div className="flex flex-wrap gap-1">
            {/* Two pills, matching the type + status badges below. */}
            {isLoading ? (
              <>
                <Skeleton className="h-[18px] w-20" />
                <Skeleton className="h-[18px] w-14" />
              </>
            ) : null}
            {post?.type ? (
              <Badge variant="secondary" size="label" className="uppercase">
                {TYPE_LABELS[post.type] ?? post.type}
              </Badge>
            ) : null}
            {post?.featuredAt ? (
              <Badge variant="warning" size="label" className="uppercase">
                Featured
              </Badge>
            ) : null}
            {post ? (
              <Badge
                variant={isExpired ? "warning" : isClosed ? "destructive" : "success"}
                size="label"
                className="uppercase"
              >
                {isExpired ? "Expired" : isClosed ? "Closed" : "Open"}
              </Badge>
            ) : null}
            {closesIn && !closesIn.past ? (
              <Badge variant="outline" size="label" className="uppercase">
                Closes in {closesIn.text}
              </Badge>
            ) : null}
            {post?.isIndividual ? (
              <Badge variant="outline" size="label" className="uppercase">
                Solo dev
              </Badge>
            ) : null}
          </div>
        </div>
        {showClose ? (
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Close panel"
            title="Close panel"
            onClick={onClose}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </Button>
        ) : null}
      </div>

      {/* Body */}
      <div className={cn("min-h-0 flex-1 overflow-y-auto py-4", compact ? "px-4" : "px-5")}>
        {isLoading ? (
          <DetailSkeleton />
        ) : !post ? (
          <Text size="xs" variant="muted" className="tracking-widest uppercase">
            This post does not exist or has been deleted.
          </Text>
        ) : (
          <div className="flex flex-col gap-5">
            {post.images && post.images.length > 0 ? (
              /* First image as a letterboxed hero (post art is small and
                 roughly square — cropping it wide turns it to mush), the
                 rest as a thumb strip. */
              <div className="flex flex-col gap-2">
                <div className="relative h-40 w-full overflow-hidden border border-muted/40 bg-muted/20">
                  <MediaCardImage src={post.images[0].url} alt={post.images[0].alt ?? ""} />
                </div>
                {post.images.length > 1 ? (
                  <div className="flex flex-wrap gap-2">
                    {post.images.slice(1).map((img) => (
                      <img
                        key={img.id}
                        src={img.url}
                        alt={img.alt ?? ""}
                        className="h-16 w-16 border border-muted/40 object-cover"
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {post.team ? (
              <Link
                to="/teams/$teamId"
                params={teamLinkParams(post.team)}
                title="View the team's page"
                className="flex items-center gap-3 border border-muted/40 bg-muted/5 p-2.5 text-left transition-colors outline-none hover:bg-muted/15 focus-visible:ring-1 focus-visible:ring-ring"
              >
                <UserAvatar avatarUrl={post.team.avatarUrl} username={post.team.name} size={40} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Text as="span" size="xs" variant="muted" className="tracking-widest uppercase">
                    Posted by the team
                  </Text>
                  <Text as="span" size="sm" bold ellipsis>
                    {post.team.name}
                  </Text>
                </span>
              </Link>
            ) : null}

            {post.jam ? (
              // Two destinations, so two controls: the jam itself now has a
              // page, and "every post for this jam" is a filter on this
              // board. One overloaded button couldn't offer both (and a link
              // nested in a button isn't valid markup either).
              <div className="flex items-center gap-3 border border-warning/40 bg-warning/5 p-2.5">
                {post.jam.bannerUrl ? (
                  <img
                    src={post.jam.bannerUrl}
                    alt=""
                    loading="lazy"
                    className="h-10 w-16 shrink-0 border border-muted/40 object-cover"
                  />
                ) : null}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Text as="span" size="xs" className="tracking-widest text-warning uppercase">
                    For the jam
                  </Text>
                  <Link
                    to="/jams/$jamSlug"
                    params={jamLinkParams(post.jam)}
                    className="min-w-0 truncate text-xs font-bold hover:text-primary hover:underline"
                  >
                    {post.jam.title}
                  </Link>
                  <Text as="span" size="xs" variant="muted" className="tracking-widest">
                    {formatJamShortDates(post.jam.startsAt, post.jam.endsAt) ?? "DATES TBA"}
                  </Text>
                  <button
                    type="button"
                    onClick={() => setCollabFilters({ jamId: post.jam!.jamId })}
                    className="self-start font-mono text-[10px] tracking-widest text-primary uppercase outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    All posts for this jam →
                  </button>
                </div>
              </div>
            ) : null}

            {post.project ? (
              // Same two-destination shape as the jam panel: the project's
              // canonical page, and "every post for this project" as a
              // board filter.
              <div className="flex items-center gap-3 border border-primary/40 bg-primary/5 p-2.5">
                {post.project.imageUrl ? (
                  <img
                    src={post.project.imageUrl}
                    alt=""
                    loading="lazy"
                    className="h-10 w-16 shrink-0 border border-muted/40 object-cover"
                  />
                ) : null}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Text as="span" size="xs" className="tracking-widest text-primary uppercase">
                    Recruiting for
                  </Text>
                  <Link
                    to="/projects/$projectSlug"
                    params={projectLinkParams(post.project)}
                    className="min-w-0 truncate text-xs font-bold hover:text-primary hover:underline"
                  >
                    {post.project.title}
                  </Link>
                  <Text as="span" size="xs" variant="muted" className="tracking-widest uppercase">
                    {projectTypeLabel(post.project)}
                  </Text>
                  <button
                    type="button"
                    onClick={() => setCollabFilters({ projectId: post.project!.id })}
                    className="self-start font-mono text-[10px] tracking-widest text-primary uppercase outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    All posts for this project →
                  </button>
                </div>
              </div>
            ) : null}

            <Text size="sm" className="whitespace-pre-wrap text-foreground/90">
              {post.description}
            </Text>

            <DetailGrid>
              {post.projectName ? <DetailRow label="PROJECT" value={post.projectName} /> : null}
              {post.platforms && post.platforms.length > 0 ? (
                <DetailRow label="PLATFORMS" value={post.platforms.join(" · ")} />
              ) : null}
              {post.projectLength ? (
                <DetailRow label="TIMELINE" value={post.projectLength} />
              ) : null}
              {post.experienceLevel ? (
                <DetailRow label="EXPERIENCE" value={post.experienceLevel} />
              ) : null}
              {post.compensationType ? (
                <DetailRow
                  label="COMP"
                  value={COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType}
                />
              ) : null}
              {rateDisplay ? <DetailRow label="RATE" value={rateDisplay} /> : null}
              {post.contactType || post.contactMethod ? (
                <DetailRow
                  label="CONTACT"
                  value={
                    [
                      post.contactType
                        ? (CONTACT_TYPE_LABELS[post.contactType] ?? post.contactType)
                        : null,
                      post.contactMethod,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  }
                />
              ) : null}
            </DetailGrid>

            {post.skills.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Text size="xs" variant="muted" className="tracking-widest uppercase">
                    Tech stack
                  </Text>
                  {/* The viewer's own skills against this stack. Shown
                      only to signed-in non-owners — the author already
                      knows what they picked. */}
                  {post.viewerOverlap && post.viewerOverlap.matched.length > 0 ? (
                    <Text size="xs" variant="success" className="tracking-widest uppercase">
                      You match {post.viewerOverlap.matched.length}/{post.viewerOverlap.total}
                    </Text>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {post.skills.map((s) => {
                    const matched = post.viewerOverlap?.matched.includes(s.name) ?? false;
                    return (
                      <Badge
                        key={s.id}
                        variant="outline"
                        size="label"
                        className={cn("uppercase", matched && "border-success/50 text-success")}
                      >
                        {s.name}
                      </Badge>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setCollabFilters({ skillIds: post.skills.map((s) => s.id) })}
                  className="self-start text-xs tracking-widest text-primary uppercase hover:underline"
                >
                  Browse posts with this stack →
                </button>
              </div>
            ) : null}

            {post.roles && post.roles.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Text size="xs" variant="muted" className="tracking-widest uppercase">
                  Roles needed
                </Text>
                <div className="flex flex-wrap gap-1.5">
                  {post.roles.map((r) => (
                    <Badge key={r.id} variant="secondary" size="label" className="uppercase">
                      {r.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {post.portfolioUrl ? (
              <a
                href={post.portfolioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <HugeiconsIcon icon={LinkSquare01Icon} size={12} />
                Portfolio
              </a>
            ) : null}

            {/* Owner: responses + actions */}
            {isOwner && post.responses ? (
              <div className="flex flex-col gap-3 border-t border-muted/40 pt-4">
                <Text size="xs" variant="muted" className="tracking-widest uppercase">
                  Responses ({post.responses.length})
                </Text>
                {post.responses.length > 0 ? (
                  <CollabPostResponseList
                    responses={post.responses}
                    postId={postId}
                    team={post.team}
                    needsTeamLink={!post.isIndividual && !post.team}
                  />
                ) : (
                  <Text size="xs" variant="muted" className="tracking-widest uppercase">
                    No responses yet.
                  </Text>
                )}
              </div>
            ) : null}

            {/* Non-owner: respond */}
            {!isOwner && currentUserId && !isClosed ? (
              <div className="flex flex-col gap-3 border-t border-muted/40 pt-4">
                <Text size="xs" variant="muted" className="tracking-widest uppercase">
                  Respond
                </Text>
                <CollabPostResponseForm postId={postId} />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Footer actions. The skeleton keeps the bar so the panel doesn't
          grow a whole row taller the moment the post lands. */}
      {isLoading ? (
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-2 border-t border-muted/40 py-3",
            compact ? "px-4" : "px-5",
          )}
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-6" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-7 w-28" />
        </div>
      ) : null}

      {post ? (
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-muted/40 py-3",
            compact ? "px-4" : "px-5",
          )}
        >
          {post.author ? (
            <Link
              to="/profile/$userId"
              params={profileLinkParams(post.author)}
              className="group flex min-w-0 items-center gap-2"
            >
              <UserAvatar
                avatarUrl={post.author.avatarUrl}
                username={post.author.discordUsername}
                size={24}
              />
              <Text
                as="span"
                monospace
                size="sm"
                variant="muted"
                ellipsis
                className="tracking-widest uppercase group-hover:text-primary group-hover:underline"
              >
                @{post.author.discordUsername ?? "unknown"}
              </Text>
            </Link>
          ) : (
            <Text size="xs" variant="muted" className="tracking-widest uppercase">
              By @unknown
            </Text>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {isOwner ? (
              <>
                {/* Before this the only correction available was delete
                    and repost, which threw away every response. */}
                {onEdit && isEditablePostType(post.type) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      startWizardEdit(post.id, draftFromPost(post));
                      onEdit();
                    }}
                    title="Edit this post"
                    className="tracking-widest"
                  >
                    <HugeiconsIcon icon={PencilEdit01Icon} size={12} />
                    EDIT
                  </Button>
                ) : null}
                {/* Named after what it does to the post — a bare "CLOSE"
                    reads as dismissing the panel next to the header ×. */}
                {isClosed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reopenMutation.mutate()}
                    disabled={reopenMutation.isPending}
                    title="Reopen this post for applications"
                    className="tracking-widest"
                  >
                    <HugeiconsIcon icon={Tick01Icon} size={12} />
                    REOPEN POST
                  </Button>
                ) : closesIn ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => extendMutation.mutate()}
                    disabled={extendMutation.isPending}
                    title="Still looking — push the closing date out 30 days"
                    className="tracking-widest"
                  >
                    EXTEND
                  </Button>
                ) : null}
                {!isClosed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => closeMutation.mutate()}
                    disabled={closeMutation.isPending}
                    title="Mark this post as no longer recruiting"
                    className="tracking-widest"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={12} />
                    CLOSE RECRUITING
                  </Button>
                ) : null}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (
                      typeof window !== "undefined" &&
                      window.confirm("Delete this post permanently?")
                    ) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="tracking-widest"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={12} />
                  DELETE
                </Button>
              </>
            ) : currentUserId ? (
              <ReportInline
                showReport={showReport}
                setShowReport={setShowReport}
                reportReason={reportReason}
                setReportReason={setReportReason}
                reportSuccess={reportSuccess}
                onSubmit={() => reportMutation.mutate()}
                pending={reportMutation.isPending}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </DetailFrame>
  );
}

/**
 * The panel's own surface. Omitted in the drawer, which already draws
 * one — nesting a second frame inside it just adds an inner border.
 */
function DetailFrame({ frameless, children }: { frameless?: boolean; children: React.ReactNode }) {
  if (frameless) {
    return <div className="flex h-full min-h-0 flex-col overflow-hidden">{children}</div>;
  }
  return <Well className="flex h-full min-h-0 flex-col gap-0 overflow-hidden p-0">{children}</Well>;
}

/**
 * Placeholder that traces the loaded panel: hero, thumb strip, blurb,
 * then the spec sheet on the same dashed rhythm the real rows use, so
 * nothing shifts vertically when the data arrives.
 */
const SKELETON_ROWS = [
  ["w-16", "w-20"],
  ["w-20", "w-8"],
  ["w-12", "w-12"],
  ["w-20", "w-16"],
  ["w-24", "w-10"],
  ["w-12", "w-14"],
  ["w-12", "w-24"],
  ["w-20", "w-28"],
] as const;

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-16 w-16" />
      </div>

      <Skeleton className="h-5 w-3/4" />

      <div className="flex flex-col">
        {SKELETON_ROWS.map(([label, value], i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 border-b border-dashed border-muted/30 py-2 last:border-b-0"
          >
            <Skeleton className={cn("h-3", label)} />
            <Skeleton className={cn("h-3.5", value)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Post facts as a spec sheet — label left, value right, dashed rules
 * between rows. One column reads cleanly at both the inspector's width
 * and the popover's, so `compact` no longer reshapes it.
 */
function DetailGrid({ children }: { children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (items.length === 0) return null;
  return <div className="flex flex-col">{items}</div>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-muted/30 py-1.5 last:border-b-0">
      <Text as="span" size="xs" variant="muted" className="shrink-0 tracking-widest uppercase">
        {label}
      </Text>
      <Text as="span" size="sm" align="right" className="min-w-0 text-foreground/90">
        {value}
      </Text>
    </div>
  );
}

function ReportInline({
  showReport,
  setShowReport,
  reportReason,
  setReportReason,
  reportSuccess,
  onSubmit,
  pending,
}: {
  showReport: boolean;
  setShowReport: (b: boolean) => void;
  reportReason: string;
  setReportReason: (s: string) => void;
  reportSuccess: boolean;
  onSubmit: () => void;
  pending: boolean;
}) {
  if (reportSuccess) {
    return (
      <Text size="xs" variant="success" className="tracking-widest uppercase">
        Report submitted
      </Text>
    );
  }
  if (showReport) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="Reason"
          maxLength={500}
          className="rounded border border-muted/50 bg-background px-2 py-1 text-xs text-foreground placeholder-muted-foreground/40 outline-none focus:border-primary/50 dark:bg-emboss-surface"
        />
        <Button
          variant="destructive"
          size="sm"
          onClick={onSubmit}
          disabled={!reportReason.trim() || pending}
          className="tracking-widest"
        >
          REPORT
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setShowReport(false);
            setReportReason("");
          }}
          className="tracking-widest"
        >
          CANCEL
        </Button>
      </div>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setShowReport(true)}
      className="tracking-widest"
    >
      <HugeiconsIcon icon={Flag01Icon} size={12} />
      REPORT
    </Button>
  );
}
