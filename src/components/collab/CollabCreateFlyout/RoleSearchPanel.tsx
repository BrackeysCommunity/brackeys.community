import { useQuery } from "@tanstack/react-query";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/typography";
import { orpc } from "@/orpc/client";

import { FieldRow } from "./fields";

interface RoleSearchPanelProps {
  label: string;
  /** Selected role ids — controlled. */
  roleIds: number[];
  onChange: (roleIds: number[]) => void;
}

/**
 * The seats a post is recruiting for. Roles render grouped by their
 * category (Programming, Art, Audio, …) so the art disciplines read as
 * one family instead of scattering through a flat cloud. Uncategorised
 * roles fall into an "Other" bucket at the end.
 *
 * Deliberately kept free of tech: engines and languages belong in
 * `SkillSearchPanel`, or "Godot" ends up governed in two vocabularies
 * with two spellings.
 */
export function RoleSearchPanel({ label, roleIds, onChange }: RoleSearchPanelProps) {
  const { data: roles } = useQuery({ ...orpc.listCollabRoles.queryOptions({ input: {} }) });
  const all = roles ?? [];

  const groups = new Map<string, typeof all>();
  for (const role of all) {
    const key = role.category ?? "Other";
    const bucket = groups.get(key);
    if (bucket) bucket.push(role);
    else groups.set(key, [role]);
  }

  const toggle = (roleId: number, checked: boolean) => {
    if (checked && !roleIds.includes(roleId)) onChange([...roleIds, roleId]);
    else if (!checked) onChange(roleIds.filter((id) => id !== roleId));
  };

  return (
    <FieldRow label={label} hint={`${roleIds.length} selected`}>
      {all.length === 0 ? (
        <Text size="xs" variant="muted">
          No roles available.
        </Text>
      ) : (
        <div className="flex flex-col gap-4">
          {[...groups.entries()].map(([category, categoryRoles]) => (
            <div key={category} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Text
                  as="span"
                  size="xs"
                  variant="muted"
                  className="shrink-0 tracking-widest text-foreground/80 uppercase"
                >
                  {category}
                </Text>
                <span aria-hidden className="h-px flex-1 bg-muted/40" />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {categoryRoles.map((role) => {
                  const id = `collab-role-${role.id}`;
                  const checked = roleIds.includes(role.id);
                  return (
                    <Label
                      key={role.id}
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-2 text-xs tracking-widest text-foreground uppercase"
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(state) => toggle(role.id, state === true)}
                      />
                      {role.name}
                    </Label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </FieldRow>
  );
}
