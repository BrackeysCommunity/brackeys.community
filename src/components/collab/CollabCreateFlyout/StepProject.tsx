import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import type { CollabContactType, UploadedImage } from "@/lib/collab-store";
import { orpc } from "@/orpc/client";

import {
  CompensationField,
  FieldRow,
  ImageUploader,
  MultiChipField,
  SegmentedField,
  TextField,
} from "./fields";
import { useWizardForm } from "./form-context";
import {
  COMPENSATION_TYPE_OPTIONS,
  CONTACT_PLACEHOLDERS,
  CONTACT_TYPE_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  PLATFORM_OPTIONS,
  PROJECT_LENGTH_OPTIONS,
  TEAM_SIZE_OPTIONS,
  profanityCheck,
  type AnyFormStore,
} from "./shared";

/**
 * Step 02 (paid / hobby) — project meta, compensation (paid only), and
 * contact method. The wizard form already drives all of these inputs;
 * this step just composes the fields.
 */
export function StepProject() {
  const form = useWizardForm();
  const typeVal = useStore(form.store, (s: AnyFormStore) => s.values.type);
  const isIndividual = useStore(form.store, (s: AnyFormStore) => s.values.isIndividual);
  const compensationType = useStore(form.store, (s: AnyFormStore) => s.values.compensationType);

  return (
    <div className="flex flex-col gap-5">
      <form.Field
        name="projectName"
        validators={{
          onChange: ({ value }: { value: string }) => {
            if (value.trim().length > 0 && value.trim().length < 3)
              return "Project name must be at least 3 characters.";
            return profanityCheck(value, "Project name");
          },
        }}
      >
        {(field) => (
          <TextField
            label="PROJECT NAME *"
            hint="working title is fine"
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
            placeholder="e.g. Cathedral of Wires"
            maxLength={200}
            error={field.state.meta.errors.map(String).join(" ") || null}
          />
        )}
      </form.Field>

      <form.Field name="platforms">
        {(field) => (
          <MultiChipField
            label="PLATFORMS *"
            value={field.state.value}
            onChange={field.handleChange}
            options={PLATFORM_OPTIONS}
          />
        )}
      </form.Field>

      <form.Field name="teamSize">
        {(field) => (
          <SegmentedField
            label="TEAM SIZE *"
            value={field.state.value}
            onChange={field.handleChange}
            options={TEAM_SIZE_OPTIONS}
          />
        )}
      </form.Field>

      <form.Field name="projectLength">
        {(field) => (
          <SegmentedField
            label="TIMELINE *"
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

      <form.Field name="images">
        {(field) => (
          <ImageUploader
            images={field.state.value}
            onAdd={(img) => field.handleChange([...field.state.value, img])}
            onRemove={(idx) =>
              field.handleChange(
                field.state.value.filter((_: UploadedImage, i: number) => i !== idx),
              )
            }
          />
        )}
      </form.Field>

      {typeVal === "paid" ? (
        <>
          <form.Field name="compensationType">
            {(field) => (
              <SegmentedField
                label="COMPENSATION TYPE *"
                value={field.state.value}
                onChange={field.handleChange}
                options={COMPENSATION_TYPE_OPTIONS}
              />
            )}
          </form.Field>

          {compensationType && compensationType !== "negotiable" ? (
            <form.Field name="compensationMin">
              {(minField) => (
                <form.Field name="compensationMax">
                  {(maxField) => (
                    <CompensationField
                      compensationType={compensationType}
                      min={minField.state.value}
                      max={maxField.state.value}
                      onMinChange={(v) => minField.handleChange(v)}
                      onMaxChange={(v) => maxField.handleChange(v)}
                    />
                  )}
                </form.Field>
              )}
            </form.Field>
          ) : null}
        </>
      ) : null}

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
