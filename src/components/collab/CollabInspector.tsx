import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Kbd } from "@/components/ui/kbd";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { type CollabPostType, setCollabFilters } from "@/lib/collab-store";
import { profileLinkParams } from "@/lib/profile-links";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import { CollabPostDetail } from "./CollabPostDetail";
import { useCollabOpenCounts } from "./use-collab-counts";

interface CollabInspectorProps {
  postId: number | null;
  currentUserId: string | null;
  /** Clears the selection, returning the pane to its idle state. */
  onClose: () => void;
  /** Sidebar width — single-column detail and tighter padding. */
  compact?: boolean;
}

/**
 * The detail sidebar. Holds the selected post, and when nothing is
 * selected it does real work instead of sitting empty — the board's
 * open counts and who's currently available.
 */
export function CollabInspector({ postId, currentUserId, onClose, compact }: CollabInspectorProps) {
  if (postId === null) return <InspectorIdle compact={compact} />;
  return (
    <CollabPostDetail
      postId={postId}
      currentUserId={currentUserId}
      onClose={onClose}
      compact={compact}
    />
  );
}

const TYPE_ROWS: { value: CollabPostType; label: string }[] = [
  { value: "paid", label: "PAID WORK" },
  { value: "hobby", label: "HOBBY" },
  { value: "playtest", label: "PLAYTEST" },
  { value: "mentor", label: "MENTORSHIP" },
];

/**
 * Idle pane, laid out as a stack of framed sections: a masthead with the
 * standing open-role count over a dot field, the per-type breakdown as
 * clickable gauge rows, the freshest available people, and a keyboard
 * hint pinned to the bottom. Every figure is a real number from the
 * database — nothing is modelled or extrapolated.
 */
function InspectorIdle({ compact }: { compact?: boolean }) {
  const { data: open } = useCollabOpenCounts();
  const { data: people } = useQuery({
    ...orpc.listAvailableUsers.queryOptions({
      input: { limit: 3, offset: 0, sortBy: "updatedAt", sortOrder: "desc" },
    }),
    staleTime: 60 * 1000,
  });

  const total = open?.all ?? 0;
  const pad = compact ? "px-4" : "px-6";

  return (
    <Well className="h-full min-h-0 gap-0 overflow-y-auto p-0">
      <div className="flex min-h-full flex-col">
        {/* Masthead — the one number that matters, over a graph-paper grid. */}
        <div className={cn("relative overflow-hidden border-b border-muted/40 py-6", pad)}>
          {/* Masked so the ruling fades out before the section edge —
              it frames the headline instead of ending on a hard line. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--color-muted-foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--color-muted-foreground) 1px, transparent 1px)",
              backgroundSize: "18px 18px",
              opacity: 0.1,
              maskImage: "linear-gradient(to bottom, #000 0%, transparent 85%)",
              WebkitMaskImage: "linear-gradient(to bottom, #000 0%, transparent 85%)",
            }}
          />
          <div className="relative flex flex-col gap-1.5">
            <Text size="xs" variant="muted" className="tracking-widest uppercase">
              board status
            </Text>
            <div className="flex items-baseline gap-2.5">
              <Text
                as="span"
                bold
                density="dense"
                className="text-5xl text-foreground tabular-nums"
              >
                {total}
              </Text>
              <Text as="span" size="xs" className="tracking-widest text-primary uppercase">
                {total === 1 ? "open role" : "open roles"}
              </Text>
            </div>
            <Text size="xs" variant="muted">
              Recruiting across the board right now.
            </Text>
          </div>
        </div>

        {/* Per-type breakdown as gauge rows — each is a shortcut that
            filters the board to that type's open posts. */}
        <div className={cn("flex flex-col gap-1 border-b border-muted/40 py-4", pad)}>
          {TYPE_ROWS.map((row) => {
            const n = open?.[row.value] ?? 0;
            const share = total > 0 ? n / total : 0;
            return (
              <button
                key={row.value}
                type="button"
                disabled={n === 0}
                onClick={() => setCollabFilters({ type: row.value, status: "recruiting" })}
                className="group flex flex-col gap-1 py-1.5 text-left transition-colors outline-none hover:text-primary focus-visible:text-primary disabled:pointer-events-none disabled:opacity-40"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <Text as="span" size="xs" className="tracking-widest uppercase">
                    {row.label}
                  </Text>
                  <Text as="span" bold size="sm" className="tabular-nums">
                    {n}
                  </Text>
                </span>
                <span aria-hidden className="h-0.5 w-full bg-muted/30">
                  <span
                    className="block h-full bg-primary/70 transition-[width] duration-300 group-hover:bg-primary"
                    style={{ width: `${Math.round(share * 100)}%` }}
                  />
                </span>
              </button>
            );
          })}
        </div>

        {people?.users?.length ? (
          <div className={cn("flex flex-col gap-3 py-4", pad)}>
            <Text
              size="xs"
              variant="muted"
              className="tracking-widest text-foreground/80 uppercase"
            >
              recently available
            </Text>
            <ul className="flex flex-col gap-2">
              {people.users.map((user) => (
                <li key={user.id}>
                  <Link
                    to="/profile/$userId"
                    params={profileLinkParams(user)}
                    className="group flex items-center gap-3 border border-muted/40 p-2.5 transition-colors hover:border-primary/50 hover:bg-muted/10"
                  >
                    <UserAvatar
                      avatarUrl={user.avatarUrl}
                      username={user.discordUsername}
                      size={32}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Text as="span" size="sm" bold className="truncate text-foreground">
                        {user.discordUsername ?? "Unknown"}
                      </Text>
                      {user.tagline ? (
                        <Text as="span" size="xs" variant="muted" className="truncate">
                          {user.tagline}
                        </Text>
                      ) : null}
                    </span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      size={14}
                      className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Pinned hint — how to drive this pane without the mouse. */}
        <div
          className={cn(
            "mt-auto flex items-center gap-1.5 border-t border-dashed border-muted/40 py-3",
            pad,
          )}
        >
          <Text size="xs" variant="muted" className="flex flex-wrap items-center gap-1.5">
            Pick a post, or walk the list with <Kbd>↑</Kbd> <Kbd>↓</Kbd>.
          </Text>
        </div>
      </div>
    </Well>
  );
}
