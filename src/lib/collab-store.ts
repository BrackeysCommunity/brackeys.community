import { Store } from "@tanstack/store";

export type CollabPostType = "paid" | "hobby" | "playtest" | "mentor";
export type CollabListingType = "posts" | "people";
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

export type UploadedImage = {
  strapiMediaId: string;
  url: string;
  alt?: string;
};

type CollabFilters = {
  type: CollabPostType | undefined;
  listingType: CollabListingType | undefined;
  roleIds: number[];
  status: CollabStatus | undefined;
  search: string;
  sortBy: CollabSortBy;
  sortOrder: CollabSortOrder;
  experienceLevel: CollabExperienceLevel | undefined;
  compensationType: CollabCompensationType | undefined;
  isIndividual: boolean | undefined;
};

type CollabPagination = {
  limit: number;
  offset: number;
};

export type WizardDraft = {
  type: CollabPostType | undefined;
  title: string;
  description: string;
  projectName: string;
  compensation: string;
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
  images: UploadedImage[];
};

export type WizardStepDef = { id: string; num: string; label: string };

export function getWizardSteps(draft: Pick<WizardDraft, "type">): WizardStepDef[] {
  if (draft.type === "playtest") {
    return [
      { id: "basics", num: "01", label: "TYPE & BASICS" },
      { id: "playtest", num: "02", label: "PLAYTEST DETAILS" },
      { id: "review", num: "03", label: "REVIEW" },
    ];
  }
  if (draft.type === "mentor") {
    return [
      { id: "basics", num: "01", label: "TYPE & BASICS" },
      { id: "mentor", num: "02", label: "MENTORSHIP DETAILS" },
      { id: "review", num: "03", label: "REVIEW" },
    ];
  }
  // Default: paid/hobby
  return [
    { id: "basics", num: "01", label: "TYPE & BASICS" },
    { id: "details", num: "02", label: "PROJECT DETAILS" },
    { id: "roles", num: "03", label: "ROLES NEEDED" },
    { id: "review", num: "04", label: "REVIEW" },
  ];
}

type CollabState = {
  filters: CollabFilters;
  pagination: CollabPagination;
  wizard: {
    step: number;
    draft: WizardDraft;
  };
};

const defaultFilters: CollabFilters = {
  type: undefined,
  listingType: undefined,
  roleIds: [],
  status: undefined,
  search: "",
  sortBy: "createdAt",
  sortOrder: "desc",
  experienceLevel: undefined,
  compensationType: undefined,
  isIndividual: undefined,
};

const defaultDraft: WizardDraft = {
  type: undefined,
  title: "",
  description: "",
  projectName: "",
  compensation: "",
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
  images: [],
};

export const collabStore = new Store<CollabState>({
  filters: { ...defaultFilters },
  pagination: { limit: 20, offset: 0 },
  wizard: { step: 0, draft: { ...defaultDraft } },
});

export function setCollabFilters(partial: Partial<CollabFilters>) {
  collabStore.setState((s) => ({
    ...s,
    filters: { ...s.filters, ...partial },
    pagination: { ...s.pagination, offset: 0 },
  }));
}

export function resetCollabFilters() {
  collabStore.setState((s) => ({
    ...s,
    filters: { ...defaultFilters },
    pagination: { ...s.pagination, offset: 0 },
  }));
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
    const newDraft = { ...s.wizard.draft, ...partial };
    const newSteps = getWizardSteps(newDraft);
    // Clamp step when type changes affect step count
    const clampedStep = Math.min(s.wizard.step, newSteps.length - 1);
    return {
      ...s,
      wizard: { step: clampedStep, draft: newDraft },
    };
  });
}

export function resetWizard() {
  collabStore.setState((s) => ({
    ...s,
    wizard: { step: 0, draft: { ...defaultDraft } },
  }));
}
