import { MAX_POST_ROLES } from "@/lib/collab-vocabulary";
import { useRolesCatalog } from "@/lib/hooks/use-taxonomy";

import { TagPickerPanel } from "./TagPickerPanel";

interface RoleSearchPanelProps {
  label: string;
  /** Selected role ids — controlled. */
  roleIds: number[];
  onChange: (roleIds: number[]) => void;
}

/**
 * The seats a post is recruiting for.
 *
 * Deliberately kept free of tech: engines and languages belong in
 * `SkillSearchPanel`, or "Godot" ends up governed in two vocabularies
 * with two spellings. Both are the same control — see `TagPickerPanel`.
 */
export function RoleSearchPanel({ label, roleIds, onChange }: RoleSearchPanelProps) {
  const { data: roles } = useRolesCatalog();

  return (
    <TagPickerPanel
      label={label}
      hint={`${roleIds.length}/${MAX_POST_ROLES} selected`}
      options={roles ?? []}
      selectedIds={roleIds}
      onChange={onChange}
      searchPlaceholder="Search roles…"
      emptyMessage="No roles available."
      max={MAX_POST_ROLES}
      atCapMessage={`${MAX_POST_ROLES} is the limit — remove one to add another.`}
    />
  );
}
