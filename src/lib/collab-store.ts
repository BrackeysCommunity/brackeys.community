import { Store } from "@tanstack/store";

// The facet unions live in `@/lib/collab-vocabulary` next to their labels;
// re-exported here because this module is where consumers historically
// import them from.
import type {
  CollabPostType,
  CollabCompensationType,
  CollabExperienceLevel,
  CollabContactType,
  CollabProjectLength,
} from "@/lib/collab-vocabulary";
import { EVENTS } from "@/lib/event-taxonomy";
import { captureEvent } from "@/lib/product-insights";

export type {
  CollabPostType,
  CollabCompensationType,
  CollabExperienceLevel,
  CollabContactType,
  CollabProjectLength,
};
export type CollabLayout = "list" | "cards";
export type CollabStatus = "recruiting" | "party_full";
export type CollabSortBy = "createdAt" | "updatedAt";
export type CollabSortOrder = "asc" | "desc";

/**
 * A pending project image attached to the create-post wizard. Held in
 * memory while the wizard is open — uploaded to MinIO only when the
 * user actually submits the post, so abandoned drafts don't leave
 * orphaned bucket objects behind. The preview shown in the wizard
 * uses a local `URL.createObjectURL(file)` blob URL.
 */
export type UploadedImage = {
  /** The actual file the user picked. Bytes are uploaded at submit. */
  file: File;
  /** Stable id used as the React key — generated when the file is added. */
  localId: string;
  /** Cached `URL.createObjectURL(file)` so we don't recreate it on each render. */
  previewUrl: string;
  /** Optional alt text. */
  alt?: string;
};

export type WizardDraft = {
  type: CollabPostType | undefined;
  jamId: number | undefined;
  /** The named team behind a team post; undefined = unlinked. */
  teamId: string | undefined;
  /** The TEAM step's quick-create form. Only read when `teamId` is
   *  unset — the team row is created at submit time, like images, so
   *  abandoned drafts mint no junk teams. */
  newTeamName: string;
  newTeamDescription: string;
  newTeamImage: UploadedImage | null;
  /** The canonical project the post recruits for; undefined = unlinked.
   *  Picking one prefills `projectName` and friends — the free-text
   *  fields stay the source of truth for what the post displays. */
  projectId: string | undefined;
  title: string;
  description: string;
  projectName: string;
  compensationType: CollabCompensationType | undefined;
  compensationMin: number | undefined;
  compensationMax: number | undefined;
  projectLength: CollabProjectLength | undefined;
  platforms: string[];
  experienceLevel: CollabExperienceLevel | undefined;
  portfolioUrl: string;
  contactMethod: string;
  contactType: CollabContactType | undefined;
  isIndividual: boolean;
  roleIds: number[];
  skillIds: number[];
  images: UploadedImage[];
  /** Editing only: images already on the post, marked for removal. Applied
   *  with the pending uploads — by the POST step's own save or the final
   *  SAVE CHANGES — and dropped with them when the panel closes. */
  removedImageIds: number[];
};

/**
 * The board's ephemera — presentation and the create-post wizard. The
 * filters themselves live in the URL (`collab-filters.ts`), not here, so
 * a narrowed board is shareable.
 */
type CollabState = {
  /** How the feed renders — presentation, not a filter, so CLEAR ALL
   *  and filter resets never touch it. */
  layout: CollabLayout;
  wizard: {
    step: number;
    draft: WizardDraft;
    /** Set when the flyout is editing an existing post rather than
     *  creating one — submit routes to `updatePost` and the draft is
     *  seeded from the server instead of restored from storage. */
    editingPostId: number | null;
    /** The open draft came back from storage. Surfaced in the header so
     *  a form that refills itself says so. */
    draftRestored: boolean;
  };
};

