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
import { ProjectPickerField } from "./ProjectPickerField";
import {
  COMPENSATION_TYPE_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  PLATFORM_OPTIONS,
  PROJECT_LENGTH_OPTIONS,
  TEAM_SIZE_OPTIONS,
  profanityCheck,
  projectPrefillValues,
  type AnyFormStore,
  type PickableProject,
  type WizardFormValues,
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
  const teamId = useStore(form.store, (s: AnyFormStore) => s.values.teamId);

  // Picking fills the fields below; the free-text stays the post's own
  // copy, so unlinking later loses nothing.
  const applyPrefill = (project: PickableProject, { keepTyped }: { keepTyped: boolean }) => {
    const values = form.state.values as WizardFormValues;
    const next = projectPrefillValues(project, values);
    if (keepTyped && values.projectName.trim()) delete next.projectName;
    for (const [key, value] of Object.entries(next)) {
      form.setFieldValue(key as keyof WizardFormValues, value);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* The picker leads: a poster holding an entity shouldn't be made
          to re-describe it — picking prefills the fields below and the
          card inherits the project's cover with zero uploads. */}
      <form.Field name="projectId">
        {(field) => (
          <ProjectPickerField
            value={field.state.value}
            selectedTeamId={teamId}
            onChange={(project) => {
              field.handleChange(project?.id);
              if (project) applyPrefill(project, { keepTyped: false });
            }}
            // A deep-linked or edit-restored pick fills only blanks — a
            // typed name is the poster's own copy to keep.
            onSelectedResolved={(project) => applyPrefill(project, { keepTyped: true })}
          />
        )}
      </form.Field>

      {/* Images — the visual sell is the first thing a card shows. A
          linked project's cover already covers that, so this is the
          override, not the requirement. */}
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
