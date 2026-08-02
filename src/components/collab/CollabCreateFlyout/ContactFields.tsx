import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { Text } from "@/components/ui/typography";
import type { CollabContactType } from "@/lib/collab-store";
import { orpc } from "@/orpc/client";

import { SegmentedField, TextField } from "./fields";
import { useWizardForm } from "./form-context";
import { CONTACT_PLACEHOLDERS, CONTACT_TYPE_OPTIONS, profanityCheck } from "./shared";

/**
 * How responders reach the poster. Solo posts default to a Discord DM
 * prefilled from the author's profile — but they're only a default:
 * hiding these fields behind `isIndividual` (as this used to) meant a
 * solo dev who prefers email simply couldn't say so.
 */
export function ContactFields({ isIndividual }: { isIndividual: boolean }) {
  const form = useWizardForm();
  const { data: profile } = useQuery({
    ...orpc.getMyProfile.queryOptions({ input: {} }),
    staleTime: 60 * 1000,
  });
  const discordUsername = profile?.profile?.discordUsername ?? null;

  // Prefill once, and only into empty fields — never overwrite a choice
  // the user has already made (or one an edit loaded from the post).
  useEffect(() => {
    if (!isIndividual || !discordUsername) return;
    const values = form.state.values as {
      contactType?: CollabContactType;
      contactMethod: string;
    };
    if (values.contactType || values.contactMethod.trim()) return;
    form.setFieldValue("contactType", "discord_dm");
    form.setFieldValue("contactMethod", discordUsername);
  }, [isIndividual, discordUsername, form]);

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
                <>
                  <TextField
                    label="CONTACT INFO *"
                    value={field.state.value}
                    onChange={field.handleChange}
                    onBlur={field.handleBlur}
                    placeholder={CONTACT_PLACEHOLDERS[ct]}
                    maxLength={500}
                    error={field.state.meta.errors.map(String).join(" ") || null}
                  />
                  {ct === "discord_dm" && isIndividual && discordUsername ? (
                    <Text size="xs" variant="muted">
                      Prefilled from your Discord profile.
                    </Text>
                  ) : null}
                </>
              )}
            </form.Field>
          );
        }}
      </form.Field>
    </>
  );
}
