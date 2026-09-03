import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { Text } from "@/components/ui/typography";
import type { CollabContactType } from "@/lib/collab-store";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { SelectField, TextField } from "./fields";
import { useWizardForm } from "./form-context";
import { CONTACT_PLACEHOLDERS, CONTACT_TYPE_OPTIONS } from "./shared";

/**
 * Seeds the contact block with a Discord DM from the author's profile.
 * Prefills once, and only into empty fields — never over a choice the
 * user already made (or one an edit loaded from the post). Returns the
 * handle so a collapsed contact row can name it.
 */
export function useDiscordContactPrefill(): string | null {
  const form = useWizardForm();
  const { data: profile } = useQuery({
    ...orpc.getMyProfile.queryOptions({ input: {} }),
    staleTime: STALE.listing,
  });
  const discordUsername = profile?.profile?.discordUsername ?? null;

  useEffect(() => {
    if (!discordUsername) return;
    const values = form.state.values as {
      contactType?: CollabContactType;
      contactMethod: string;
    };
    if (values.contactType || values.contactMethod.trim()) return;
    form.setFieldValue("contactType", "discord_dm");
    form.setFieldValue("contactMethod", discordUsername);
  }, [discordUsername, form]);

  return discordUsername;
}

/**
 * How responders reach the poster. Every post defaults to a Discord DM
 * prefilled from the author's profile — a default, not a lock: hiding
 * these fields (as this used to for solo posts) meant a dev who prefers
 * email simply couldn't say so. Optional throughout: an accepted
 * responder is handed the author's Discord handle regardless.
 */
export function ContactFields() {
  const form = useWizardForm();
  const discordUsername = useDiscordContactPrefill();

  return (
    <>
      <form.Field name="contactType">
        {(field) => (
          <SelectField
            label="CONTACT TYPE"
            value={field.state.value}
            onChange={field.handleChange}
            options={CONTACT_TYPE_OPTIONS}
            placeholder="How to reach you…"
          />
        )}
      </form.Field>

      <form.Field name="contactType">
        {(ctField) => {
          const ct = ctField.state.value as CollabContactType | undefined;
          if (!ct) return null;
          return (
            <form.Field name="contactMethod">
              {(field) => (
                <>
                  <TextField
                    label="CONTACT INFO"
                    value={field.state.value}
                    onChange={field.handleChange}
                    onBlur={field.handleBlur}
                    placeholder={CONTACT_PLACEHOLDERS[ct]}
                    maxLength={500}
                    error={field.state.meta.errors.map(String).join(" ") || null}
                  />
                  {ct === "discord_dm" && discordUsername ? (
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
