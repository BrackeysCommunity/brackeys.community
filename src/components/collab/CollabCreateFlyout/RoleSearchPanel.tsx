import { useQuery } from "@tanstack/react-query";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/typography";
import { orpc } from "@/orpc/client";

import { FieldRow } from "./fields";

interface RoleSearchPanelProps {
  /** "Roles needed" vs "Topics / Areas" — only the label differs. */
  label: string;
  /** Selected role ids — controlled. */
  roleIds: number[];
  onChange: (roleIds: number[]) => void;
}

/**
 * Role / topic picker shared by the ROLES step (paid+hobby) and the
 * MENTORSHIP step. The role list is small enough to render the full
 * cloud inline as a checkbox grid — no search needed.
 */
export function RoleSearchPanel({ label, roleIds, onChange }: RoleSearchPanelProps) {
  const { data: roles } = useQuery({ ...orpc.listCollabRoles.queryOptions({ input: {} }) });
  const all = roles ?? [];

  const toggle = (roleId: number, checked: boolean) => {
    if (checked && !roleIds.includes(roleId)) onChange([...roleIds, roleId]);
    else if (!checked) onChange(roleIds.filter((id) => id !== roleId));
  };

  return (
    <FieldRow label={label} hint={`${roleIds.length} selected`}>
      {all.length === 0 ? (
        <Text monospace size="xs" variant="muted">
          No roles available.
        </Text>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {all.map((role) => {
            const id = `collab-role-${role.id}`;
            const checked = roleIds.includes(role.id);
            return (
              <Label
                key={role.id}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2 font-mono text-xs tracking-widest text-foreground uppercase"
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
      )}
    </FieldRow>
  );
}
