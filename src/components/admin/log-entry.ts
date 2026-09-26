import { formatDate } from "@/lib/format-date";
import type { client } from "@/orpc/client";

export type LogPage = Awaited<ReturnType<typeof client.listModerationActions>>;
export type LogAction = LogPage["actions"][number];
export type LogRefs = LogPage["refs"];
export type LogPerson = LogRefs["people"][string];

/** The thing an action was taken against, as something a moderator can open. */
export type LogTarget =
  | { kind: "collab"; postId: string; hash?: string; label: string }
  | { kind: "forum"; postId: string; hash?: string; label: string }
  | { kind: "profile"; person: LogPerson; hash?: string; label: string }
  | { kind: "team"; team: { id: string; slug: string | null }; label: string }
  | { kind: "project"; slug: string; label: string }
  | { kind: "jam"; jam: { jamId: number; slug: string | null }; label: string }
  | { kind: "image"; href: string; label: string }
  /** Gone, or never had a page — named but not linked. */
  | { kind: "text"; label: string };

export type LogFact =
  | { label: string; value: string }
  | { label: string; from: string; to: string }
  | { label: string; person: LogPerson | null; fallback: string };

export type LogDetail = {
  target: LogTarget | null;
  facts: LogFact[];
  quote: { label: string; text: string } | null;
};

type Meta = Record<string, unknown>;

const FIELD_LABELS: Record<string, string> = {
  bio: "Bio",
  name: "Name",
  tagline: "Tagline",
  websiteUrl: "Website",
  itchUrl: "itch.io",
  githubUrl: "GitHub",
  twitterUrl: "Twitter",
  recruiting: "Recruiting",
  urlStub: "Handle",
  displayName: "Display name",
  title: "Title",
  description: "Description",
  url: "Link",
};

