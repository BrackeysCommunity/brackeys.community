import { useStore } from "@tanstack/react-store";

import { useWizardForm } from "./form-context";
import { RoleSearchPanel } from "./RoleSearchPanel";
import type { AnyFormStore } from "./shared";
import { SkillSearchPanel } from "./SkillSearchPanel";

/**
 * Step 04 — who the post is looking for: the seats to fill, then the
 * stack they'd be working in. Roles are required, because a post with no
 * roles is invisible to the board's role filter, which is how most
 * people find posts at all. Stack is optional refinement on top.
 */
export function StepRoles() {
  const form = useWizardForm();
  const roleIds = useStore(form.store, (s: AnyFormStore) => s.values.roleIds);
  const skillIds = useStore(form.store, (s: AnyFormStore) => s.values.skillIds);
  const isIndividual = useStore(form.store, (s: AnyFormStore) => s.values.isIndividual);

  return (
    <div className="flex flex-col gap-5">
      <RoleSearchPanel
        label="ROLES NEEDED *"
        roleIds={roleIds}
        onChange={(ids) => form.setFieldValue("roleIds", ids)}
      />

      {/* Stack, not roles — "what would I be working in" rather than
          "which seat am I filling". */}
      <SkillSearchPanel
        skillIds={skillIds}
        onChange={(ids) => form.setFieldValue("skillIds", ids)}
        offerMySkills={isIndividual}
      />
    </div>
  );
}
