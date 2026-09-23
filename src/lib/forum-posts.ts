import type { ForumPostKind } from "@/db/schema";

/**
 * Forum rules shared by the router, the composer and the post page. Pure
 * and client-safe: the composer validates against the same limits the
 * server enforces.
 */

export const FORUM_POST_KINDS = ["post", "devlog", "question"] as const satisfies ForumPostKind[];

/** Title and body caps per kind. A `post` has no title at all. */
export const FORUM_LIMITS: Record<ForumPostKind, { title: number; body: number; images: number }> =
  {
    post: { title: 0, body: 1_000, images: 4 },
    question: { title: 140, body: 10_000, images: 4 },
    devlog: { title: 140, body: 40_000, images: 12 },
  };

export const FORUM_MAX_TAGS = 5;

/**
 * The category a kind lands in unless the author picks another. "Devlog"
 * is only a kind — there is no Devlogs category and no #devlog tag, so a
 * devlog is filed by what it's about like any other post.
 */
export const FORUM_DEFAULT_CATEGORY: Record<ForumPostKind, string> = {
  post: "show-and-tell",
  question: "help",
  devlog: "show-and-tell",
};

/** Tags that restate a post kind. Banned in the database; named here so the
 *  composer and the router can say why. */
export const FORUM_RESERVED_TAGS: Record<string, string> = {
  devlog: "Devlogs are a post kind — pick DEVLOG instead of tagging it.",
  devlogs: "Devlogs are a post kind — pick DEVLOG instead of tagging it.",
};

const SLUG_MAX_LENGTH = 60;

/** Title → URL tail. Empty for an untitled post, whose URL is the bare id. */
export function forumPostSlug(title: string | null | undefined): string {
  if (!title) return "";
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

/** The `$postId` path segment: `1234-some-slug`, or `1234` untitled. */
export function forumPostParam(post: { id: number; slug?: string | null }): string {
  return post.slug ? `${post.id}-${post.slug}` : String(post.id);
}

/** Leading id of a `$postId` segment, or null when there isn't one. */
export function parseForumPostParam(param: string): number | null {
  const match = /^(\d+)(?:-|$)/.exec(param);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** What a post is called in notifications and page titles. */
export function forumPostTitle(post: { title: string | null; excerpt: string | null }): string {
  if (post.title) return post.title;
  const excerpt = post.excerpt?.trim();
  if (!excerpt) return "a post";
  return excerpt.length > 60 ? `${excerpt.slice(0, 57).trimEnd()}…` : excerpt;
}

const TAG_SLUG = /^[a-z0-9-]{2,32}$/;

/**
 * Free text → tag slug (`#Pixel Art` → `pixel-art`), or null when nothing
 * valid is left. Mirrors the `forum_tags_slug_format` CHECK.
 */
export function normalizeTagSlug(input: string): string | null {
  const slug = input
    .trim()
    .replace(/^#+/, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return TAG_SLUG.test(slug) ? slug : null;
}

/** Route params for `to="/forum/$postId"`. */
export function forumPostLinkParams(post: { id: number; slug?: string | null }) {
  return { postId: forumPostParam(post) };
}

export const FORUM_KIND_LABEL: Record<ForumPostKind, string> = {
  post: "Post",
  devlog: "Devlog",
  question: "Question",
};

const WORDS_PER_MINUTE = 220;

/** Whole minutes, at least one — the post page's READ stat. */
export function forumReadMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
