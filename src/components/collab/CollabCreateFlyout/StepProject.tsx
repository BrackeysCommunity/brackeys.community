import { useStore } from "@tanstack/react-store";

import type { UploadedImage } from "@/lib/collab-store";

import { ContactFields } from "./ContactFields";
import {
  CompensationField,
  ImageUploader,
  MultiSelectField,
  SelectField,
  TextField,
} from "./fields";
import { useWizardForm } from "./form-context";
import {
  COMPENSATION_TYPE_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  PLATFORM_OPTIONS,
  PROJECT_LENGTH_OPTIONS,
  TEAM_SIZE_OPTIONS,
  profanityCheck,
  type AnyFormStore,
} from "./shared";

/**
 * Step 03 — project meta, compensation (paid only), and contact method.
 * The wizard form already drives all of these inputs; this step just
 * composes the fields. Tech stack lives with roles in step 04: both
 * answer "who am I looking for", and both are what the board filters on.
 */
export function StepProject() {
  const form = useWizardForm();
  const typeVal = useStore(form.store, (s: AnyFormStore) => s.values.type);
  const isIndividual = useStore(form.store, (s: AnyFormStore) => s.values.isIndividual);
  const compensationType = useStore(form.store, (s: AnyFormStore) => s.values.compensationType);

  return (
    <div className="flex flex-col gap-5">
      {/* Images lead — the visual sell is the first thing a card shows,
          so it's the first thing the step asks for. */}
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
          <MultiSelectField
            label="PLATFORMS *"
            value={field.state.value}
            onChange={field.handleChange}
            options={PLATFORM_OPTIONS}
            placeholder="Pick your platforms…"
          />
        )}
      </form.Field>

      <form.Field name="teamSize">
        {(field) => (
          <SelectField
            label="TEAM SIZE *"
            value={field.state.value}
            onChange={field.handleChange}
            options={TEAM_SIZE_OPTIONS}
            placeholder="How many of you…"
          />
        )}
      </form.Field>

      <form.Field name="projectLength">
        {(field) => (
          <SelectField
            label="TIMELINE *"
            value={field.state.value}
            onChange={field.handleChange}
            options={PROJECT_LENGTH_OPTIONS}
            placeholder="How long it'll run…"
          />
        )}
      </form.Field>

      <form.Field name="experienceLevel">
        {(field) => (
          <SelectField
            label="EXPERIENCE LEVEL *"
            value={field.state.value}
            onChange={field.handleChange}
            options={EXPERIENCE_LEVEL_OPTIONS}
            placeholder="Who should apply…"
          />
        )}
      </form.Field>

      {typeVal === "paid" ? (
        <>
          <form.Field name="compensationType">
            {(field) => (
              <SelectField
                label="COMPENSATION TYPE *"
                value={field.state.value}
                onChange={field.handleChange}
                options={COMPENSATION_TYPE_OPTIONS}
                placeholder="How you're paying…"
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

      {/* Solo posters used to have contact silently forced to Discord DM
          with the fields hidden — a solo dev who prefers email had no
          way to say so. DM is now just the default. */}
      <ContactFields isIndividual={isIndividual} />
    </div>
  );
}
