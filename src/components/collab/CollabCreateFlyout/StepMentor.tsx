import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import type { CollabContactType } from "@/lib/collab-store";
import { orpc } from "@/orpc/client";

import { FieldRow, SegmentedField, TextField } from "./fields";
import { useWizardForm } from "./form-context";
import { RoleSearchPanel } from "./RoleSearchPanel";
import {
  type AnyFormStore,
  CONTACT_PLACEHOLDERS,
  CONTACT_TYPE_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  PROJECT_LENGTH_OPTIONS,
  profanityCheck,
} from "./shared";

/**
 * Step 02 (mentor) — topic search + availability + experience level +
 * contact details. Combines a `RoleSearchPanel` with the same contact
 * affordances as the project step.
 */
export function StepMentor() {
  const form = useWizardForm();
  const isIndividual = useStore(form.store, (s: AnyFormStore) => s.values.isIndividual);
  const roleIds = useStore(form.store, (s: AnyFormStore) => s.values.roleIds);

  return (
    <div className="flex flex-col gap-5">
      <RoleSearchPanel
        label="TOPICS / AREAS *"
        roleIds={roleIds}
        onChange={(ids) => form.setFieldValue("roleIds", ids)}
      />

      <form.Field name="projectLength">
        {(field) => (
          <SegmentedField
            label="AVAILABILITY *"
            value={field.state.value}
            onChange={field.handleChange}
            options={PROJECT_LENGTH_OPTIONS}
          />
        )}
      </form.Field>

      <form.Field name="experienceLevel">
        {(field) => (
          <SegmentedField
            label="EXPERIENCE LEVEL *"
            value={field.state.value}
            onChange={field.handleChange}
            options={EXPERIENCE_LEVEL_OPTIONS}
          />
        )}
      </form.Field>

      {isIndividual ? <DiscordContactNotice /> : <TeamContactFields />}
    </div>
  );
}

function DiscordContactNotice() {
  const { data: profile } = useQuery({ ...orpc.getMyProfile.queryOptions({ input: {} }) });
  const username = profile?.profile?.discordUsername;
  return (
    <FieldRow label="CONTACT" hint="auto · individual posts">
      <Well variant="ghost" className="gap-1 border-primary/30 bg-primary/5 p-3">
        <Text monospace bold size="xs" className="tracking-widest text-primary uppercase">
          DISCORD DM
        </Text>
        <Text monospace size="xs">
          {username ? `@${username}` : "Loading…"}
        </Text>
        <Text monospace size="xs" variant="muted">
          Respondents will contact you via Discord DM.
        </Text>
      </Well>
    </FieldRow>
  );
}

function TeamContactFields() {
  const form = useWizardForm();
  return (
    <>
      <form.Field name="contactType">
        {(field) => (
          <SegmentedField
            label="CONTACT TYPE *"
            value={field.state.value}
            onChange={field.handleChange}
            options={CONTACT_TYPE_OPTIONS}
          />
        )}
      </form.Field>
      <form.Field name="contactType">
        {(ctField) => {
          const ct = ctField.state.value as CollabContactType | undefined;
          if (!ct) return null;
          return (
            <form.Field
              name="contactMethod"
              validators={{
                onChange: ({ value }: { value: string }) => profanityCheck(value, "Contact method"),
              }}
            >
              {(field) => (
                <TextField
                  label="CONTACT INFO *"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  placeholder={CONTACT_PLACEHOLDERS[ct]}
                  maxLength={500}
                  error={field.state.meta.errors.map(String).join(" ") || null}
                />
              )}
            </form.Field>
          );
        }}
      </form.Field>
    </>
  );
}
