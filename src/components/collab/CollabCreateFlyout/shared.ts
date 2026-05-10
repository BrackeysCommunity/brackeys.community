import {
  BriefcaseIcon,
  GameController01Icon,
  MultiplicationSignIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
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

// ── Wizard step ids exposed to the user-facing 4-tab strip ─────────────────

export type WizardTabId = "basics" | "project" | "roles" | "review";

export interface WizardTabDef {
  id: WizardTabId;
  num: string;
  label: string;
}

export const DEFAULT_TABS: WizardTabDef[] = [
  { id: "basics", num: "01", label: "BASICS" },
  { id: "project", num: "02", label: "PROJECT" },
  { id: "roles", num: "03", label: "ROLES" },
  { id: "review", num: "04", label: "REVIEW" },
];

export function getWizardTabs(type: CollabPostType | undefined): WizardTabDef[] {
  if (type === "playtest") {
    return [
      { id: "basics", num: "01", label: "BASICS" },
      { id: "project", num: "02", label: "PLAYTEST" },
      { id: "review", num: "03", label: "REVIEW" },
    ];
  }
  if (type === "mentor") {
    return [
      { id: "basics", num: "01", label: "BASICS" },
      { id: "project", num: "02", label: "MENTORSHIP" },
      { id: "review", num: "03", label: "REVIEW" },
    ];
  }
  return DEFAULT_TABS;
}

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
  {
    value: "playtest",
    label: "PLAYTEST",
    desc: "Find testers for builds & demos.",
    icon: MultiplicationSignIcon,
  },
  {
    value: "mentor",
    label: "MENTORSHIP",
    desc: "Teach or learn from someone shipping.",
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

export const FEEDBACK_TYPE_OPTIONS = [
  "Gameplay",
  "UX/UI",
  "Bugs",
  "Balance",
  "Story",
  "Performance",
  "General",
];

export const PLAY_TIME_OPTIONS: { value: CollabProjectLength; label: string }[] = [
  { value: "<1 week", label: "< 15 min" },
  { value: "1-4 weeks", label: "15-30 min" },
  { value: "1-3 months", label: "30-60 min" },
  { value: "3-6 months", label: "1-2 hrs" },
  { value: "6+ months", label: "2+ hrs" },
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

export function formatCompensation(
  type: CollabCompensationType | undefined,
  min: number | undefined,
  max: number | undefined,
): string {
  if (!type || type === "negotiable" || min === undefined) return "";
  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `$${n}`;
  if (type === "rev_share") {
    return max !== undefined ? `${min}% - ${max}%` : `${min}%+`;
  }
  const suffix = type === "hourly" ? " /hr" : "";
  return max !== undefined ? `${fmt(min)} - ${fmt(max)}${suffix}` : `${fmt(min)}+${suffix}`;
}

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

// ── Form values ────────────────────────────────────────────────────────────

export type WizardFormValues = {
  type: CollabPostType | undefined;
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
  images: UploadedImage[];
};

// ── Step validation ────────────────────────────────────────────────────────

export function getStepValidationError(stepId: string, v: WizardFormValues): string | null {
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
    case "playtest": {
      if (v.platforms.length === 0) return "Please select at least one platform.";
      if (!v.projectLength) return "Please select estimated play time.";
      if (!v.experienceLevel) return "Please select an experience level.";
      let feedbackTypes: string[] = [];
      try {
        feedbackTypes = JSON.parse(v.experience || "[]");
      } catch {
        /* empty */
      }
      if (!Array.isArray(feedbackTypes) || feedbackTypes.length === 0)
        return "Please select at least one feedback type.";
      break;
    }
    case "mentor": {
      if (v.roleIds.length === 0) return "Please select at least one topic.";
      if (!v.projectLength) return "Please select your availability.";
      if (!v.experienceLevel) return "Please select an experience level.";
      if (!v.isIndividual) {
        if (!v.contactType) return "Please select a contact type.";
        if (!v.contactMethod.trim()) return "Please enter contact info.";
      }
      if (v.contactMethod) {
        const contactCheck = profanityCheck(v.contactMethod, "Contact method");
        if (contactCheck) return contactCheck;
      }
      break;
    }
    case "roles":
      break;
    case "review": {
      if (!v.type) return "Post type is missing.";
      if (!v.title.trim()) return "Title is missing.";
      if (v.title.trim().length < 10) return "Title must be at least 10 characters.";
      if (!v.description.trim()) return "Description is missing.";
      if (v.description.trim().length < 30) return "Description must be at least 30 characters.";
      break;
    }
  }
  return null;
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
