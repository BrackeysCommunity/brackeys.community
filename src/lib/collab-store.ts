import { Store } from "@tanstack/store";

/**
 * v1 ships paid + hobby only. Playtest and mentor are deferred, not
 * deleted — `collab_posts.type` is still free text server-side and every
 * type-keyed lookup here is a map, so both return as pure additions.
 */
export type CollabPostType = "paid" | "hobby";
export type CollabListingType = "posts" | "people";
export type CollabLayout = "list" | "cards";
export type CollabStatus = "recruiting" | "party_full";
export type CollabSortBy = "createdAt" | "updatedAt";
export type CollabSortOrder = "asc" | "desc";
export type CollabCompensationType = "hourly" | "fixed" | "rev_share" | "negotiable";
export type CollabExperienceLevel = "any" | "beginner" | "intermediate" | "experienced";
export type CollabContactType = "discord_dm" | "discord_server" | "email" | "other";
export type CollabTeamSize = "solo" | "2-3" | "4-6" | "7+";
export type CollabProjectLength =
  | "<1 week"
  | "1-4 weeks"
  | "1-3 months"
  | "3-6 months"
  | "6+ months"
  | "ongoing";

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

type CollabFilters = {
  type: CollabPostType | undefined;
  listingType: CollabListingType | undefined;
  roleIds: number[];
  /** Tech stack, shared vocabulary with `user.skills`. Filters posts on
   *  the projects lane and people on the people lane. */
  skillIds: number[];
  jamId: number | undefined;
  /** One team's posts — set from a team page's "see all" link. */
  teamId: string | undefined;
  status: CollabStatus | undefined;
  search: string;
  sortBy: CollabSortBy;
  sortOrder: CollabSortOrder;
  experienceLevel: CollabExperienceLevel | undefined;
  compensationType: CollabCompensationType | undefined;
  isIndividual: boolean | undefined;
  /** People lane only — what kind of work a dev is open to. */
  collabPreference: CollabPreference | undefined;
};

/** Profile-side counterpart to a post's type. "either" matches both. */
export type CollabPreference = "paid" | "hobby" | "either";

type CollabPagination = {
  limit: number;
  offset: number;
};

export type WizardDraft = {
  type: CollabPostType | undefined;
  jamId: number | undefined;
  /** The named team behind a team post; undefined = unlinked. */
  teamId: string | undefined;
  title: string;
  description: string;
  projectName: string;
  compensationType: CollabCompensationType | undefined;
  compensationMin: number | undefined;
  compensationMax: number | undefined;
  teamSize: CollabTeamSize | undefined;
  projectLength: CollabProjectLength | undefined;
  platforms: string[];
  experience: string;
  experienceLevel: CollabExperienceLevel | undefined;
  portfolioUrl: string;
  contactMethod: string;
  contactType: CollabContactType | undefined;
  isIndividual: boolean;
  roleIds: number[];
  skillIds: number[];
  images: UploadedImage[];
};

export type WizardStepDef = { id: string; num: string; label: string };

/**
 * One path, always. Playtest and mentor used to fork this into a 3-step
 * shape whose step 02 reused `projectLength` and `experience` to mean
 * entirely different things — the source of most of the wizard's
 * overloaded fields.
 */
export const WIZARD_STEPS: WizardStepDef[] = [
  { id: "basics", num: "01", label: "TYPE & BASICS" },
  { id: "details", num: "02", label: "PROJECT DETAILS" },
  { id: "roles", num: "03", label: "ROLES NEEDED" },
  { id: "review", num: "04", label: "REVIEW" },
];

export function getWizardSteps(): WizardStepDef[] {
  return WIZARD_STEPS;
}

