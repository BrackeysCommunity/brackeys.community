import { HugeiconsIcon } from "@hugeicons/react";

import { Chonk } from "@/components/ui/chonk";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

import { FieldRow, TextAreaField, TextField } from "./fields";
import { useWizardForm } from "./form-context";
import { JamPickerField } from "./JamPickerField";
import { POST_TYPES, profanityCheck, projectLengthForJam } from "./shared";

/** Where the title stops being scannable on a card, well short of the
 *  200-char storage cap the input still enforces. */
const TITLE_SOFT_LIMIT = 80;

/**
 * Step 01 — pick a post type, write the headline + description, link a
 * jam if there is one, and say whether you're recruiting solo or for a
 * team. Mirrors the wireframe's `POST TYPE / POST TITLE / DESCRIPTION`
 * ordering.
 */
export function StepBasics() {
  const form = useWizardForm();
  return (
    <div className="flex flex-col gap-5">
      <form.Field name="type">
        {(field) => (
          <FieldRow
            label="POST TYPE *"
            error={field.state.meta.errors.map(String).join(" ") || null}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {POST_TYPES.map((t) => {
                const active = field.state.value === t.value;
                return (
                  <Chonk
                    key={t.value}
                    variant={active ? "default" : "surface"}
                    size="lg"
                    render={
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => field.handleChange(t.value)}
                      />
                    }
                    className="flex w-full flex-col items-stretch gap-2 p-3 text-left"
                  >
                    <HugeiconsIcon
                      icon={t.icon}
                      size={16}
                      className={active ? "text-primary" : "text-muted-foreground"}
                    />
                    <div className="flex flex-col gap-0.5">
                      <Text
                        as="span"
                        bold
                        size="xs"
                        className={cn(
                          "tracking-widest uppercase",
                          active ? "text-primary" : "text-foreground",
                        )}
                      >
                        {t.label}
                      </Text>
                      <Text size="xs" variant="muted">
                        {t.desc}
                      </Text>
                    </div>
                  </Chonk>
                );
              })}
            </div>
          </FieldRow>
        )}
      </form.Field>

      <form.Field
        name="title"
        validators={{
          onChange: ({ value }: { value: string }) => {
            if (value.trim().length > 0 && value.trim().length < 10)
              return "Title must be at least 10 characters.";
            return profanityCheck(value, "Title");
          },
        }}
      >
        {(field) => (
          <TextField
            label="POST TITLE *"
            hint={
              field.state.value.length > TITLE_SOFT_LIMIT
                ? "long titles get truncated on cards"
                : "be specific, people scan"
            }
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
            placeholder="e.g. Pixel artist for PSX-style horror RPG"
            maxLength={200}
            error={field.state.meta.errors.map(String).join(" ") || null}
          />
        )}
      </form.Field>

      <form.Field
        name="description"
        validators={{
          onChange: ({ value }: { value: string }) => {
            if (value.trim().length > 0 && value.trim().length < 30)
              return "Description must be at least 30 characters.";
            return profanityCheck(value, "Description");
          },
        }}
      >
        {(field) => (
          <TextAreaField
            label="DESCRIPTION *"
            hint="markdown supported"
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
            placeholder="Describe what you're looking for…"
            maxLength={5000}
            rows={6}
            error={field.state.meta.errors.map(String).join(" ") || null}
          />
        )}
      </form.Field>

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

      <form.Field name="type">
        {(typeField) =>
          typeField.state.value ? (
            <form.Field name="isIndividual">
              {(field) => (
                <Well variant="ghost" className="gap-3 p-3">
                  {/* Not an availability listing — that's the people lane.
                      This is still a team-seeking post; the switch only
                      says who's behind it. */}
                  <FieldRow label="RECRUITING AS" hint={field.state.value ? "solo dev" : "a team"}>
                    <div className="flex items-center gap-3">
                      <Switch
                        id="collab-create-is-individual"
                        checked={field.state.value}
                        onCheckedChange={(checked) => field.handleChange(!!checked)}
                      />
                      <Text size="sm" variant="muted">
                        {field.state.value
                          ? "It's just me looking for collaborators."
                          : "I'm posting on behalf of an existing team."}
                      </Text>
                    </div>
                  </FieldRow>
                </Well>
              )}
            </form.Field>
          ) : null
        }
      </form.Field>
    </div>
  );
}
