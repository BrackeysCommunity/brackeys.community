import {
  Cancel01Icon,
  Delete02Icon,
  Flag01Icon,
  LinkSquare01Icon,
  Login01Icon,
  StarIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { motion } from "framer-motion";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { authStore } from "@/lib/auth-store";
import { useMagnetic } from "@/lib/hooks/use-cursor";
import { NOTCH_SIZE, notchClip, notchClipInner } from "@/lib/notch";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

const springTransition = { type: "spring", stiffness: 1000, damping: 30, mass: 0.1 } as const;

const TYPE_BADGE_COLORS: Record<string, string> = {
  paid: "bg-green-500/10 border-green-500/30 text-green-500",
  hobby: "bg-blue-500/10 border-blue-500/30 text-blue-500",
  playtest: "bg-purple-500/10 border-purple-500/30 text-purple-500",
  mentor: "bg-brackeys-yellow/10 border-brackeys-yellow/30 text-brackeys-yellow",
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-muted/30 px-4 py-2">
      <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
        {children}
      </span>
    </div>
  );
}

function MagneticFooterButton({
  onClick,
  children,
  className,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { ref, position } = useMagnetic(0.25);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="flex-1"
    >
      <button type="button" onClick={onClick} disabled={disabled} className={className}>
        {children}
      </button>
    </motion.div>
  );
}

type PostData = {
  id: number;
  authorId: string;
  type: string;
  title: string;
  description: string;
  status: string;
  featuredAt: string | Date | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  contactMethod: string | null;
  contactType: string | null;
  compensationType: string | null;
  compensation: string | null;
  teamSize: string | null;
  experienceLevel: string | null;
  isIndividual: boolean | null;
  portfolioUrl: string | null;
  roles?: { id: number; name: string; category: string | null }[];
  images?: { id: number; url: string; alt: string | null }[];
  responseCount?: number;
  responses?:
    | {
        id: number;
        responderId: string;
        message: string;
        portfolioUrl: string | null;
        status: string;
        createdAt: string | Date | null;
        responderUsername: string | null;
        responderAvatar: string | null;
      }[]
    | null;
  isOwner?: boolean;
  author?: {
    avatarUrl: string | null;
    discordUsername: string | null;
    tagline: string | null;
    bio: string | null;
    skills: { id: number; name: string }[];
  } | null;
};

interface CollabPostSidebarProps {
  post: PostData | null;
  isLoading: boolean;
  postId: number;
}

function ResponseForm({ postId }: { postId: number }) {
  const [message, setMessage] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const queryClient = useQueryClient();

  const respondMutation = useMutation({
    mutationFn: () =>
      client.respondToPost({
        postId,
        message,
        portfolioUrl: portfolioUrl || undefined,
      }),
    onSuccess: async () => {
      setSuccess(true);
      setMessage("");
      setPortfolioUrl("");
      await queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
      });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (success) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="font-mono text-xs tracking-widest text-green-500 uppercase">Response sent!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Write your application message..."
        rows={4}
        maxLength={2000}
        className="w-full resize-none border border-muted/30 bg-muted/20 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 transition-colors outline-none focus:border-primary/50"
      />
      <input
        type="text"
        value={portfolioUrl}
        onChange={(e) => setPortfolioUrl(e.target.value)}
        placeholder="Portfolio URL (optional)"
        className="w-full border border-muted/30 bg-muted/20 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 transition-colors outline-none focus:border-primary/50"
      />
      {error && <p className="font-mono text-[10px] text-destructive">{error}</p>}
      <button
        type="button"
        onClick={() => respondMutation.mutate()}
        disabled={!message.trim() || respondMutation.isPending}
        className="w-full border border-primary/40 bg-primary/20 py-2 font-mono text-[10px] tracking-widest text-primary uppercase transition-colors hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-30"
      >
        {respondMutation.isPending ? "SENDING..." : "SEND RESPONSE"}
      </button>
    </div>
  );
}

