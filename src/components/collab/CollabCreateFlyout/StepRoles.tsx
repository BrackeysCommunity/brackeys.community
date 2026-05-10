import { useStore } from "@tanstack/react-store";

import { useWizardForm } from "./form-context";
import { RoleSearchPanel } from "./RoleSearchPanel";
import type { AnyFormStore } from "./shared";

/**
 * Step 03 (paid / hobby) — pick the roles the post is recruiting for.
 */
export function StepRoles() {
  const form = useWizardForm();
  const roleIds = useStore(form.store, (s: AnyFormStore) => s.values.roleIds);
  return (
    <RoleSearchPanel
      label="ROLES NEEDED"
      roleIds={roleIds}
      onChange={(ids) => form.setFieldValue("roleIds", ids)}
    />
  );
}
