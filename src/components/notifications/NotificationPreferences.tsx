import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Checkbox } from "@/components/ui/checkbox";
import type { NotificationType } from "@/db/schema";
import { NOTIFICATION_TYPE_LABEL, NOTIFICATION_TYPES } from "@/lib/notification-copy";
import { client, orpc } from "@/orpc/client";

type Preference = {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
  digest: boolean;
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

export function NotificationPreferences() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(orpc.getPreferences.queryOptions({ input: {} }));

  const { mutate: update } = useMutation({
    mutationFn: (vars: UpdateVars) => client.updatePreference(vars),
    onMutate: async (vars) => {
      const queryKey = orpc.getPreferences.queryOptions({ input: {} }).queryKey;
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<{ preferences: Preference[] }>(queryKey);
      if (prev) {
        queryClient.setQueryData<{ preferences: Preference[] }>(queryKey, {
          preferences: prev.preferences.map((p) => (p.type === vars.type ? { ...p, ...vars } : p)),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: { preferences: Preference[] } } | undefined)?.prev;
      if (prev) {
        queryClient.setQueryData(orpc.getPreferences.queryOptions({ input: {} }).queryKey, prev);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.getPreferences.queryOptions({ input: {} }).queryKey,
      });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="border border-muted/30 bg-card/40 px-4 py-12 text-center font-mono text-xs text-muted-foreground">
        Loading preferences…
      </div>
    );
  }

  const byType = new Map(data.preferences.map((p) => [p.type, p]));

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[11px] text-muted-foreground">
        Choose how you hear about each kind of activity. <strong>In-app</strong> shows in the bell
        and inbox. <strong>Email</strong> sends a transactional email (suppressed while you're
        actively online). <strong>Digest</strong> bundles into a weekly Monday email.
      </p>
      <div className="border border-muted/30 bg-card/40">
        <div className="grid grid-cols-[1fr_repeat(3,minmax(0,5rem))] gap-2 border-b border-muted/40 px-4 py-2 font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
          <span>Event</span>
          {CHANNEL_LABELS.map((c) => (
            <span key={c.key} className="text-center">
              {c.label}
            </span>
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
              {CHANNEL_LABELS.map((c) => (
                <div key={c.key} className="flex justify-center">
                  <Checkbox
                    checked={pref[c.key]}
                    onCheckedChange={(checked) =>
                      update({ type, [c.key]: !!checked } satisfies UpdateVars)
                    }
                    aria-label={`${c.label} for ${type}`}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
