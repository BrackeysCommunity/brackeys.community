import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-store";

import { Chonk } from "@/components/ui/chonk";
import { Text } from "@/components/ui/typography";
import type { UploadedImage } from "@/lib/collab-store";
import { cn } from "@/lib/utils";

import { ContactFields } from "./ContactFields";
import {
  CompensationField,
  FieldRow,
  ImageUploader,
  MultiSelectField,
  SelectField,
  TextAreaField,
  TextField,
} from "./fields";
import { useWizardForm } from "./form-context";
import {
  COMPENSATION_TYPE_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  PLATFORM_OPTIONS,
  POST_TYPES,
  PROJECT_LENGTH_OPTIONS,
  profanityCheck,
  type AnyFormStore,
} from "./shared";

/** Where the title stops being scannable on a card, well short of the
 *  200-char storage cap the input still enforces. */
const TITLE_SOFT_LIMIT = 80;

/**
 * Step 01 — the post itself: art, type, headline, description, then the
 * scope (platforms, timeline, experience), pay, and contact.
 *
 * Those last groups used to sit on the PROJECT step, which made that
 * step read as if it were describing the project entity — but none of
 * them are stored on a project, and a linked project can't answer any of
 * them. They belong to the post, so they live with the rest of it.
 * Solo-vs-team is on the TEAM step; the jam link is on PROJECT.
 */
export function StepBasics() {
  const form = useWizardForm();
  const typeVal = useStore(form.store, (s: AnyFormStore) => s.values.type);
  const compensationType = useStore(form.store, (s: AnyFormStore) => s.values.compensationType);
  const projectId = useStore(form.store, (s: AnyFormStore) => s.values.projectId);
  return (
    <div className="flex flex-col gap-5">
      {/* The visual sell leads: it's the first thing a card shows, so
          it's the first thing the form asks for. A linked project's
          cover already covers it, which makes this the override. */}
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
            label={projectId ? "POST IMAGES" : undefined}
            note={
              projectId
                ? "The card already uses the project's cover. Anything added here is extra art for this post — it doesn't change the project."
                : undefined
            }
          />
        )}
      </form.Field>

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
            return undefined;
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

      <form.Field name="platforms">
        {(field) => (
          <MultiSelectField
            label="PLATFORMS"
            value={field.state.value}
            onChange={field.handleChange}
            options={PLATFORM_OPTIONS}
            placeholder="Pick your platforms…"
          />
        )}
      </form.Field>

      <form.Field name="projectLength">
        {(field) => (
          <SelectField
            label="TIMELINE"
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
            label="EXPERIENCE LEVEL"
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

      <ContactFields />
    </div>
  );
}
