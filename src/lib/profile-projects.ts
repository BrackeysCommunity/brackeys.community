export const PROFILE_PROJECT_TYPES = ["jam", "game", "audio", "tool", "app"] as const;
export const MANUAL_PROFILE_PROJECT_TYPES = ["game", "audio", "tool", "app"] as const;
export const PROFILE_PROJECT_SOURCE_TYPES = ["manual", "itchio"] as const;

export type ProfileProjectType = (typeof PROFILE_PROJECT_TYPES)[number];
export type ManualProfileProjectType = (typeof MANUAL_PROFILE_PROJECT_TYPES)[number];
export type ProfileProjectSource = (typeof PROFILE_PROJECT_SOURCE_TYPES)[number];

export const PROFILE_PROJECT_SUBTYPE_OPTIONS = {
  audio: ["music", "sfx"],
  app: ["web", "standalone", "mobile"],
} as const;
export const PROFILE_PROJECT_SUBTYPES = [
  ...PROFILE_PROJECT_SUBTYPE_OPTIONS.audio,
  ...PROFILE_PROJECT_SUBTYPE_OPTIONS.app,
] as const;

export type AudioProjectSubType = (typeof PROFILE_PROJECT_SUBTYPE_OPTIONS.audio)[number];
export type AppProjectSubType = (typeof PROFILE_PROJECT_SUBTYPE_OPTIONS.app)[number];
export type ProfileProjectSubType = (typeof PROFILE_PROJECT_SUBTYPES)[number];

export const PROFILE_PROJECT_TYPE_LABELS: Record<ProfileProjectType, string> = {
  jam: "Jam",
  game: "Game",
  audio: "Audio",
  tool: "Tool",
  app: "App",
};

export const PROFILE_PROJECT_SUBTYPE_LABELS: Record<ProfileProjectSubType, string> = {
  music: "Music",
  sfx: "SFX",
  web: "Web",
  standalone: "Standalone",
  mobile: "Mobile",
};

export function getAllowedProfileProjectSubTypes(
  type: ProfileProjectType,
): readonly ProfileProjectSubType[] {
  switch (type) {
    case "audio":
      return PROFILE_PROJECT_SUBTYPE_OPTIONS.audio;
    case "app":
      return PROFILE_PROJECT_SUBTYPE_OPTIONS.app;
    default:
      return [];
  }
}

export function sanitizeProfileProjectSubTypes(
  type: ProfileProjectType,
  subTypes?: readonly string[] | null,
): ProfileProjectSubType[] {
  const allowed = getAllowedProfileProjectSubTypes(type);
  if (allowed.length === 0 || !subTypes?.length) {
    return [];
  }

  const allowedSet = new Set(allowed);
  const seen = new Set<string>();
  const normalized: ProfileProjectSubType[] = [];

  for (const subType of subTypes) {
    if (!allowedSet.has(subType as ProfileProjectSubType) || seen.has(subType)) {
      continue;
    }

    seen.add(subType);
    normalized.push(subType as ProfileProjectSubType);
  }

  return normalized;
}
