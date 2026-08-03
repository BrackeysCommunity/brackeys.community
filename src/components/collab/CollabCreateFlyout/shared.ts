import { BriefcaseIcon, GameController01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";

import type {
  CollabCompensationType,
  CollabContactType,
  CollabExperienceLevel,
  CollabPostType,
  CollabProjectLength,
  CollabTeamSize,
  UploadedImage,
} from "@/lib/collab-store";

// ── Profanity ──────────────────────────────────────────────────────────────

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export function profanityCheck(value: string, fieldName: string): string | undefined {
  if (value && profanityMatcher.hasMatch(value)) {
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
    label: "BASICS",
    desc: "The pitch — what kind of post this is and the headline people scan on the board.",
  },
  {
    id: "team",
    num: "02",
    label: "TEAM",
    desc: "Who's behind the post — just you, or a team with a page people can join.",
  },
  {
    id: "project",
    num: "03",
    label: "PROJECT",
    desc: "The project itself — show it off, scope the work, and say how to reach you.",
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

export interface PostTypeOption {
  value: CollabPostType;
  label: string;
  desc: string;
  icon: IconSvgElement;
}

export const POST_TYPES: PostTypeOption[] = [
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

export const TEAM_SIZE_OPTIONS: { value: CollabTeamSize; label: string }[] = [
  { value: "solo", label: "Solo" },
  { value: "2-3", label: "2-3" },
  { value: "4-6", label: "4-6" },
  { value: "7+", label: "7+" },
];

export const PROJECT_LENGTH_OPTIONS: { value: CollabProjectLength; label: string }[] = [
  { value: "<1 week", label: "< 1 wk" },
  { value: "1-4 weeks", label: "1-4 wks" },
  { value: "1-3 months", label: "1-3 mo" },
  { value: "3-6 months", label: "3-6 mo" },
  { value: "6+ months", label: "6+ mo" },
  { value: "ongoing", label: "Ongoing" },
];

export const EXPERIENCE_LEVEL_OPTIONS: { value: CollabExperienceLevel; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "experienced", label: "Experienced" },
];

export const COMPENSATION_TYPE_OPTIONS: { value: CollabCompensationType; label: string }[] = [
  { value: "hourly", label: "Hourly" },
  { value: "fixed", label: "Fixed" },
  { value: "rev_share", label: "Rev Share" },
  { value: "negotiable", label: "Negotiable" },
];

export const CONTACT_TYPE_OPTIONS: { value: CollabContactType; label: string }[] = [
  { value: "discord_dm", label: "Discord DM" },
  { value: "discord_server", label: "Server" },
  { value: "email", label: "Email" },
  { value: "other", label: "Other" },
];

export const CONTACT_PLACEHOLDERS: Record<CollabContactType, string> = {
  discord_dm: "Your Discord username",
  discord_server: "discord.gg/your-server",
  email: "you@example.com",
  other: "How to reach you",
};

export const CONTACT_TYPE_LABELS: Record<string, string> = {
  discord_dm: "Discord DM",
  discord_server: "Discord Server",
  email: "Email",
  other: "Other",
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

/** Server response from `/api/profile/project-image`. */
export interface UploadedImageRecord {
  key: string;
  url: string;
}

/**
 * Upload a single project image to MinIO via
 * `/api/profile/project-image`. Called at submit time once the user
 * actually finalises the post — see `CollabCreateForm`. While the
 * wizard is open the file lives in-memory as `UploadedImage.file` so
 * abandoned drafts never write to the bucket.
 */
export async function uploadCollabPostImage(file: File): Promise<UploadedImageRecord> {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/api/profile/project-image", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message ?? "Upload failed.");
  }
  return (await response.json()) as UploadedImageRecord;
}

/**
 * Upload a team avatar to `/api/team/avatar` (owner-only, team-scoped
 * key). Called at submit right after a TEAM-step quick-create — the
 * file lives in-memory as `UploadedImage.file` until then, same as
 * post images.
 */
export async function uploadTeamAvatarImage(
  teamId: string,
  file: File,
): Promise<UploadedImageRecord> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("teamId", teamId);

  const response = await fetch("/api/team/avatar", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message ?? "Avatar upload failed.");
  }
  return (await response.json()) as UploadedImageRecord;
}

// ── Form values ────────────────────────────────────────────────────────────

export type WizardFormValues = {
  type: CollabPostType | undefined;
  jamId: number | undefined;
  teamId: string | undefined;
  newTeamName: string;
  newTeamDescription: string;
  newTeamImage: UploadedImage | null;
  title: string;
  description: string;
  isIndividual: boolean;
  projectName: string;
  platforms: string[];
  teamSize: CollabTeamSize | undefined;
  projectLength: CollabProjectLength | undefined;
  experienceLevel: CollabExperienceLevel | undefined;
  compensationType: CollabCompensationType | undefined;
  compensationMin: number | undefined;
  compensationMax: number | undefined;
  contactType: CollabContactType | undefined;
  contactMethod: string;
  portfolioUrl: string;
  experience: string;
  roleIds: number[];
  skillIds: number[];
  images: UploadedImage[];
};

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

  const days = (end - start) / 86_400_000;
  if (days <= 7) return "<1 week";
  if (days <= 28) return "1-4 weeks";
  if (days <= 92) return "1-3 months";
  return "3-6 months";
}

