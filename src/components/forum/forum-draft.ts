import type { ForumPostKind } from "@/db/schema";

/**
 * The composer's unsent text, kept in this browser so a reload, a sign-in
 * round trip or a detour through the Join Discord modal never loses it.
 * Images stay out: a `File` doesn't serialise.
 */
export type ForumDraft = {
  kind: ForumPostKind;
  title: string;
  body: string;
  tags: string[];
  category: string | null;
  teamId: string | null;
};

const STORAGE_KEY = "brackeys:forum-composer-draft:v1";

export const EMPTY_DRAFT: ForumDraft = {
  kind: "post",
  title: "",
  body: "",
  tags: [],
  category: null,
  teamId: null,
};

export function isDraftEmpty(draft: ForumDraft): boolean {
  return !draft.title.trim() && !draft.body.trim() && draft.tags.length === 0;
}

export function readForumDraft(): ForumDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<ForumDraft>;
    const draft: ForumDraft = {
      ...EMPTY_DRAFT,
      ...stored,
      tags: Array.isArray(stored.tags) ? stored.tags.filter((t) => typeof t === "string") : [],
    };
    return isDraftEmpty(draft) ? null : draft;
  } catch {
    return null;
  }
}

export function writeForumDraft(draft: ForumDraft) {
  if (typeof window === "undefined") return;
  try {
    if (isDraftEmpty(draft)) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Private mode or a full quota — the draft just doesn't persist.
  }
}

export function clearForumDraft() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* empty */
  }
}
