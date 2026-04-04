import {
  PROFILE_PROJECT_SUBTYPE_LABELS,
  PROFILE_PROJECT_TYPE_LABELS,
  type ProfileProjectType,
  sanitizeProfileProjectSubTypes,
} from "@/lib/profile-projects";
import { cn } from "@/lib/utils";

const typeStyles: Record<ProfileProjectType, string> = {
  jam: "border-brackeys-yellow/35 bg-brackeys-yellow/10 text-brackeys-yellow",
  game: "border-primary/35 bg-primary/10 text-primary",
  audio: "border-emerald-500/35 bg-emerald-500/10 text-emerald-400",
  tool: "border-sky-500/35 bg-sky-500/10 text-sky-400",
  app: "border-fuchsia-500/35 bg-fuchsia-500/10 text-fuchsia-400",
};

export function ProfileProjectTypeBadge({
  type,
  subTypes,
  className,
}: {
  type: ProfileProjectType;
  subTypes?: readonly string[] | null;
  className?: string;
}) {
  const normalizedSubTypes = sanitizeProfileProjectSubTypes(type, subTypes);
  const suffix = normalizedSubTypes.length
    ? ` / ${normalizedSubTypes.map((subType) => PROFILE_PROJECT_SUBTYPE_LABELS[subType]).join(", ")}`
    : "";

  return (
    <span
      className={cn(
        "inline-flex items-center border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em]",
        typeStyles[type],
        className,
      )}
    >
      {PROFILE_PROJECT_TYPE_LABELS[type]}
      {suffix}
    </span>
  );
}