const defaultDraft: WizardDraft = {
  type: undefined,
  jamId: undefined,
  teamId: undefined,
  newTeamName: "",
  newTeamDescription: "",
  newTeamImage: null,
  projectId: undefined,
  title: "",
  description: "",
  projectName: "",
  compensationType: undefined,
  compensationMin: undefined,
  compensationMax: undefined,
  projectLength: undefined,
  platforms: [],
  experienceLevel: undefined,
  portfolioUrl: "",
  contactMethod: "",
  contactType: undefined,
  isIndividual: false,
  roleIds: [],
  skillIds: [],
  images: [],
  removedImageIds: [],
};

export const collabStore = new Store<CollabState>({
  layout: "cards",
  wizard: {
    step: 0,
    draft: { ...defaultDraft },
    editingPostId: null,
    draftRestored: false,
  },
});

export function setCollabLayout(layout: CollabLayout) {
  collabStore.setState((s) => ({ ...s, layout }));
}

export function setWizardStep(step: number) {
  collabStore.setState((s) => ({
    ...s,
    wizard: { ...s.wizard, step },
  }));
}

export function updateWizardDraft(partial: Partial<WizardDraft>) {
  collabStore.setState((s) => {
    const draft = { ...s.wizard.draft, ...partial };
    return { ...s, wizard: { ...s.wizard, draft } };
  });
  // Only creation drafts are worth surviving a reload; an edit draft has
  // a live post behind it and is re-seeded from the server on open.
  if (collabStore.state.wizard.editingPostId === null) {
    persistWizardDraft(collabStore.state.wizard.draft);
  }
}

export function resetWizard() {
  collabStore.setState((s) => ({
    ...s,
    wizard: {
      step: 0,
      draft: { ...defaultDraft },
      editingPostId: null,
      draftRestored: false,
    },
  }));
  clearPersistedWizardDraft();
}

/**
 * Prepares the flyout for a new post: clears anything left over from an
 * edit, then refills from the last saved draft if there is one. Call it
 * from whatever opens the flyout — never during render, since it writes
 * to the store other mounted components are subscribed to.
 */
export function beginWizardCreate() {
  collabStore.setState((s) => ({
    ...s,
    wizard: {
      step: 0,
      draft: { ...defaultDraft },
      editingPostId: null,
      draftRestored: false,
    },
  }));
  captureEvent(EVENTS.collabPostFlowStarted, { mode: "create" });
  restorePersistedWizardDraft();
}

/** Opens the flyout against an existing post; `draft` comes from `getPost`. */
export function startWizardEdit(postId: number, draft: WizardDraft) {
  collabStore.setState((s) => ({
    ...s,
    wizard: {
      step: 0,
      draft,
      editingPostId: postId,
      draftRestored: false,
    },
  }));
  captureEvent(EVENTS.collabPostFlowStarted, { mode: "edit" });
}

/** A post as `getPost` returns it, in the fields an edit round-trips. */
export type EditableCollabPost = {
  type: string;
  jamId: number | null;
  teamId: string | null;
  projectId: string | null;
  title: string;
  description: string;
  projectName: string | null;
  compensationType: string | null;
  compensationMin: number | null;
  compensationMax: number | null;
  projectLength: string | null;
  platforms: string[] | null;
  experienceLevel: string | null;
  portfolioUrl: string | null;
  /** Optional because the public post payload no longer carries contact —
   *  see `draftFromPost`'s second argument. */
  contactMethod?: string | null;
  contactType?: string | null;
  isIndividual: boolean | null;
  roles: { id: number }[];
  skills: { id: number }[];
};

/**
 * Seeds the wizard from a saved post. This only became possible once
 * compensation was stored as numbers — the old `"$25 - $75 /hr"` display
 * string could not be parsed back into the sliders, which is why editing
 * a typo used to mean deleting the post and losing every response.
 *
 * The narrowing casts are safe by construction: the server only accepts
 * these enums, and anything older simply isn't offered an EDIT button.
 */