function ResponseList({
  responses,
  postId,
}: {
  responses: NonNullable<PostData["responses"]>;
  postId: number;
}) {
  const queryClient = useQueryClient();

  const updateStatusMutation = useMutation({
    mutationFn: ({ responseId, status }: { responseId: number; status: "accepted" | "declined" }) =>
      client.updateResponseStatus({ responseId, status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
      });
    },
  });

  return (
    <div className="space-y-2">
      {responses.map((resp) => (
        <div key={resp.id} className="space-y-2 border border-muted/30 bg-muted/10 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {resp.responderAvatar ? (
                <img
                  src={resp.responderAvatar}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded-full border border-muted/30"
                />
              ) : (
                <div className="h-5 w-5 shrink-0 rounded-full border border-muted/30 bg-muted/30" />
              )}
              <span className="truncate font-mono text-[10px] text-foreground">
                {resp.responderUsername
                  ? `@${resp.responderUsername}`
                  : resp.responderId.slice(0, 8)}
              </span>
            </div>
            <span
              className={cn(
                "border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase",
                resp.status === "accepted"
                  ? "border-green-500/30 bg-green-500/10 text-green-500"
                  : resp.status === "declined"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-brackeys-yellow/30 bg-brackeys-yellow/10 text-brackeys-yellow",
              )}
            >
              {resp.status}
            </span>
          </div>
          <p className="font-mono text-[10px] whitespace-pre-wrap text-foreground">
            {resp.message}
          </p>
          {resp.portfolioUrl && (
            <a
              href={resp.portfolioUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
            >
              <HugeiconsIcon icon={LinkSquare01Icon} size={10} />
              Portfolio
            </a>
          )}
          {resp.status === "pending" && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() =>
                  updateStatusMutation.mutate({ responseId: resp.id, status: "accepted" })
                }
                className="flex-1 border border-green-500/30 bg-green-500/10 py-1 font-mono text-[10px] tracking-wider text-green-500 uppercase transition-colors hover:bg-green-500/20"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() =>
                  updateStatusMutation.mutate({ responseId: resp.id, status: "declined" })
                }
                className="flex-1 border border-destructive/30 bg-destructive/10 py-1 font-mono text-[10px] tracking-wider text-destructive uppercase transition-colors hover:bg-destructive/20"
              >
                Decline
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function CollabPostSidebar({ post, isLoading, postId }: CollabPostSidebarProps) {
  const { session, isPending: authPending } = useStore(authStore);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  const isOwner = post?.isOwner ?? false;
  const isAuthenticated = !!session?.user;

  const closeMutation = useMutation({
    mutationFn: () => client.closePost({ postId }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
      }),
  });

  const reopenMutation = useMutation({
    mutationFn: () => client.reopenPost({ postId }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => client.deletePost({ postId }),
    onSuccess: () => navigate({ to: "/collab" }),
  });

  const featureMutation = useMutation({
    mutationFn: (featured: boolean) => client.featurePost({ postId, featured }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
      }),
  });

  const reportMutation = useMutation({
    mutationFn: () => client.reportPost({ postId, reason: reportReason }),
    onSuccess: () => {
      setReportSuccess(true);
      setShowReport(false);
      setReportReason("");
    },
  });

  return (
    <div className="flex min-h-0 flex-1 p-6 selection:bg-primary selection:text-white">
      <div
        className="pointer-events-auto my-auto max-h-[min(800px,calc(100vh-120px))] min-h-0 min-w-0 flex-1 bg-muted/60"
        style={{ clipPath: notchClip, padding: "2px" }}
      >
        <div
          className="relative flex h-full flex-col bg-background/90 backdrop-blur-md"
          style={{ clipPath: notchClipInner }}
        >
          {/* Corner decorators */}
          <span className="pointer-events-none absolute top-0 left-0 z-10 h-2 w-2 border-t border-l border-brackeys-yellow/50" />
          <span className="pointer-events-none absolute right-0 bottom-0 z-10 h-2 w-2 border-r border-b border-brackeys-yellow/50" />
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 z-10 text-brackeys-yellow/40"
            width={NOTCH_SIZE + 2}
            height={NOTCH_SIZE + 2}
            viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
            fill="none"
          >
            <line
              x1="0"
              y1="1"
              x2={NOTCH_SIZE + 1}
              y2={NOTCH_SIZE + 2}
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 z-10 text-brackeys-yellow/40"
            width={NOTCH_SIZE + 2}
            height={NOTCH_SIZE + 2}
            viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
            fill="none"
          >
            <line
              x1={NOTCH_SIZE + 1}
              y1={NOTCH_SIZE + 1}
              x2="0"
              y2="0"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>

          {/* Header bar */}
          <div className="flex shrink-0 items-center justify-between border-b border-muted/60 bg-card/40 px-4 py-2.5">
            <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
              COLLAB // POST
            </span>
            {post && (
              <span
                className={cn(
                  "font-mono text-[10px] font-bold tracking-widest uppercase",
                  post.status === "party_full" ? "text-destructive" : "text-green-500",
                )}
              >
                {post.status === "party_full" ? "CLOSED" : "OPEN"}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <span className="animate-pulse font-mono text-xs tracking-widest text-muted-foreground uppercase">
                Loading post data...
              </span>
            </div>
          ) : !post ? (
            <div className="flex flex-1 items-center justify-center">
              <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
                Post not found
              </span>
            </div>
          ) : (
            <>
              <OverlayScrollbarsComponent
                element="div"
                className="min-h-0 flex-1"
                options={{
                  scrollbars: {
                    theme: "os-theme-dark",
                    autoHide: "scroll",
                    autoHideDelay: 800,
                  },
                }}
              >
                {/* Metadata */}
                <SectionHeader>Info</SectionHeader>
                <div className="space-y-2 border-b border-muted/30 px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <span
                      className={cn(
                        "border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase",
                        TYPE_BADGE_COLORS[post.type] ??
                          "border-muted/40 bg-muted/20 text-muted-foreground",
                      )}
                    >
                      {post.type}
                    </span>
                    {post.isIndividual && (
                      <span className="border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-primary uppercase">
                        INDIVIDUAL
                      </span>
                    )}
                    {post.featuredAt && (
                      <span className="border border-brackeys-yellow/30 bg-brackeys-yellow/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-brackeys-yellow uppercase">
                        FEATURED
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    By:{" "}
                    {post.author?.discordUsername ? `@${post.author.discordUsername}` : "Unknown"}
                  </p>
                  {post.createdAt && (
                    <p className="font-mono text-[10px] text-muted-foreground">
                      Posted: {new Date(post.createdAt).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {/* Contact */}
                {post.contactType || post.contactMethod ? (
                  <>
                    <SectionHeader>Contact</SectionHeader>
                    <div className="space-y-1 border-b border-muted/30 px-4 py-3">
                      {post.contactType && (
                        <p className="font-mono text-[10px] text-muted-foreground">
                          <span className="text-primary uppercase">
                            {post.contactType === "discord_dm"
                              ? "Discord DM"
                              : post.contactType === "discord_server"
                                ? "Discord Server"
                                : post.contactType === "email"
                                  ? "Email"
                                  : "Other"}
                          </span>
                        </p>
                      )}
                      {post.contactMethod && (
                        <p className="font-mono text-[10px] text-foreground">
                          {post.contactMethod}
                        </p>
                      )}
                    </div>
                  </>
                ) : null}

                {/* Portfolio link (non-playtest) */}
                {post.portfolioUrl && post.type !== "playtest" && (
                  <div className="border-b border-muted/30 px-4 py-2">
                    <a
                      href={post.portfolioUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
                    >
                      <HugeiconsIcon icon={LinkSquare01Icon} size={10} />
                      Portfolio
                    </a>
                  </div>
                )}

                {/* Roles */}
                {post.roles && post.roles.length > 0 && (
                  <>
                    <SectionHeader>Roles Needed</SectionHeader>
                    <div className="flex flex-wrap gap-1 border-b border-muted/30 px-4 py-3">
                      {post.roles.map((role) => (
                        <span
                          key={role.id}
                          className="border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-primary uppercase"
                        >
                          {role.name}
                        </span>
                      ))}
                    </div>
                  </>
                )}

                {/* Images */}
                {post.images && post.images.length > 0 && (
                  <>
                    <SectionHeader>Images</SectionHeader>
                    <div className="space-y-2 border-b border-muted/30 px-4 py-3">
                      {post.images.map((img) => (
                        <img
                          key={img.id}
                          src={img.url}
                          alt={img.alt ?? "Post image"}
                          className="h-32 w-full border border-muted/20 object-cover"
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Owner actions */}
                {isOwner && (
                  <>
                    <SectionHeader>Actions</SectionHeader>
                    <div className="space-y-2 border-b border-muted/30 px-4 py-3">
                      {post.status === "recruiting" ? (
                        <button
                          type="button"
                          onClick={() => closeMutation.mutate()}
                          disabled={closeMutation.isPending}
                          className="w-full border border-brackeys-yellow/30 bg-brackeys-yellow/10 py-1.5 font-mono text-[10px] tracking-widest text-brackeys-yellow uppercase transition-colors hover:bg-brackeys-yellow/20 disabled:opacity-30"
                        >
                          <HugeiconsIcon icon={Cancel01Icon} size={10} className="mr-1 inline" />
                          Close Post
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => reopenMutation.mutate()}
                          disabled={reopenMutation.isPending}
                          className="w-full border border-green-500/30 bg-green-500/10 py-1.5 font-mono text-[10px] tracking-widest text-green-500 uppercase transition-colors hover:bg-green-500/20 disabled:opacity-30"
                        >
                          <HugeiconsIcon icon={Tick01Icon} size={10} className="mr-1 inline" />
                          Reopen Post
                        </button>
                      )}
                      {confirmDelete ? (
                        <div className="space-y-1.5">
                          <p className="text-center font-mono text-[10px] tracking-widest text-destructive uppercase">
                            Delete this post?
                          </p>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => deleteMutation.mutate()}
                              disabled={deleteMutation.isPending}
                              className="flex-1 border border-destructive/40 bg-destructive/20 py-1.5 font-mono text-[10px] tracking-widest text-destructive uppercase transition-colors hover:bg-destructive/30 disabled:opacity-30"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(false)}
                              className="flex-1 border border-muted/40 py-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase transition-colors hover:border-muted"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                          disabled={deleteMutation.isPending}
                          className="w-full border border-destructive/30 bg-destructive/10 py-1.5 font-mono text-[10px] tracking-widest text-destructive uppercase transition-colors hover:bg-destructive/20 disabled:opacity-30"
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={10} className="mr-1 inline" />
                          Delete Post
                        </button>
                      )}
                    </div>
                  </>
                )}

                {/* Staff actions -- only visible if backend granted response access (owner or staff) */}
                {!isOwner && post.responses && (
                  <>
                    <SectionHeader>Staff</SectionHeader>
                    <div className="space-y-2 border-b border-muted/30 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => featureMutation.mutate(!post.featuredAt)}
                        disabled={featureMutation.isPending}
                        className="w-full border border-brackeys-yellow/30 bg-brackeys-yellow/10 py-1.5 font-mono text-[10px] tracking-widest text-brackeys-yellow uppercase transition-colors hover:bg-brackeys-yellow/20 disabled:opacity-30"
                      >
                        <HugeiconsIcon icon={StarIcon} size={10} className="mr-1 inline" />
                        {post.featuredAt ? "Unfeature" : "Feature"}
                      </button>
                      {confirmDelete ? (
                        <div className="space-y-1.5">
                          <p className="text-center font-mono text-[10px] tracking-widest text-destructive uppercase">
                            Delete this post?
                          </p>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => deleteMutation.mutate()}
                              disabled={deleteMutation.isPending}
                              className="flex-1 border border-destructive/40 bg-destructive/20 py-1.5 font-mono text-[10px] tracking-widest text-destructive uppercase transition-colors hover:bg-destructive/30 disabled:opacity-30"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(false)}
                              className="flex-1 border border-muted/40 py-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase transition-colors hover:border-muted"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                          disabled={deleteMutation.isPending}
                          className="w-full border border-destructive/30 bg-destructive/10 py-1.5 font-mono text-[10px] tracking-widest text-destructive uppercase transition-colors hover:bg-destructive/20 disabled:opacity-30"
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={10} className="mr-1 inline" />
                          Delete Post
                        </button>
                      )}
                    </div>
                  </>
                )}

                {/* Response section */}
                {isOwner && post.responses ? (
                  <>
                    <SectionHeader>Responses ({post.responses.length})</SectionHeader>
                    <div className="border-b border-muted/30 px-4 py-3">
                      {post.responses.length > 0 ? (
                        <ResponseList responses={post.responses} postId={postId} />
                      ) : (
                        <p className="py-4 text-center font-mono text-[10px] tracking-widest text-muted-foreground/50 uppercase">
                          No responses yet
                        </p>
                      )}
                    </div>
                  </>
                ) : isAuthenticated && !isOwner && post.status === "recruiting" ? (
                  <>
                    <SectionHeader>Apply</SectionHeader>
                    <ResponseForm postId={postId} />
                  </>
                ) : !isAuthenticated && !authPending ? (
                  <>
                    <SectionHeader>Respond</SectionHeader>
                    <div className="space-y-3 px-4 py-6 text-center">
                      <p className="font-mono text-xs text-muted-foreground">
                        Sign in to respond to this post
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void import("@/lib/auth-client").then(({ authClient }) =>
                            authClient.signIn.social({ provider: "discord" }),
                          );
                        }}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "gap-2 border-primary/60 font-mono text-[10px] font-bold tracking-widest text-primary uppercase hover:border-primary hover:bg-primary/10",
                        )}
                      >
                        <HugeiconsIcon icon={Login01Icon} size={13} />
                        Sign In
                      </button>
                    </div>
                  </>
                ) : null}

                {/* Report */}
                {isAuthenticated && !isOwner && (
                  <>
                    <SectionHeader>Report</SectionHeader>
                    <div className="space-y-2 px-4 py-3">
                      {reportSuccess ? (
                        <p className="py-2 text-center font-mono text-[10px] tracking-widest text-green-500 uppercase">
                          Report submitted
                        </p>
                      ) : showReport ? (
                        <>
                          <textarea
                            value={reportReason}
                            onChange={(e) => setReportReason(e.target.value)}
                            placeholder="Describe the issue..."
                            rows={3}
                            maxLength={1000}
                            className="w-full resize-none border border-muted/30 bg-muted/20 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 transition-colors outline-none focus:border-primary/50"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => reportMutation.mutate()}
                              disabled={!reportReason.trim() || reportMutation.isPending}
                              className="flex-1 border border-destructive/30 bg-destructive/10 py-1 font-mono text-[10px] tracking-wider text-destructive uppercase transition-colors hover:bg-destructive/20 disabled:opacity-30"
                            >
                              Submit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowReport(false);
                                setReportReason("");
                              }}
                              className="flex-1 border border-muted/30 py-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase transition-colors hover:border-muted/60"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowReport(true)}
                          className="w-full border border-dashed border-muted/40 py-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase transition-colors hover:border-destructive/50 hover:text-destructive"
                        >
                          <HugeiconsIcon icon={Flag01Icon} size={10} className="mr-1 inline" />
                          Report this post
                        </button>
                      )}
                    </div>
                  </>
                )}
              </OverlayScrollbarsComponent>

              {/* Footer */}
              <div className="flex shrink-0 gap-4 border-t border-muted/60 bg-card/30 px-6 py-4">
                <MagneticFooterButton
                  onClick={() => navigate({ to: "/collab" })}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "w-full justify-center border-muted/40 font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase hover:border-muted hover:bg-muted/10",
                  )}
                >
                  Back to Browse
                </MagneticFooterButton>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
