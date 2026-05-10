import { useStore } from "@tanstack/react-store";

import { MultiChipField, SegmentedField, TextField } from "./fields";
import { useWizardForm } from "./form-context";
import {
  type AnyFormStore,
  EXPERIENCE_LEVEL_OPTIONS,
  FEEDBACK_TYPE_OPTIONS,
  PLATFORM_OPTIONS,
  PLAY_TIME_OPTIONS,
} from "./shared";

/**
 * Step 02 (playtest) — platforms + game link + feedback types + play
 * time + experience level. Feedback types live on the catch-all
 * `experience` field as JSON because the schema doesn't have a
 * dedicated column.
 */
export function StepPlaytest() {
  const form = useWizardForm();
  const experience = useStore(form.store, (s: AnyFormStore) => s.values.experience);

  let feedbackTypes: string[] = [];
  try {
    const parsed = JSON.parse(experience || "[]");
    feedbackTypes = Array.isArray(parsed) ? parsed : [];
  } catch {
    feedbackTypes = [];
  }
  const setFeedbackTypes = (types: string[]) => {
    form.setFieldValue("experience", JSON.stringify(types));
  };

  return (
    <div className="flex flex-col gap-5">
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

      <form.Field name="portfolioUrl">
        {(field) => (
          <TextField
            label="LINK TO GAME / DEMO"
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
            placeholder="https://itch.io/your-game"
            maxLength={500}
          />
        )}
      </form.Field>

      <MultiChipField
        label="FEEDBACK TYPES *"
        value={feedbackTypes}
        onChange={setFeedbackTypes}
        options={FEEDBACK_TYPE_OPTIONS}
      />

      <form.Field name="projectLength">
        {(field) => (
          <SegmentedField
            label="ESTIMATED PLAY TIME *"
            value={field.state.value}
            onChange={field.handleChange}
            options={PLAY_TIME_OPTIONS}
          />
        )}
      </form.Field>

      <form.Field name="experienceLevel">
        {(field) => (
          <SegmentedField
            label="EXPERIENCE LEVEL NEEDED *"
            value={field.state.value}
            onChange={field.handleChange}
            options={EXPERIENCE_LEVEL_OPTIONS}
          />
        )}
      </form.Field>
    </div>
  );
}