export function draftFromPost(
  post: EditableCollabPost,
  /**
   * Contact details, which no longer ride the post itself — that payload is
   * anonymous and edge-cached, so the page fetches them from
   * `getPostViewerState` and hands them back in here. Without this the edit
   * wizard would blank the author's own contact block on every save.
   */
  contact?: { contactType: string | null; contactMethod: string | null } | null,
): WizardDraft {
  const contactType = contact?.contactType ?? post.contactType ?? null;
  const contactMethod = contact?.contactMethod ?? post.contactMethod ?? null;

  return {
    type: post.type as CollabPostType,
    jamId: post.jamId ?? undefined,
    teamId: post.teamId ?? undefined,
    projectId: post.projectId ?? undefined,
    title: post.title,
    description: post.description,
    projectName: post.projectName ?? "",
    compensationType: (post.compensationType as CollabCompensationType | null) ?? undefined,
    compensationMin: post.compensationMin ?? undefined,
    compensationMax: post.compensationMax ?? undefined,
    projectLength: (post.projectLength as CollabProjectLength | null) ?? undefined,
    platforms: post.platforms ?? [],
    experienceLevel: (post.experienceLevel as CollabExperienceLevel | null) ?? undefined,
    portfolioUrl: post.portfolioUrl ?? "",
    contactMethod: contactMethod ?? "",
    contactType: (contactType as CollabContactType | null) ?? undefined,
    isIndividual: post.isIndividual ?? false,
    roleIds: post.roles.map((r) => r.id),
    skillIds: post.skills.map((s) => s.id),
    // Images already live on the post; the uploader shows them alongside
    // anything new, and both kinds of change wait for a save.
    images: [],
    removedImageIds: [],
    newTeamName: "",
    newTeamDescription: "",
    newTeamImage: null,
  };
}

/** Types the v1 wizard can round-trip. Legacy rows get no EDIT button. */
export function isEditablePostType(type: string): type is CollabPostType {
  return type === "paid" || type === "hobby";
}

// ── Draft persistence ──────────────────────────────────────────────────────

const DRAFT_STORAGE_KEY = "brackeys:collab-wizard-draft:v1";

/**
 * Everything in the draft except the picked images — `File` objects
 * don't serialise, and re-uploading bytes the browser no longer holds
 * isn't possible anyway, so images (and the team avatar) are the things
 * a restored draft asks the user to re-pick.
 */
type PersistedDraft = Omit<WizardDraft, "images" | "newTeamImage" | "removedImageIds">;

function persistWizardDraft(draft: WizardDraft) {
  if (typeof window === "undefined") return;
  const {
    images: _images,
    newTeamImage: _newTeamImage,
    removedImageIds: _removedImageIds,
    ...rest
  } = draft;
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(rest));
  } catch {
    // Private mode / quota — losing persistence is not worth an error.
  }
}

export function clearPersistedWizardDraft() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* empty */
  }
}

/** True when the stored draft holds anything the user actually typed. */
function isDraftMeaningful(draft: WizardDraft): boolean {
  return (
    draft.type !== undefined ||
    draft.title.trim() !== "" ||
    draft.description.trim() !== "" ||
    draft.projectName.trim() !== ""
  );
}

/**
 * Restores the last create-flow draft into the wizard. Reports back
 * through `wizard.draftRestored` so the flyout can say so — a form that
 * silently refills itself is more confusing than one that lost its
 * contents.
 */
function restorePersistedWizardDraft(): boolean {
  if (typeof window === "undefined") return false;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;

  let stored: Partial<PersistedDraft>;
  try {
    stored = JSON.parse(raw) as Partial<PersistedDraft>;
  } catch {
    clearPersistedWizardDraft();
    return false;
  }

  // Spread over the defaults rather than trusting the stored shape — a
  // draft written by an older build is missing whatever fields the
  // wizard has grown since.
  const draft: WizardDraft = {
    ...defaultDraft,
    ...stored,
    images: [],
    newTeamImage: null,
    removedImageIds: [],
  };
  if (!isDraftMeaningful(draft)) {
    clearPersistedWizardDraft();
    return false;
  }

  collabStore.setState((s) => ({
    ...s,
    wizard: {
      step: 0,
      draft,
      editingPostId: null,
      draftRestored: true,
    },
  }));
  return true;
}
