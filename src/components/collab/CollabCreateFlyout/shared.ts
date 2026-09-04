import {
  BriefcaseIcon,
  GameController01Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";

import type {
  CollabCompensationType,
  CollabContactType,
  CollabExperienceLevel,
  CollabPostType,
  CollabProjectLength,
  UploadedImage,
} from "@/lib/collab-store";
import { COMPENSATION_VOCAB, CONTACT_VOCAB, EXPERIENCE_VOCAB } from "@/lib/collab-vocabulary";
import { DAY_MS } from "@/lib/format-time";
import { postImageForm } from "@/lib/image-upload";
import type { UploadedImageRecord } from "@/lib/image-upload";
import { hasProfanity } from "@/lib/profanity";

import type { ChoiceCardOption } from "./fields";

// ── Profanity ──────────────────────────────────────────────────────────────

/**
 * Form-validation shape over the shared matcher: message or undefined.
 *
 * Only for the fields that still hard-reject — the post title and a new
 * team's name, both of which become the subject line of a notification.
 * Prose is stored as written and censored at render (`useCensored`).
 */
export function profanityCheck(value: string, fieldName: string): string | undefined {
  if (hasProfanity(value)) {
    return `${fieldName} contains inappropriate language.`;
  }
  return undefined;
}

// ── Wizard step ids exposed to the user-facing 5-tab strip ─────────────────

export type WizardTabId = "basics" | "team" | "project" | "roles" | "review";

export interface WizardTabDef {
  id: WizardTabId;
  num: string;
  label: string;
  /** One-line intro rendered at the top of the step body. */
  desc: string;
}

/**
 * One strip for every post type. Picking a type used to silently swap
 * the wizard between a 4-step and a 3-step shape — and carry stale
 * values across the swap, since the two shapes shared columns that meant
 * different things in each. TEAM keeps the invariant: solo posts see it
 * too, reduced to the RECRUITING AS switch.
 */
export const WIZARD_TABS: WizardTabDef[] = [
  {
    id: "basics",
    num: "01",
    label: "POST",
    desc: "The pitch and the terms — what kind of post this is, the headline people scan on the board, the scope of the work, and how to reach you.",
  },
  {
    id: "team",
    num: "02",
    label: "TEAM",
    desc: "Just you, or a team with a page — people you accept get invited to its roster. Leave it blank and start the crew when you accept someone.",
  },
  {
    id: "project",
    num: "03",
    label: "PROJECT",
    desc: "Link the game's page and the post shows up on it, using its cover. Tag the jam and it reaches people watching that jam.",
  },
  {
    id: "roles",
    num: "04",
    label: "ROLES",
    desc: "Who you're looking for — the seats you're filling and the stack they'd work in, so the right people can filter their way to you.",
  },
  {
    id: "review",
    num: "05",
    label: "REVIEW",
    desc: "One last look at how it reads before it goes live.",
  },
];

// ── Constants ──────────────────────────────────────────────────────────────

export const POST_TYPES: ChoiceCardOption<CollabPostType>[] = [
  {
    value: "paid",
    label: "PAID WORK",
    desc: "Contract, freelance, paid commissions.",
    icon: BriefcaseIcon,
  },
  {
    value: "hobby",
    label: "HOBBY",
    desc: "Passion, jam crews, rev-share.",
    icon: GameController01Icon,
  },
];

/** RECRUITING AS — stored as the boolean `isIndividual`, so the card
 *  values are its two spellings. */
export const RECRUITING_AS_OPTIONS: ChoiceCardOption<"solo" | "team">[] = [
  {
    value: "solo",
    label: "SOLO DEV",
    desc: "It's just me looking for collaborators.",
    icon: UserIcon,
  },
  {
    value: "team",
    label: "A TEAM",
    desc: "I'm posting on behalf of a team.",
    icon: UserGroupIcon,
  },
];

export const PLATFORM_OPTIONS = [
  "PC",
  "Mac",
  "Linux",
  "Web",
  "iOS",
  "Android",
  "PS5",
  "Xbox",
  "Switch",
  "VR",
];

export const PROJECT_LENGTH_OPTIONS: { value: CollabProjectLength; label: string }[] = [
  { value: "<1 week", label: "< 1 wk" },
  { value: "1-4 weeks", label: "1-4 wks" },
  { value: "1-3 months", label: "1-3 mo" },
  { value: "3-6 months", label: "3-6 mo" },
  { value: "6+ months", label: "6+ mo" },
  { value: "ongoing", label: "Ongoing" },
];

export const EXPERIENCE_LEVEL_OPTIONS: { value: CollabExperienceLevel; label: string }[] =
  EXPERIENCE_VOCAB.map(({ value, label }) => ({ value, label }));

export const COMPENSATION_TYPE_OPTIONS: { value: CollabCompensationType; label: string }[] =
  COMPENSATION_VOCAB.map(({ value, labelShort }) => ({ value, label: labelShort }));

export const CONTACT_TYPE_OPTIONS: { value: CollabContactType; label: string }[] =
  CONTACT_VOCAB.map(({ value, labelShort }) => ({ value, label: labelShort }));

export const CONTACT_PLACEHOLDERS: Record<CollabContactType, string> = {
  discord_dm: "Your Discord username",
  discord_server: "discord.gg/your-server",
  email: "you@example.com",
  other: "How to reach you",
};

// ── Compensation slider config ─────────────────────────────────────────────

export type CompSliderConfig = {
  min: number;
  max: number;
  step: number;
  defaultMin: number;
  defaultMax: number;
};

export const COMP_SLIDER_CONFIG: Record<string, CompSliderConfig> = {
  hourly: { min: 5, max: 200, step: 5, defaultMin: 25, defaultMax: 75 },
  fixed: { min: 100, max: 25000, step: 100, defaultMin: 500, defaultMax: 5000 },
  rev_share: { min: 5, max: 100, step: 5, defaultMin: 10, defaultMax: 30 },
};

// ── MinIO upload ───────────────────────────────────────────────────────────

/**
 * Upload a single post image to MinIO via `/api/collab/post-image`
 * (author-only, post-scoped key). Called at submit time once the post
 * exists — see `CollabCreateForm`. While the wizard is open the file
 * lives in-memory as `UploadedImage.file` so abandoned drafts never
 * write to the bucket.
 */
export function uploadCollabPostImage(postId: number, file: File): Promise<UploadedImageRecord> {
  return postImageForm("/api/collab/post-image", file, { postId: String(postId) });
}

/**
 * Upload a team avatar or banner to `/api/team/avatar` (owner-only,
 * team-scoped key). Called at submit right after a TEAM-step
 * quick-create and from the team manage flyout — the wizard's file
 * lives in-memory as `UploadedImage.file` until then, same as post
 * images.
 */
export function uploadTeamAvatarImage(
  teamId: string,
  file: File,
  kind: "avatar" | "banner" = "avatar",
): Promise<UploadedImageRecord> {
  return postImageForm(
    "/api/team/avatar",
    file,
    { teamId, kind },
    `${kind === "banner" ? "Banner" : "Avatar"} upload failed.`,
  );
}

// ── Form values ────────────────────────────────────────────────────────────

export type WizardFormValues = {
  type: CollabPostType | undefined;
  jamId: number | undefined;
  teamId: string | undefined;
  newTeamName: string;
  newTeamDescription: string;
  newTeamImage: UploadedImage | null;
  projectId: string | undefined;
  title: string;
  description: string;
  isIndividual: boolean;
  projectName: string;
  platforms: string[];
  projectLength: CollabProjectLength | undefined;
  experienceLevel: CollabExperienceLevel | undefined;
  compensationType: CollabCompensationType | undefined;
  compensationMin: number | undefined;
  compensationMax: number | undefined;
  contactType: CollabContactType | undefined;
  contactMethod: string;
  portfolioUrl: string;
  roleIds: number[];
  skillIds: number[];
  images: UploadedImage[];
  removedImageIds: number[];
};

// ── Project-derived defaults ───────────────────────────────────────────────

/** A project as the picker needs it — one row of `listEditableProjects`. */
export interface PickableProject {
  id: string;
  title: string;
  type: string;
  classification: string | null;
  embedType: string | null;
  url: string | null;
  imageUrl: string | null;
  teamIds: string[];
}

/**
 * What picking a project fills in — the §8.3 payoff that makes the
 * linked path the lazy path. The project's title *is* the project name;
 * the URL and platforms only fill blanks, since a typed portfolio link
 * or platform list is the poster's own claim to keep.
 */
export function projectPrefillValues(
  project: PickableProject,
  current: Pick<WizardFormValues, "portfolioUrl" | "platforms">,
): Partial<WizardFormValues> {
  const next: Partial<WizardFormValues> = { projectName: project.title };
  if (!current.portfolioUrl.trim() && project.url) {
    next.portfolioUrl = project.url;
  }
  // `embedType: 'html'` is itch's browser-playable signal — the one
  // platform fact the canonical row can vouch for.
  if (current.platforms.length === 0 && project.embedType?.toLowerCase() === "html") {
    next.platforms = ["Web"];
  }
  return next;
}

// ── Jam-derived defaults ───────────────────────────────────────────────────

/**
 * A jam's run length as the closest timeline bucket, used to prefill
 * TIMELINE when a jam is picked. A 48-hour jam is not a "3-6 months"
 * project and the user shouldn't have to say so.
 */
export function projectLengthForJam(
  startsAt: string | Date | null | undefined,
  endsAt: string | Date | null | undefined,
): CollabProjectLength | undefined {
  if (!startsAt || !endsAt) return undefined;
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;

  const days = (end - start) / DAY_MS;
  if (days <= 7) return "<1 week";
  if (days <= 28) return "1-4 weeks";
  if (days <= 92) return "1-3 months";
  return "3-6 months";
}

// ── Step validation ────────────────────────────────────────────────────────

/** Server caps for the TEAM step's quick-create form (`teamContentShape`). */
export const TEAM_NAME_MAX = 100;
export const TEAM_DESCRIPTION_MAX = 200;

/**
 * The field-level gates the quick screen shows inline. Same rules as the
 * wizard's steps, keyed by field so each can render under its own control;
 * `getStepValidationError("quick", …)` reads them in order for the footer.
 */
export interface QuickFieldErrors {
  roles?: string;
  title?: string;
  description?: string;
  type?: string;
  compensation?: string;
}

export function getQuickFieldErrors(v: WizardFormValues): QuickFieldErrors {
  const errors: QuickFieldErrors = {};
  if (v.roleIds.length === 0) errors.roles = "Pick at least one role you're looking for.";
  if (!v.title.trim()) errors.title = "Please enter a title.";
  else if (v.title.trim().length < 10) errors.title = "Title must be at least 10 characters.";
  else errors.title = profanityCheck(v.title, "Title");
  if (!v.description.trim()) errors.description = "Please enter a description.";
  else if (v.description.trim().length < 30)
    errors.description = "Description must be at least 30 characters.";
  if (!v.type) errors.type = "Please select a post type.";
  if (v.type === "paid") {
    if (!v.compensationType) errors.compensation = "Please select a compensation type.";
    else if (v.compensationType !== "negotiable" && v.compensationMin === undefined)
      errors.compensation = "Please select a compensation range.";
  }
  for (const key of Object.keys(errors) as (keyof QuickFieldErrors)[]) {
    if (errors[key] === undefined) delete errors[key];
  }
  return errors;
}

/**
 * What blocks a step, or null. These are the submit requirements — the
 * server's `postContentShape` and nothing more — so the wizard, the quick
 * screen, and the pre-flight checklist all agree on what "done" means.
 * Platforms, timeline, experience, contact, and a project name are not
 * gates anywhere: they are post-publish upgrades.
 */
export function getStepValidationError(stepId: string, v: WizardFormValues): string | null {
  switch (stepId) {
    case "basics": {
      if (!v.type) return "Please select a post type.";
      if (!v.title.trim()) return "Please enter a title.";
      if (v.title.trim().length < 10) return "Title must be at least 10 characters.";
      if (!v.description.trim()) return "Please enter a description.";
      if (v.description.trim().length < 30) return "Description must be at least 30 characters.";
      if (v.type === "paid") {
        if (!v.compensationType) return "Please select a compensation type.";
        if (v.compensationType !== "negotiable" && v.compensationMin === undefined)
          return "Please select a compensation range.";
      }
      const titleCheck = profanityCheck(v.title, "Title");
      if (titleCheck) return titleCheck;
      break;
    }
    case "team": {
      // An unlinked team post is a normal state — the crew gets attached
      // when the poster accepts someone. Only a *typed* new-team name is
      // checked, since submit will mint it.
      if (v.isIndividual || v.teamId !== undefined) break;
      const name = v.newTeamName.trim();
      if (name.length === 0) break;
      if (name.length < 2) return "Team name must be at least 2 characters.";
      const teamNameCheck = profanityCheck(v.newTeamName, "Team name");
      if (teamNameCheck) return teamNameCheck;
      break;
    }
    // The project name is optional — the title carries the pitch — and a
    // linked project supplies it. Only a *typed* name too short for the
    // server is a gate.
    case "details": {
      if (v.projectId !== undefined) break;
      const name = v.projectName.trim();
      if (name.length > 0 && name.length < 3) return "Project name must be at least 3 characters.";
      break;
    }
    // Roles used to be a step you could walk straight through, which put
    // posts on the board that the board's own role filter couldn't find.
    case "roles":
      if (v.roleIds.length === 0) return "Please select at least one role.";
      break;
    case "quick": {
      const errors = getQuickFieldErrors(v);
      return (
        errors.roles ??
        errors.title ??
        errors.description ??
        errors.type ??
        errors.compensation ??
        null
      );
    }
    case "review": {
      // The last gate before submit, so it re-runs every requirement
      // rather than trusting that the user walked the steps in order.
      const basics = getStepValidationError("basics", v);
      if (basics) return basics;
      const team = getStepValidationError("team", v);
      if (team) return team;
      const details = getStepValidationError("details", v);
      if (details) return details;
      return getStepValidationError("roles", v);
    }
  }
  return null;
}

/**
 * The first step whose requirements aren't met, in wizard order — what
 * the REVIEW gate is actually complaining about. Null means the post can
 * submit. The tab id is the *visible* step (so `details` reports as
 * `project`), letting callers route straight to it.
 */
export function getFirstIncompleteStep(
  v: WizardFormValues,
): { tabId: WizardTabId; label: string; error: string } | null {
  const order: { stepId: string; tabId: WizardTabId }[] = [
    { stepId: "basics", tabId: "basics" },
    { stepId: "team", tabId: "team" },
    { stepId: "details", tabId: "project" },
    { stepId: "roles", tabId: "roles" },
  ];
  for (const { stepId, tabId } of order) {
    const error = getStepValidationError(stepId, v);
    if (error) {
      const tab = WIZARD_TABS.find((t) => t.id === tabId);
      return { tabId, label: tab?.label ?? tabId.toUpperCase(), error };
    }
  }
  return null;
}

/**
 * The pre-flight checklist, in the order it renders. Every row is a real
 * submit requirement, so "100%" and "the NEXT button works" mean the
 * same thing — the old list mixed in a phantom timezone field and let
 * roles auto-pass, then reported 86% on a perfectly valid post.
 */
export function getPreflightChecks(
  v: WizardFormValues,
): { label: string; ok: boolean; tabId: WizardTabId }[] {
  const checks: { label: string; ok: boolean; tabId: WizardTabId }[] = [
    { label: "Post type selected", ok: !!v.type, tabId: "basics" },
    {
      label: "Title is descriptive",
      ok: v.title.trim().length >= 10 && !profanityCheck(v.title, "Title"),
      tabId: "basics",
    },
    { label: "Description ≥ 30 chars", ok: v.description.trim().length >= 30, tabId: "basics" },
    {
      label: "Compensation set",
      ok:
        v.type !== "paid" ||
        (!!v.compensationType &&
          (v.compensationType === "negotiable" || v.compensationMin !== undefined)),
      tabId: "basics",
    },
    { label: "At least one role", ok: v.roleIds.length > 0, tabId: "roles" },
  ];
  // A typed new-team name or project name is a requirement the moment it
  // exists — the team gets minted at submit, the name has a server minimum
  // — and not a row at all before that.
  if (!v.isIndividual && v.teamId === undefined && v.newTeamName.trim().length > 0) {
    checks.splice(3, 0, {
      label: "Team name OK",
      ok: getStepValidationError("team", v) === null,
      tabId: "team",
    });
  }
  if (v.projectId === undefined && v.projectName.trim().length > 0) {
    checks.splice(checks.length - 1, 0, {
      label: "Project name OK",
      ok: getStepValidationError("details", v) === null,
      tabId: "project",
    });
  }
  return checks;
}

// ── Form context types ─────────────────────────────────────────────────────

// TanStack Form has a deeply parameterised generic surface; using `any`
// for the context keeps the wiring readable while we lean on the
// `WizardFormValues` shape for the actual values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFieldApi = {
  state: { value: any; meta: { errors: any[] } };
  handleChange: (v: any) => void;
  handleBlur: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFormStore = {
  values: WizardFormValues;
  isSubmitting: boolean;
  [k: string]: any;
};
