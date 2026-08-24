import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import type { NotificationType } from "@/db/schema";
import { NOTIFICATION_TYPE_LABEL, NOTIFICATION_TYPES } from "@/lib/notification-copy";
import { reportMutationError } from "@/lib/product-insights";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

type Preference = {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
  digest: boolean;
};

type PreferencesData = {
  emailsDisabled: boolean;
  preferences: Preference[];
};

type UpdateVars = {
  type: NotificationType;
  inApp?: boolean;
  email?: boolean;
  digest?: boolean;
};

const CHANNEL_LABELS = [
  { key: "inApp" as const, label: "In-app" },
  { key: "email" as const, label: "Email" },
  { key: "digest" as const, label: "Digest" },
];

/** Channels the global email switch overrides when it's off. */
const EMAIL_CHANNELS = new Set(["email", "digest"]);

/** Header and body rows share one track list so the columns line up. */
const MATRIX_GRID = "grid grid-cols-[1fr_repeat(3,minmax(0,5rem))] gap-2 px-4";

export function NotificationPreferences() {
  const queryClient = useQueryClient();
  const preferencesQuery = orpc.getPreferences.queryOptions({ input: {} });
  const queryKey = preferencesQuery.queryKey;
  const { data, isLoading } = useQuery(preferencesQuery);

  const { mutate: update } = useMutation({
    mutationFn: (vars: UpdateVars) => client.updatePreference(vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<PreferencesData>(queryKey);
      if (prev) {
        queryClient.setQueryData<PreferencesData>(queryKey, {
          ...prev,
          preferences: prev.preferences.map((p) => (p.type === vars.type ? { ...p, ...vars } : p)),
        });
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      reportMutationError(err, "settings.notification_prefs");
      const prev = (ctx as { prev?: PreferencesData } | undefined)?.prev;
      if (prev) queryClient.setQueryData(queryKey, prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const { mutate: setEmailsEnabled } = useMutation({
    mutationFn: (enabled: boolean) => client.setEmailsDisabled({ disabled: !enabled }),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<PreferencesData>(queryKey);
      if (prev) {
        queryClient.setQueryData<PreferencesData>(queryKey, { ...prev, emailsDisabled: !enabled });
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      reportMutationError(err, "settings.notification_emails");
      const prev = (ctx as { prev?: PreferencesData } | undefined)?.prev;
      if (prev) queryClient.setQueryData(queryKey, prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const byType = new Map(data.preferences.map((p) => [p.type, p]));
  const emailsOff = data.emailsDisabled;

  return (
    <div className="flex flex-col gap-3">
      <Text size="xs" variant="muted" className="max-w-prose">
        Choose how you hear about each kind of activity. <strong>In-app</strong> shows in the bell
        and inbox. <strong>Email</strong> sends a transactional email (suppressed while you're
        actively online). <strong>Digest</strong> bundles into a weekly Monday email.
      </Text>

      <Well className="flex-row items-center gap-4 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <MicroLabel as="span" bold className="uppercase">
            Email notifications
          </MicroLabel>
          <Text size="xs" variant="muted">
            {emailsOff
              ? "All notification email is off. Turn it back on to resume — check your per-event choices below."
              : "Master switch. Turning this off stops every notification and digest email — account and security mail still comes through."}
          </Text>
        </div>
        <Switch
          checked={!emailsOff}
          onCheckedChange={(checked) => setEmailsEnabled(!!checked)}
          aria-label="Email notifications"
        />
      </Well>

      <Well className="divide-y divide-dashed divide-muted/40">
        <div className={cn(MATRIX_GRID, "py-2.5")}>
          <MicroLabel as="span" bold className="uppercase">
            Event
          </MicroLabel>
          {CHANNEL_LABELS.map((c) => (
            <MicroLabel
              key={c.key}
              as="span"
              bold
              className={cn(
                "text-center uppercase",
                emailsOff && EMAIL_CHANNELS.has(c.key) && "line-through opacity-50",
              )}
            >
              {c.label}
            </MicroLabel>
          ))}
        </div>
        {NOTIFICATION_TYPES.map((type) => {
          const pref = byType.get(type);
          if (!pref) return null;
          return (
            <div key={type} className={cn(MATRIX_GRID, "items-center py-3")}>
              <Text size="xs">{NOTIFICATION_TYPE_LABEL[type]}</Text>
              {CHANNEL_LABELS.map((c) => {
                const overridden = emailsOff && EMAIL_CHANNELS.has(c.key);
                return (
                  <div
                    key={c.key}
                    className={cn("flex justify-center", overridden && "opacity-40")}
                  >
                    <Checkbox
                      checked={pref[c.key]}
                      disabled={overridden}
                      onCheckedChange={(checked) =>
                        update({ type, [c.key]: !!checked } satisfies UpdateVars)
                      }
                      aria-label={`${c.label} for ${type}`}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </Well>
    </div>
  );
}
