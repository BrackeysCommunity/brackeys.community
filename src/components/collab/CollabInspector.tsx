import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { GraphPaper } from "@/components/ui/graph-paper";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { type CollabPostType } from "@/lib/collab-store";
import { Censored } from "@/lib/hooks/use-censored";
import { profileLinkParams } from "@/lib/profile-links";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import { useCollabBoardSearch } from "./collab-filters";
import { CollabPostDetail } from "./CollabPostDetail";

interface CollabInspectorProps {
  postId: number | null;
  currentUserId: string | null;
  /** Clears the selection, returning the pane to its idle state. */
  onClose: () => void;
  /** Opens the create flyout in edit mode for the owner's own post. */
  onEdit?: () => void;
  /** Sidebar width — single-column detail and tighter padding. */
  compact?: boolean;
}

/**
 * The detail sidebar. Holds the selected post, and when nothing is
 * selected it does real work instead of sitting empty — what's open on
 * the board, what those posts are built in, and who's around.
 */
export function CollabInspector({
  postId,
  currentUserId,
  onClose,
  onEdit,
  compact,
}: CollabInspectorProps) {
  if (postId === null) return <InspectorIdle compact={compact} />;
  return (
    <CollabPostDetail
      postId={postId}
      currentUserId={currentUserId}
      onClose={onClose}
      onEdit={onEdit}
      compact={compact}
    />
  );
}

const TYPE_ROWS: { value: CollabPostType; label: string }[] = [
  { value: "paid", label: "PAID WORK" },
  { value: "hobby", label: "HOBBY" },
];

/**
 * Idle pane: a masthead with the standing open-role count, the per-type
 * split as clickable gauge rows, the stacks and seats those open posts
 * actually ask for, and the freshest available people. Every figure is a
 * real number from the database — nothing is modelled or extrapolated.
 *
 * Each figure is also a shortcut: clicking a type, a stack, or a role
 * filters the board to it, so the readout doubles as navigation.
 */
function InspectorIdle({ compact }: { compact?: boolean }) {
  const { search, setSearch } = useCollabBoardSearch();
  const { data: stats } = useQuery({
    ...orpc.getBoardStats.queryOptions({ input: {} }),
    staleTime: 60 * 1000,
  });
  const { data: people } = useQuery({
    ...orpc.listAvailableUsers.queryOptions({
      input: { limit: 2, offset: 0, sortBy: "updatedAt", sortOrder: "desc" },
    }),
    staleTime: 60 * 1000,
  });

  // Facet rows toggle rather than replace, so two clicks read as "either".
  const toggleFacet = (key: "skills" | "roles", id: number) => {
    const selected = search[key] ?? [];
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSearch({ [key]: next.length > 0 ? next : undefined });
  };

  const total = stats?.open.all ?? 0;
  const topSkills = stats?.topSkills ?? [];
  const topRoles = stats?.topRoles ?? [];
  const busiest = topSkills[0]?.count ?? 0;
  const pad = compact ? "px-4" : "px-6";

  return (
    <Well className="max-h-full gap-0 overflow-y-auto p-0">
      {/* Masthead — the one number that matters, over a graph-paper grid. */}
      <div className={cn("relative overflow-hidden border-b border-muted/40 py-5", pad)}>
        <GraphPaper />
        <div className="relative flex flex-col gap-1.5">
          <Text size="xs" variant="muted" className="tracking-widest uppercase">
            board status
          </Text>
          <div className="flex items-baseline gap-2.5">
            <Text as="span" bold density="dense" className="text-5xl text-foreground tabular-nums">
              {total}
            </Text>
            <Text as="span" size="xs" className="tracking-widest text-primary uppercase">
              {total === 1 ? "open role" : "open roles"}
            </Text>
          </div>
          {stats && stats.newThisWeek > 0 ? (
            <Text size="xs" variant="muted">
              {stats.newThisWeek} posted in the last 7 days.
            </Text>
          ) : (
            <Text size="xs" variant="muted">
              Recruiting across the board right now.
            </Text>
          )}
        </div>
      </div>

      {/* Per-type split as gauge rows — each filters the board to that
          type's open posts. */}
      <div className={cn("flex flex-col gap-1 border-b border-muted/40 py-3", pad)}>
        {TYPE_ROWS.map((row) => {
          const n = stats?.open[row.value] ?? 0;
          const share = total > 0 ? n / total : 0;
          return (
            <button
              key={row.value}
              type="button"
              disabled={n === 0}
              onClick={() => setSearch({ type: row.value, status: "recruiting" })}
              className="group flex flex-col gap-1 py-1 text-left transition-colors outline-none hover:text-primary focus-visible:text-primary disabled:pointer-events-none disabled:opacity-40"
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

      {topSkills.length > 0 ? (
        <div className={cn("flex flex-col gap-2 border-b border-muted/40 py-3", pad)}>
          <SectionLabel>what the board builds in</SectionLabel>
          {topSkills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => toggleFacet("skills", skill.id)}
              className="group flex items-center gap-2 py-0.5 text-left outline-none"
            >
              <Text
                as="span"
                size="xs"
                className="w-28 shrink-0 truncate tracking-widest uppercase transition-colors group-hover:text-primary group-focus-visible:text-primary"
              >
                {skill.name}
              </Text>
              {/* Bars are relative to the busiest stack, not to the whole
                  board — the question is which of these leads, and a
                  share-of-total scale flattens all of them. */}
              <span aria-hidden className="h-1 flex-1 bg-muted/30">
                <span
                  className="block h-full bg-primary/50 transition-[width,background-color] duration-300 group-hover:bg-primary"
                  style={{
                    width: `${busiest > 0 ? Math.round((skill.count / busiest) * 100) : 0}%`,
                  }}
                />
              </span>
              <Text as="span" size="xs" variant="muted" className="w-4 text-right tabular-nums">
                {skill.count}
              </Text>
            </button>
          ))}
        </div>
      ) : null}

      {topRoles.length > 0 ? (
        <div className={cn("flex flex-col gap-2 border-b border-muted/40 py-3", pad)}>
          <SectionLabel>seats being hired for</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {topRoles.map((role) => {
              const active = (search.roles ?? []).includes(role.id);
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => toggleFacet("roles", role.id)}
                  aria-pressed={active}
                  className="outline-none"
                >
                  <Badge
                    variant="outline"
                    size="label"
                    className={cn(
                      "gap-1.5 uppercase transition-colors hover:border-primary/50 hover:text-primary",
                      active && "border-primary text-primary",
                    )}
                  >
                    {role.name}
                    <span className="text-muted-foreground tabular-nums">{role.count}</span>
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {people?.users?.length ? (
        <div className={cn("flex flex-col gap-2 py-3", pad)}>
          <SectionLabel>recently available</SectionLabel>
          <ul className="flex flex-col gap-1.5">
            {people.users.map((user) => (
              <li key={user.id}>
                <Link
                  to="/profile/$userId"
                  params={profileLinkParams(user)}
                  className="group flex items-center gap-3 border border-muted/40 p-2 transition-colors hover:border-primary/50 hover:bg-muted/10"
                >
                  <UserAvatar
                    avatarUrl={user.avatarUrl}
                    username={user.discordUsername}
                    size={28}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Text as="span" size="sm" bold className="truncate text-foreground">
                      {user.discordUsername ?? "Unknown"}
                    </Text>
                    {user.tagline ? (
                      <Text as="span" size="xs" variant="muted" className="truncate">
                        <Censored>{user.tagline}</Censored>
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
    </Well>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" variant="muted" className="tracking-widest text-foreground/80 uppercase">
      {children}
    </Text>
  );
}
