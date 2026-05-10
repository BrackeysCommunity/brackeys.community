import {
  Cancel01Icon,
  Delete02Icon,
  Flag01Icon,
  LinkSquare01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { useIsTouchDevice } from "@/hooks/use-touch-device";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

import { CollabPostResponseForm } from "./CollabPostResponseForm";
import { CollabPostResponseList } from "./CollabPostResponseList";

interface CollabPostPopoverProps {
  /** Numeric post id to show; popover is hidden when `null`. */
  postId: number | null;
  /** Currently signed-in user id, or null when anonymous. */
  currentUserId: string | null;
  onClose: () => void;
}

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
 * Detail popover for a single post — opens via shared `layoutId`
 * animation from a `CollabPostCard` and closes back into it. Mounts
 * inside a portal so the backdrop covers the whole viewport, but the
 * `motion` wrapper's `layoutId="collab-post-{id}"` matches the card so
 * framer-motion's layout engine handles the transition.
 */
export function CollabPostPopover({ postId, currentUserId, onClose }: CollabPostPopoverProps) {
  const isTouch = useIsTouchDevice();
  const isOpen = postId !== null;

  // Lock background scroll while the popover is open. Esc closes.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
          />
          <motion.div
            key="frame"
            layoutId={`collab-post-${postId}`}
            transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.6 }}
            className={cn(
              "fixed z-50 flex flex-col overflow-hidden",
              isTouch
                ? "inset-x-3 top-12 bottom-3"
                : "inset-1/2 max-h-[min(640px,calc(100vh-80px))] w-[min(720px,calc(100vw-80px))] -translate-x-1/2 -translate-y-1/2",
            )}
          >
            <PopoverBody postId={postId} currentUserId={currentUserId} onClose={onClose} />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function PopoverBody({
  postId,
  currentUserId,
  onClose,
}: {
  postId: number;
  currentUserId: string | null;
  onClose: () => void;
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
  const isClosed = post?.status === "party_full";

  // Parse playtest-feedback types from the catch-all `experience` field.
  let feedbackTypes: string[] = [];
  if (post?.type === "playtest" && post.experience) {
    try {
      const parsed: unknown = JSON.parse(post.experience);
      if (Array.isArray(parsed)) feedbackTypes = parsed.filter((x) => typeof x === "string");
    } catch {
      /* empty */
    }
  }

  return (
    <Well className="flex h-full min-h-0 flex-col gap-0 overflow-hidden p-0">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-muted/40 px-5 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading as="h2" monospace className="line-clamp-1 text-base tracking-widest uppercase">
            {post?.title ?? (isLoading ? "LOADING…" : "POST NOT FOUND")}
          </Heading>
          <div className="flex flex-wrap gap-1">
            {post?.type ? (
              <Badge
                variant="secondary"
                className="font-mono text-[10px] tracking-widest uppercase"
              >
                {TYPE_LABELS[post.type] ?? post.type}
              </Badge>
            ) : null}
            {post?.featuredAt ? (
              <Badge variant="warning" className="font-mono text-[10px] tracking-widest uppercase">
                Featured
              </Badge>
            ) : null}
            {post ? (
              <Badge
                variant={isClosed ? "destructive" : "success"}
                className="font-mono text-[10px] tracking-widest uppercase"
              >
                {isClosed ? "Closed" : "Open"}
              </Badge>
            ) : null}
            {post?.isIndividual ? (
              <Badge variant="outline" className="font-mono text-[10px] tracking-widest uppercase">
                Individual
              </Badge>
            ) : null}
          </div>
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Close"
          onClick={onClose}
          className="font-mono"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
            Loading post…
          </Text>
        ) : !post ? (
          <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
            This post does not exist or has been deleted.
          </Text>
        ) : (
          <div className="flex flex-col gap-5">
            {post.images && post.images.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {post.images.map((img) => (
                  <img
                    key={img.id}
                    src={img.url}
                    alt={img.alt ?? ""}
                    className="h-32 w-full border border-muted/40 object-cover"
                  />
                ))}
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
              {post.teamSize ? <DetailRow label="TEAM" value={post.teamSize} /> : null}
              {post.projectLength ? (
                <DetailRow
                  label={post.type === "playtest" ? "PLAY TIME" : "TIMELINE"}
                  value={post.projectLength}
                />
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
              {post.compensation ? <DetailRow label="RATE" value={post.compensation} /> : null}
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

            {feedbackTypes.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
                  // FEEDBACK
                </Text>
                <div className="flex flex-wrap gap-1.5">
                  {feedbackTypes.map((ft) => (
                    <Badge
                      key={ft}
                      variant="outline"
                      className="font-mono text-[10px] tracking-widest uppercase"
                    >
                      {ft}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {post.roles && post.roles.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
                  // ROLES NEEDED
                </Text>
                <div className="flex flex-wrap gap-1.5">
                  {post.roles.map((r) => (
                    <Badge
                      key={r.id}
                      variant="secondary"
                      className="font-mono text-[10px] tracking-widest uppercase"
                    >
                      {r.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {post.portfolioUrl && post.type !== "playtest" ? (
              <a
                href={post.portfolioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-xs text-primary hover:underline"
              >
                <HugeiconsIcon icon={LinkSquare01Icon} size={12} />
                Portfolio
              </a>
            ) : null}
            {post.portfolioUrl && post.type === "playtest" ? (
              <a
                href={post.portfolioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-xs text-primary hover:underline"
              >
                <HugeiconsIcon icon={LinkSquare01Icon} size={12} />
                Game / Demo
              </a>
            ) : null}

            {/* Owner: responses + actions */}
            {isOwner && post.responses ? (
              <div className="flex flex-col gap-3 border-t border-muted/40 pt-4">
                <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
                  // RESPONSES ({post.responses.length})
                </Text>
                {post.responses.length > 0 ? (
                  <CollabPostResponseList responses={post.responses} postId={postId} />
                ) : (
                  <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
                    No responses yet.
                  </Text>
                )}
              </div>
            ) : null}

            {/* Non-owner: respond */}
            {!isOwner && currentUserId && !isClosed ? (
              <div className="flex flex-col gap-3 border-t border-muted/40 pt-4">
                <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
                  // RESPOND
                </Text>
                <CollabPostResponseForm postId={postId} />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Footer actions */}
      {post ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-muted/40 px-5 py-3">
          <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
            By @{post.author?.discordUsername ?? "unknown"}
          </Text>
          <div className="flex flex-wrap items-center gap-2">
            {isOwner ? (
              <>
                {isClosed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reopenMutation.mutate()}
                    disabled={reopenMutation.isPending}
                    className="font-mono tracking-widest"
                  >
                    <HugeiconsIcon icon={Tick01Icon} size={12} />
                    REOPEN
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => closeMutation.mutate()}
                    disabled={closeMutation.isPending}
                    className="font-mono tracking-widest"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={12} />
                    CLOSE
                  </Button>
                )}
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
                  className="font-mono tracking-widest"
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
    </Well>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (items.length === 0) return null;
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2">{items}</div>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
        {label}
      </Text>
      <Text size="sm" className="text-foreground/90">
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
      <Text monospace size="xs" variant="success" className="tracking-widest uppercase">
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
          className="rounded border border-muted/50 bg-background px-2 py-1 font-mono text-xs text-foreground placeholder-muted-foreground/40 outline-none focus:border-primary/50 dark:bg-emboss-surface"
        />
        <Button
          variant="destructive"
          size="sm"
          onClick={onSubmit}
          disabled={!reportReason.trim() || pending}
          className="font-mono tracking-widest"
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
          className="font-mono tracking-widest"
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
      className="font-mono tracking-widest"
    >
      <HugeiconsIcon icon={Flag01Icon} size={12} />
      REPORT
    </Button>
  );
}