export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** One stored value as a moderator would read it. */
export function showValue(value: unknown): string {
  if (value == null || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.map(showValue).join(", ");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  return JSON.stringify(value);
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const obj = (value: unknown): Meta | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Meta) : null;

function when(value: unknown): string | null {
  const s = str(value);
  return s ? formatDate(s, { year: "numeric", month: "short", day: "numeric" }) : null;
}

function person(refs: LogRefs, label: string, id: unknown): LogFact[] {
  const userId = str(id);
  if (!userId) return [];
  return [{ label, person: refs.people[userId] ?? null, fallback: "Deleted member" }];
}

function value(label: string, v: unknown): LogFact[] {
  return v == null || v === "" ? [] : [{ label, value: showValue(v) }];
}

function change(label: string, from: unknown, to: unknown): LogFact[] {
  return [{ label, from: showValue(from), to: showValue(to) }];
}

/** Per-field before → after, for the edit actions that store `previous`. */
function fieldChanges(meta: Meta): LogFact[] {
  const previous = obj(meta.previous) ?? {};
  const next = obj(meta.next);
  const fields = Array.isArray(meta.fields) ? meta.fields.map(String) : Object.keys(previous);
  return fields.map((key) =>
    next
      ? { label: fieldLabel(key), from: showValue(previous[key]), to: showValue(next[key]) }
      : // Rows written before the new value was stored only know what was replaced.
        { label: `${fieldLabel(key)} was`, value: showValue(previous[key]) },
  );
}

function commentTarget(refs: LogRefs, commentId: unknown): LogTarget | null {
  const id = num(commentId);
  const comment = id == null ? undefined : refs.comments[id];
  if (!comment) return id == null ? null : { kind: "text", label: `Comment ${id} (deleted)` };
  const hash = `comment-${comment.id}`;
  if (comment.collabPostId != null) {
    return {
      kind: "collab",
      postId: String(comment.collabPostId),
      hash,
      label: `on “${comment.postTitle ?? "a collab post"}”`,
    };
  }
  if (comment.responsePostId != null) {
    return {
      kind: "collab",
      postId: String(comment.responsePostId),
      label: `in a private application on “${comment.postTitle ?? "a collab post"}”`,
    };
  }
  if (comment.forumPostId != null) {
    return {
      kind: "forum",
      postId: String(comment.forumPostId),
      hash,
      label: `on “${comment.postTitle ?? "a forum post"}”`,
    };
  }
  if (comment.profileUserId != null) {
    const owner = refs.people[comment.profileUserId];
    if (owner)
      return { kind: "profile", person: owner, hash, label: `on ${owner.displayName}’s wall` };
  }
  return { kind: "text", label: `Comment ${comment.id}` };
}

function commentQuote(refs: LogRefs, commentId: unknown, meta: Meta): LogDetail["quote"] {
  const id = num(commentId);
  const text = (id == null ? undefined : refs.comments[id]?.content) ?? str(meta.preview);
  return text ? { label: "Comment", text } : null;
}

function collabTarget(refs: LogRefs, postId: unknown, title: unknown): LogTarget | null {
  const id = num(postId);
  if (id == null) return null;
  const live = refs.collabPosts[id];
  const label = live ?? str(title) ?? `Collab post ${id}`;
  return live === undefined
    ? { kind: "text", label: `${label} (deleted)` }
    : { kind: "collab", postId: String(id), label };
}

function forumTarget(refs: LogRefs, postId: unknown, title: unknown): LogTarget | null {
  const id = num(postId);
  if (id == null) return null;
  const live = refs.forumPosts[id];
  const label = live ?? str(title) ?? `Forum post ${id}`;
  return live === undefined
    ? { kind: "text", label: `${label} (deleted)` }
    : { kind: "forum", postId: String(id), label };
}

function teamTarget(refs: LogRefs, teamId: unknown, meta: Meta): LogTarget | null {
  const id = str(teamId);
  if (!id) return null;
  const live = refs.teams[id];
  if (live) return { kind: "team", team: live, label: live.name };
  return { kind: "text", label: `${str(meta.teamName) ?? `Team ${id}`} (deleted)` };
}

function reportFacts(refs: LogRefs, meta: Meta): LogFact[] {
  const also = Array.isArray(meta.alsoResolved) ? meta.alsoResolved.length : 0;
  return [
    ...value("Report said", meta.reportReason),
    ...person(refs, "Reporter", meta.reporterId),
    ...(num(meta.resolvedVia) != null ? value("Resolved with report", meta.resolvedVia) : []),
    ...(also > 0 ? value("Also resolved", `${also} duplicate report${also === 1 ? "" : "s"}`) : []),
  ];
}

function proposalFacts(
  refs: LogRefs,
  row: LogAction,
): { target: LogTarget | null; facts: LogFact[] } {
  const meta = row.metadata;
  const proposal = refs.proposals[num(row.targetId) ?? -1];
  const targetType = proposal?.targetType ?? str(meta.targetType);
  const targetId = proposal?.targetId ?? str(meta.targetId);
  let target: LogTarget | null = null;
  if (targetType === "team") target = teamTarget(refs, targetId, meta);
  else if (targetType === "profile" && targetId && refs.people[targetId]) {
    const owner = refs.people[targetId];
    target = { kind: "profile", person: owner, label: `${owner.displayName}’s profile` };
  }

  const facts: LogFact[] = [...value("Proposed edit", proposal?.action ?? meta.action)];
  const payload = proposal?.payload ?? obj(meta.payload);
  const baseline =
    obj(meta.appliedPrevious) ?? proposal?.appliedPrevious ?? proposal?.snapshot ?? null;
  if (payload) {
    for (const [key, next] of Object.entries(payload)) {
      if (key === "teamId" || key === "userId" || key === "reason") continue;
      facts.push(
        baseline && key in baseline
          ? { label: fieldLabel(key), from: showValue(baseline[key]), to: showValue(next) }
          : { label: fieldLabel(key), value: showValue(next) },
      );
    }
  }
  return { target, facts };
}

/**
 * Everything a row's metadata can say, in the order a moderator asks it:
 * what was acted on (and a link to it), what changed, what was said.
 * Unknown actions fall through to an empty detail — the raw metadata is
 * still one click away in the row.
 */
export function describeLogEntry(row: LogAction, refs: LogRefs): LogDetail {
  const meta = row.metadata;
  const none: LogDetail = { target: null, facts: [], quote: null };

  switch (row.action) {
    case "user_banned":
      return {
        target: null,
        facts: [
          ...(meta.source === "discord_guild_ban"
            ? value("Source", "Banned from the Discord server")
            : value(
                "Length",
                num(meta.durationDays) ? `${num(meta.durationDays)} days` : "Permanent",
              )),
          ...value("Until", when(meta.bannedUntil)),
        ],
        quote: null,
      };
    case "user_unbanned":
      return {
        target: null,
        facts: value("Banned since", when(meta.bannedAt)),
        quote: str(meta.banReason)
          ? { label: "Original ban reason", text: str(meta.banReason)! }
          : null,
      };

    case "comment_removed":
    case "comment_restored": {
      const commentId = row.targetType === "comment" ? row.targetId : meta.commentId;
      return {
        target: commentTarget(refs, commentId),
        facts: [
          ...person(refs, "Originally removed by", meta.removedById),
          ...value("Removed on", when(meta.removedAt)),
          ...reportFacts(refs, meta),
        ],
        quote: commentQuote(refs, commentId, meta),
      };
    }
    case "comment_report_dismissed":
      return {
        target: commentTarget(refs, meta.commentId),
        facts: reportFacts(refs, meta),
        quote: commentQuote(refs, meta.commentId, meta),
      };

    case "post_closed":
    case "post_reopened":
    case "post_deleted":
    case "post_shared_to_discord":
    case "post_report_dismissed":
    case "post_report_deleted": {
      const postId = row.targetType === "collab_post" ? row.targetId : meta.postId;
      return {
        target: collabTarget(refs, postId, meta.title),
        facts: [
          ...(meta.cooldownCleared === true ? value("Author cooldown", "Cleared") : []),
          ...reportFacts(refs, meta),
        ],
        quote: null,
      };
    }

    case "report_reopened": {
      const kind = str(meta.kind);
      const target =
        kind === "comment"
          ? commentTarget(refs, meta.subjectId)
          : kind === "post"
            ? collabTarget(refs, meta.subjectId, null)
            : kind === "forum_post"
              ? forumTarget(refs, meta.subjectId, null)
              : teamTarget(refs, meta.subjectId, meta);
      return {
        target,
        facts: value("Report", `${kind ?? "report"} report ${row.targetId}`),
        quote: kind === "comment" ? commentQuote(refs, meta.subjectId, meta) : null,
      };
    }

    case "skill_request_approved":
      return {
        target: null,
        facts:
          meta.renamed === true
            ? change("Skill", meta.requestedName, meta.grantedName)
            : value("Skill", meta.grantedName ?? meta.requestedName),
        quote: null,
      };
    case "skill_request_rejected":
      return { target: null, facts: value("Requested skill", meta.requestedName), quote: null };

    case "jam_hero_pinned":
    case "jam_hero_unpinned": {
      const jamId = num(row.targetId);
      return {
        target:
          jamId == null
            ? null
            : {
                kind: "jam",
                jam: { jamId, slug: str(meta.jamSlug) },
                label: str(meta.jamTitle) ?? `Jam ${jamId}`,
              },
        facts: [],
        quote: null,
      };
    }

    case "vocabulary_created":
    case "vocabulary_deleted":
      return {
        target: null,
        facts: [
          ...value(row.targetType === "collab_role" ? "Collab role" : "Skill", meta.name),
          ...value("Category", meta.category),
        ],
        quote: null,
      };
    case "vocabulary_renamed":
      return {
        target: null,
        facts: [
          ...change("Name", meta.from, meta.to),
          ...(meta.fromCategory !== meta.toCategory
            ? change("Category", meta.fromCategory, meta.toCategory)
            : []),
        ],
        quote: null,
      };
    case "vocabulary_merged":
      return {
        target: null,
        facts: [
          ...change("Merged", meta.from, meta.to),
          ...value("Members moved", meta.members),
          ...value("Posts moved", meta.posts),
        ],
        quote: null,
      };

    case "team_updated":
    case "team_slug_updated":
    case "team_image_cleared":
    case "team_image_set":
    case "team_member_removed":
    case "team_member_added":
    case "team_member_invited":
    case "team_member_title_updated":
    case "team_ownership_transferred":
    case "team_project_updated":
    case "team_project_removed":
    case "team_hidden":
    case "team_unhidden":
    case "team_deleted":
    case "team_report_dismissed":
      return describeTeamAction(row, refs);

    case "project_unpublished":
    case "project_republished":
    case "project_deleted": {
      const slug = str(meta.projectSlug);
      const label = str(meta.projectTitle) ?? `Project ${row.targetId}`;
      return {
        target:
          slug && row.action !== "project_deleted"
            ? { kind: "project", slug, label }
            : { kind: "text", label },
        facts: [],
        quote: null,
      };
    }

    case "moderation_proposed":
    case "moderation_proposal_approved":
    case "moderation_proposal_rejected":
      return { ...proposalFacts(refs, row), quote: null };

    case "profile_updated":
      return {
        target: null,
        facts:
          "to" in meta
            ? change("Handle", obj(meta.previous)?.urlStub, meta.to)
            : fieldChanges(meta),
        quote: null,
      };

    case "entry_flag_confirmed":
    case "entry_flag_dismissed": {
      const jamId = num(meta.jamId);
      return {
        target:
          jamId == null
            ? null
            : {
                kind: "jam",
                jam: { jamId, slug: null },
                label: `${str(meta.gameTitle) ?? `Entry ${row.targetId}`} in ${str(meta.jamTitle) ?? "a jam"}`,
              },
        facts: [...value("Flag", meta.kind), ...value("Score", num(meta.score)?.toFixed(3))],
        quote: null,
      };
    }

    case "image_flag_confirmed":
    case "image_flag_dismissed":
    case "image_rescan_requested":
      return {
        target: row.targetId
          ? { kind: "image", href: `/staff-image/${row.targetId}`, label: "View the image" }
          : null,
        facts: [
          ...value("Flag", meta.kind),
          ...value("Score", num(meta.score)?.toFixed(3)),
          ...value(
            "Uploaded to",
            str(meta.ownerType) && `${str(meta.ownerType)} ${showValue(meta.ownerId)}`,
          ),
        ],
        quote: null,
      };

    case "forum_post_hidden":
    case "forum_post_unhidden":
    case "forum_post_pinned":
    case "forum_post_unpinned":
    case "forum_post_moved":
    case "forum_post_retagged":
    case "forum_post_deleted":
    case "forum_post_report_dismissed": {
      const postId = row.targetType === "forum_post" ? row.targetId : meta.postId;
      return {
        target: forumTarget(refs, postId, meta.title),
        facts: [
          ...(row.action === "forum_post_pinned" || row.action === "forum_post_unpinned"
            ? change("Pinned", meta.previous, meta.scope)
            : []),
          ...(row.action === "forum_post_moved" ? change("Category", meta.from, meta.to) : []),
          ...(row.action === "forum_post_retagged" ? change("Tags", meta.before, meta.after) : []),
          ...reportFacts(refs, meta),
        ],
        quote: null,
      };
    }
  }
  return none;
}

function describeTeamAction(row: LogAction, refs: LogRefs): LogDetail {
  const meta = row.metadata;
  const teamId = row.targetType === "team" ? row.targetId : (str(meta.teamId) ?? row.targetId);
  const target = teamTarget(refs, teamId, meta);
  const detail = (facts: LogFact[], quote: LogDetail["quote"] = null): LogDetail => ({
    target,
    facts,
    quote,
  });

  switch (row.action) {
    case "team_updated":
      return detail(fieldChanges(meta));
    case "team_slug_updated":
      return detail(change("Handle", meta.from, meta.to));
    case "team_image_cleared":
    case "team_image_set":
      return detail([
        ...value("Image", meta.kind),
        ...value("Previous file", meta.previousUrl ?? meta.previousKey),
      ]);
    case "team_member_removed":
      return detail([
        ...person(refs, "Removed", meta.removedUserId),
        ...value("Role", meta.role),
        ...value("Title", meta.title),
      ]);
    case "team_member_added":
      return detail([...person(refs, "Added", meta.addedUserId), ...value("Title", meta.title)]);
    case "team_member_invited":
      return detail(person(refs, "Invited", meta.inviteeId));
    case "team_member_title_updated":
      return detail(change("Title", meta.from, meta.to));
    case "team_ownership_transferred":
      return detail([...person(refs, "From", meta.from), ...person(refs, "To", meta.to)]);
    case "team_project_updated": {
      const previous = obj(meta.previous) ?? {};
      return detail([
        ...Object.entries(previous).map(([key, v]) => ({
          label: `${fieldLabel(key)} was`,
          value: showValue(v),
        })),
        ...(meta.coverCleared === true ? value("Cover", "Cleared") : []),
      ]);
    }
    case "team_project_removed":
      return detail(value("Showcase entry", meta.projectTitle));
    case "team_deleted": {
      const roster = Array.isArray(meta.roster) ? meta.roster.length : null;
      const reports = Array.isArray(meta.resolvedReportIds) ? meta.resolvedReportIds.length : 0;
      return detail([
        ...value("Roster at deletion", roster == null ? null : `${roster} members`),
        ...(reports > 0 ? value("Reports resolved", reports) : []),
      ]);
    }
    default:
      return detail(reportFacts(refs, meta));
  }
}