type CollabState = {
  filters: CollabFilters;
  /** How the feed renders — presentation, not a filter, so CLEAR ALL
   *  and filter resets never touch it. */
  layout: CollabLayout;
  pagination: CollabPagination;
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

const defaultFilters: CollabFilters = {
  type: undefined,
  listingType: undefined,
  roleIds: [],
  skillIds: [],
  jamId: undefined,
  teamId: undefined,
  status: undefined,
  search: "",
  sortBy: "createdAt",
  sortOrder: "desc",
  experienceLevel: undefined,
  compensationType: undefined,
  isIndividual: undefined,
  collabPreference: undefined,
};

const defaultDraft: WizardDraft = {
  type: undefined,
  jamId: undefined,
  teamId: undefined,
  title: "",
  description: "",
  projectName: "",
  compensationType: undefined,
  compensationMin: undefined,
  compensationMax: undefined,
  teamSize: undefined,
  projectLength: undefined,
  platforms: [],
  experience: "",
  experienceLevel: undefined,
  portfolioUrl: "",
  contactMethod: "",
  contactType: undefined,
  isIndividual: false,
  roleIds: [],
  skillIds: [],
  images: [],
};

export const collabStore = new Store<CollabState>({
  filters: { ...defaultFilters },
  layout: "list",
  pagination: { limit: 20, offset: 0 },
  wizard: { step: 0, draft: { ...defaultDraft }, editingPostId: null, draftRestored: false },
});

export function setCollabLayout(layout: CollabLayout) {
  collabStore.setState((s) => ({ ...s, layout }));
}

export function setCollabFilters(partial: Partial<CollabFilters>) {
  collabStore.setState((s) => ({
    ...s,
    filters: { ...s.filters, ...partial },
    pagination: { ...s.pagination, offset: 0 },
  }));
}

/**
 * Clears every constraint but keeps the listing mode and sort order —
 * those are navigation and presentation, not things "CLEAR ALL" should
 * yank out from under the user.
 */
export function resetCollabFilters() {
  collabStore.setState((s) => ({
    ...s,
    filters: {
      ...defaultFilters,
      listingType: s.filters.listingType,
      sortBy: s.filters.sortBy,
      sortOrder: s.filters.sortOrder,
    },
    pagination: { ...s.pagination, offset: 0 },
  }));
}

/**
 * Maps the UI filter state onto the shape `listPosts` /
 * `countPostsByType` expect. The "any" experience sentinel is a UI
 * affordance meaning *no constraint* — passed through verbatim it would
 * match only posts whose stored level is literally "any", so it's
 * dropped here rather than at each call site.
 */
export function collabFilterInput(filters: CollabFilters) {
  return {
    type: filters.type,
    status: filters.status,
    search: filters.search || undefined,
    experienceLevel:
      filters.experienceLevel && filters.experienceLevel !== "any"
        ? filters.experienceLevel
        : undefined,
    compensationType: filters.compensationType,
    isIndividual: filters.isIndividual,
    roleIds: filters.roleIds.length > 0 ? filters.roleIds : undefined,
    skillIds: filters.skillIds.length > 0 ? filters.skillIds : undefined,
    jamId: filters.jamId,
    teamId: filters.teamId,
  };
}

/**
 * The people lane's own filter shape. Skills are the one constraint both
 * lanes share — "who knows Godot" and "which projects run on Godot" are
 * the same chips, resolved against the same vocabulary.
 */
export function collabPeopleFilterInput(filters: CollabFilters) {
  return {
    search: filters.search || undefined,
    skillIds: filters.skillIds.length > 0 ? filters.skillIds : undefined,
    collabPreference: filters.collabPreference,
  };
}

/** Returns the number of active filter constraints (excluding sort and
 *  the posts/people listing mode, which is navigation, not a filter). */
export function countActiveCollabFilters(filters: CollabFilters): number {
  if (filters.listingType === "people") {
    const people = collabPeopleFilterInput(filters);
    return [people.search, people.skillIds, people.collabPreference].filter(Boolean).length;
  }
  const input = collabFilterInput(filters);
  return [
    input.type,
    input.status,
    input.experienceLevel,
    input.compensationType,
    input.isIndividual !== undefined ? true : undefined,
    input.search,
    input.roleIds,
    input.skillIds,
    input.jamId,
    input.teamId,
  ].filter(Boolean).length;
}

export function setCollabPage(offset: number) {
  collabStore.setState((s) => ({
    ...s,
    pagination: { ...s.pagination, offset },
  }));
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
    // The step count no longer varies by type, but keep the clamp so a
    // step index can never outrun the strip.
    const step = Math.min(s.wizard.step, WIZARD_STEPS.length - 1);
    return { ...s, wizard: { ...s.wizard, step, draft } };
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
    wizard: { step: 0, draft: { ...defaultDraft }, editingPostId: null, draftRestored: false },
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
    wizard: { step: 0, draft: { ...defaultDraft }, editingPostId: null, draftRestored: false },
  }));
  restorePersistedWizardDraft();
}

/** Opens the flyout against an existing post; `draft` comes from `getPost`. */
export function startWizardEdit(postId: number, draft: WizardDraft) {
  collabStore.setState((s) => ({
    ...s,
    wizard: { step: 0, draft, editingPostId: postId, draftRestored: false },
  }));
}

/** A post as `getPost` returns it, in the fields an edit round-trips. */
export type EditableCollabPost = {
  type: string;
  jamId: number | null;
  teamId: string | null;
  title: string;
  description: string;
  projectName: string | null;
  compensationType: string | null;
  compensationMin: number | null;
  compensationMax: number | null;
  teamSize: string | null;
  projectLength: string | null;
  platforms: string[] | null;
  experience: string | null;
  experienceLevel: string | null;
  portfolioUrl: string | null;
  contactMethod: string | null;
  contactType: string | null;
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
export function draftFromPost(post: EditableCollabPost): WizardDraft {
  return {
    type: post.type as CollabPostType,
    jamId: post.jamId ?? undefined,
    teamId: post.teamId ?? undefined,
    title: post.title,
    description: post.description,
    projectName: post.projectName ?? "",
    compensationType: (post.compensationType as CollabCompensationType | null) ?? undefined,
    compensationMin: post.compensationMin ?? undefined,
    compensationMax: post.compensationMax ?? undefined,
    teamSize: (post.teamSize as CollabTeamSize | null) ?? undefined,
    projectLength: (post.projectLength as CollabProjectLength | null) ?? undefined,
    platforms: post.platforms ?? [],
    experience: post.experience ?? "",
    experienceLevel: (post.experienceLevel as CollabExperienceLevel | null) ?? undefined,
    portfolioUrl: post.portfolioUrl ?? "",
    contactMethod: post.contactMethod ?? "",
    contactType: (post.contactType as CollabContactType | null) ?? undefined,
    isIndividual: post.isIndividual ?? false,
    roleIds: post.roles.map((r) => r.id),
    skillIds: post.skills.map((s) => s.id),
    // Images already live on the post; the uploader only adds more.
    images: [],
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
 * isn't possible anyway, so images are the one thing a restored draft
 * asks the user to re-pick.
 */
type PersistedDraft = Omit<WizardDraft, "images">;

function persistWizardDraft(draft: WizardDraft) {
  if (typeof window === "undefined") return;
  const { images: _images, ...rest } = draft;
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
  const draft: WizardDraft = { ...defaultDraft, ...stored, images: [] };
  if (!isDraftMeaningful(draft)) {
    clearPersistedWizardDraft();
    return false;
  }

  collabStore.setState((s) => ({
    ...s,
    wizard: { step: 0, draft, editingPostId: null, draftRestored: true },
  }));
  return true;
}