// ── Step validation ────────────────────────────────────────────────────────

/** Server caps for the TEAM step's quick-create form (`teamContentShape`). */
export const TEAM_NAME_MAX = 100;
export const TEAM_DESCRIPTION_MAX = 200;

export interface StepValidationOpts {
  /** Editing a pre-v2 unlinked team post — it may save without a team,
   *  so the TEAM step only validates what the user actually typed. */
  legacyUnlinkedEdit?: boolean;
}

export function getStepValidationError(
  stepId: string,
  v: WizardFormValues,
  opts: StepValidationOpts = {},
): string | null {
  switch (stepId) {
    case "basics": {
      if (!v.type) return "Please select a post type.";
      if (!v.title.trim()) return "Please enter a title.";
      if (v.title.trim().length < 10) return "Title must be at least 10 characters.";
      if (!v.description.trim()) return "Please enter a description.";
      if (v.description.trim().length < 30) return "Description must be at least 30 characters.";
      const titleCheck = profanityCheck(v.title, "Title");
      if (titleCheck) return titleCheck;
      const descCheck = profanityCheck(v.description, "Description");
      if (descCheck) return descCheck;
      break;
    }
    case "team": {
      // Solo posts and posts linked to an existing team pass; the
      // new-team form is what needs checking.
      if (v.isIndividual || v.teamId !== undefined) break;
      const name = v.newTeamName.trim();
      if (name.length === 0) {
        if (opts.legacyUnlinkedEdit) break;
        return "Pick or create your team page.";
      }
      if (name.length < 2) return "Team name must be at least 2 characters.";
      const teamNameCheck = profanityCheck(v.newTeamName, "Team name");
      if (teamNameCheck) return teamNameCheck;
      const teamDescCheck = profanityCheck(v.newTeamDescription, "Team description");
      if (teamDescCheck) return teamDescCheck;
      break;
    }
    case "details": {
      if (!v.projectName.trim()) return "Project name is required.";
      if (v.projectName.trim().length < 3) return "Project name must be at least 3 characters.";
      if (v.platforms.length === 0) return "Please select at least one platform.";
      if (!v.teamSize) return "Please select a team size.";
      if (!v.projectLength) return "Please select a timeline.";
      if (!v.experienceLevel) return "Please select an experience level.";
      if (v.type === "paid") {
        if (!v.compensationType) return "Please select a compensation type.";
        if (v.compensationType !== "negotiable" && v.compensationMin === undefined)
          return "Please select a compensation range.";
      }
      if (!v.isIndividual) {
        if (!v.contactType) return "Please select a contact type.";
        if (!v.contactMethod.trim()) return "Please enter contact info.";
      }
      const nameCheck = profanityCheck(v.projectName, "Project name");
      if (nameCheck) return nameCheck;
      if (v.contactMethod) {
        const contactCheck = profanityCheck(v.contactMethod, "Contact method");
        if (contactCheck) return contactCheck;
      }
      break;
    }
    // Roles used to be a step you could walk straight through, which put
    // posts on the board that the board's own role filter couldn't find.
    case "roles":
      if (v.roleIds.length === 0) return "Please select at least one role.";
      break;
    case "review": {
      // The last gate before submit, so it re-runs every requirement
      // rather than trusting that the user walked the steps in order.
      const basics = getStepValidationError("basics", v, opts);
      if (basics) return basics;
      const team = getStepValidationError("team", v, opts);
      if (team) return team;
      const details = getStepValidationError("details", v, opts);
      if (details) return details;
      return getStepValidationError("roles", v, opts);
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
  opts: StepValidationOpts = {},
): { label: string; ok: boolean }[] {
  return [
    { label: "Post type selected", ok: !!v.type },
    { label: "Title is descriptive", ok: v.title.trim().length >= 10 },
    { label: "Description ≥ 30 chars", ok: v.description.trim().length >= 30 },
    {
      label: "Team page picked or named",
      ok: getStepValidationError("team", v, opts) === null,
    },
    { label: "Project named", ok: v.projectName.trim().length >= 3 },
    { label: "At least one platform", ok: v.platforms.length > 0 },
    {
      label: "Team size, timeline, experience",
      ok: !!v.teamSize && !!v.projectLength && !!v.experienceLevel,
    },
    { label: "At least one role", ok: v.roleIds.length > 0 },
    {
      label: "Compensation set",
      ok:
        v.type !== "paid" ||
        (!!v.compensationType &&
          (v.compensationType === "negotiable" || v.compensationMin !== undefined)),
    },
    {
      label: "Contact method chosen",
      ok: v.isIndividual || (!!v.contactType && !!v.contactMethod.trim()),
    },
  ];
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
