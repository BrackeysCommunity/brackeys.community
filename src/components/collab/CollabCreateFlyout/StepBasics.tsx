import { HugeiconsIcon } from "@hugeicons/react";

import { Chonk } from "@/components/ui/chonk";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { updateWizardDraft } from "@/lib/collab-store";
import { cn } from "@/lib/utils";

import { FieldRow, TextAreaField, TextField } from "./fields";
import { useWizardForm } from "./form-context";
import { POST_TYPES, profanityCheck } from "./shared";

/**
 * Step 01 — pick a post type, write the headline + description, decide
 * whether to post as an individual or a team. Mirrors the wireframe's
 * `POST TYPE / POST TITLE / DESCRIPTION` ordering.
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
                        onClick={() => {
                          field.handleChange(t.value);
                          updateWizardDraft({ type: t.value });
                        }}
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
                        monospace
                        bold
                        size="xs"
                        className={cn(
                          "tracking-widest uppercase",
                          active ? "text-primary" : "text-foreground",
                        )}
                      >
                        {t.label}
                      </Text>
                      <Text monospace size="xs" variant="muted">
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
            hint="be specific, people scan"
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

      <form.Field name="type">
        {(typeField) =>
          typeField.state.value ? (
            <form.Field name="isIndividual">
              {(field) => (
                <Well variant="ghost" className="gap-3 p-3">
                  <FieldRow label="POSTING AS" hint={field.state.value ? "myself" : "a team"}>
                    <div className="flex items-center gap-3">
                      <Switch
                        id="collab-create-is-individual"
                        checked={field.state.value}
                        onCheckedChange={(checked) => {
                          field.handleChange(!!checked);
                          updateWizardDraft({ isIndividual: !!checked });
                        }}
                      />
                      <Text size="sm" variant="muted">
                        {field.state.value
                          ? "Posting as myself — Discord DM is used for contact."
                          : "Posting on behalf of a team — choose a contact method below."}
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
