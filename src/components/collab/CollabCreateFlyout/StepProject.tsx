import { useStore } from "@tanstack/react-store";

import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

import { FieldRow, TextField } from "./fields";
import { useWizardForm } from "./form-context";
import { JamPickerField } from "./JamPickerField";
import { ProjectPickerField } from "./ProjectPickerField";
import {
  profanityCheck,
  projectLengthForJam,
  projectPrefillValues,
  type AnyFormStore,
  type PickableProject,
  type WizardFormValues,
} from "./shared";

/**
 * Step 03 — what the post is recruiting for: the canonical project (or
 * a working title if there isn't one yet) and the jam it's entered in.
 *
 * Everything here either is the project entity or points at it. The
 * post's own terms — scope, pay, contact — are on BASICS, and tech stack
 * lives with roles in step 04: both answer "who am I looking for", and
 * both are what the board filters on.
 */
export function StepProject() {
  const form = useWizardForm();
  const teamId = useStore(form.store, (s: AnyFormStore) => s.values.teamId);
  const projectId = useStore(form.store, (s: AnyFormStore) => s.values.projectId);

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

      {/* A linked project owns its own name. Letting the post retype it
          would let the two drift — the post would advertise one title while
          pointing at a page with another — so the field becomes a readout
          and renaming stays on the project page, where the edit is real.
          The server derives this column too; the lock isn't the only guard. */}
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
        {(field) =>
          projectId ? (
            <FieldRow label="PROJECT NAME" hint="from the project page">
              <Well variant="ghost" className="p-2.5">
                <Text size="sm" bold ellipsis>
                  {field.state.value}
                </Text>
              </Well>
              <Text size="xs" variant="muted" className="tracking-wide">
                Rename it on the project page. To post under a different name, unlink the project
                above.
              </Text>
            </FieldRow>
          ) : (
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
          )
        }
      </form.Field>

      {/* The jam sits with the project rather than the pitch: both are
          links to something that already exists, and a jam entry is the
          project, so picking one reads as part of naming the work. */}
      <form.Field name="jamId">
        {(field) => (
          <JamPickerField
            value={field.state.value}
            onChange={(jam) => {
              field.handleChange(jam?.jamId);
              // A jam's run length is the project's timeline. Only fill
              // a blank — a user who already chose one meant it.
              const derived = jam ? projectLengthForJam(jam.startsAt, jam.endsAt) : undefined;
              if (derived && !form.state.values.projectLength) {
                form.setFieldValue("projectLength", derived);
              }
            }}
          />
        )}
      </form.Field>
    </div>
  );
}
