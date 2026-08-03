import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";

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
  const { data: roles } = useQuery({
    ...orpc.listCollabRoles.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <TagPickerPanel
      label={label}
      hint={`${roleIds.length} selected`}
      options={roles ?? []}
      selectedIds={roleIds}
      onChange={onChange}
      searchPlaceholder="Search roles…"
      emptyMessage="No roles available."
    />
  );
}
