import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { MicroLabel } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { NotificationType } from "@/db/schema";
import { NOTIFICATION_TYPE_LABEL, NOTIFICATION_TYPES } from "@/lib/notification-copy";
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
    onError: (_err, _vars, ctx) => {
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
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: PreferencesData } | undefined)?.prev;
      if (prev) queryClient.setQueryData(queryKey, prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="border border-muted/30 bg-card/40 px-4 py-12 text-center text-xs text-muted-foreground">
        Loading preferences…
      </div>
    );
  }

  const byType = new Map(data.preferences.map((p) => [p.type, p]));
  const emailsOff = data.emailsDisabled;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">
        Choose how you hear about each kind of activity. <strong>In-app</strong> shows in the bell
        and inbox. <strong>Email</strong> sends a transactional email (suppressed while you're
        actively online). <strong>Digest</strong> bundles into a weekly Monday email.
      </p>

      <div className="flex items-center gap-4 border border-muted/30 bg-card/40 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <MicroLabel as="span" bold className="uppercase">
            Email notifications
          </MicroLabel>
          <span className="text-[11px] text-muted-foreground">
            {emailsOff
              ? "All notification email is off. Turn it back on to resume — check your per-event choices below."
              : "Master switch. Turning this off stops every notification and digest email — account and security mail still comes through."}
          </span>
        </div>
        <Switch
          checked={!emailsOff}
          onCheckedChange={(checked) => setEmailsEnabled(!!checked)}
          aria-label="Email notifications"
        />
      </div>

      <div className="border border-muted/30 bg-card/40">
        <div className="grid grid-cols-[1fr_repeat(3,minmax(0,5rem))] gap-2 border-b border-muted/40 px-4 py-2">
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
            <div
              key={type}
              className="grid grid-cols-[1fr_repeat(3,minmax(0,5rem))] items-center gap-2 border-b border-muted/30 px-4 py-3 last:border-b-0"
            >
              <span className="text-xs text-foreground/90">{NOTIFICATION_TYPE_LABEL[type]}</span>
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
      </div>
      <BlockedUsersList />
    </div>
  );
}

/**
 * Members the viewer has blocked — their comments are hidden and
 * notifications suppressed both ways. Lives with the notification
 * preferences because that's the "who can reach me" settings surface.
 */
function BlockedUsersList() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["listBlockedUsers"],
    queryFn: () => client.listBlockedUsers({}),
  });

  const { mutate: unblock, isPending } = useMutation({
    mutationFn: (userId: string) => client.unblockUser({ userId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["listBlockedUsers"] });
      void queryClient.invalidateQueries({ queryKey: ["listComments"] });
    },
  });

  if (!data || data.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <MicroLabel as="p" bold className="uppercase">
        Blocked members
      </MicroLabel>
      <div className="border border-muted/30 bg-card/40">
        {data.map((row) => (
          <div
            key={row.userId}
            className="flex items-center gap-3 border-b border-muted/30 px-4 py-2.5 last:border-b-0"
          >
            <UserAvatar
              avatarUrl={row.user?.avatarUrl ?? null}
              username={row.user?.name}
              size={24}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">
              {row.user?.name ?? "Deleted User"}
            </span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => unblock(row.userId)}
              disabled={isPending}
              className="tracking-widest"
            >
              UNBLOCK
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
