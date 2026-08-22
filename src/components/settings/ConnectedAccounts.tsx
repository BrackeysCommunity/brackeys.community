import { DiscordIcon, GithubIcon, Link01Icon, UnavailableIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { openConfirmModal } from "@/components/ui/confirm";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { authClient } from "@/lib/auth-client";
import { timeAgo } from "@/lib/format-time";
import { toastMutationError } from "@/lib/mutation-errors";
import { toast } from "@/lib/toast";

/**
 * The OAuth identities that can *sign you in*, which is a different list
 * from the profile integrations on `/profile` (those hold provider tokens
 * for project and jam sync). Both can name GitHub; only this one decides
 * whether the sign-in button works.
 */
const PROVIDERS: {
  id: "discord" | "github";
  label: string;
  icon: IconSvgElement;
  hint: string;
  /** Discord carries guild membership, staff roles, and the avatar sync —
   *  unlinking it would leave a signed-in account with no role source, so
   *  it is offered as a connection, never as something to remove. */
  unlinkable: boolean;
}[] = [
  {
    id: "discord",
    label: "Discord",
    icon: DiscordIcon,
    hint: "Your identity here — guild membership, roles, and avatar sync all read from it.",
    unlinkable: false,
  },
  {
    id: "github",
    label: "GitHub",
    icon: GithubIcon,
    hint: "A second way in. Link it and either provider signs you into the same account.",
    unlinkable: true,
  },
];

export function ConnectedAccounts() {
  const queryClient = useQueryClient();
  const queryKey = ["auth", "accounts"];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts();
      if (error) throw new Error(error.message ?? "Could not load connections");
      return data;
    },
  });

  const { mutate: link, isPending: linking } = useMutation({
    mutationFn: async (provider: "discord" | "github") => {
      const { error } = await authClient.linkSocial({
        provider,
        callbackURL: "/settings/account",
      });
      if (error) throw new Error(error.message ?? "Could not start linking");
    },
    // No success path to handle — a successful call redirects to the
    // provider and the browser leaves this page.
    onError: toastMutationError("settings.link_account"),
  });

  const { mutate: unlink, isPending: unlinking } = useMutation({
    mutationFn: async ({ providerId, accountId }: { providerId: string; accountId: string }) => {
      const { error } = await authClient.unlinkAccount({ providerId, accountId });
      if (error) throw new Error(error.message ?? "Could not disconnect");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      toast.success("Disconnected");
    },
    onError: toastMutationError("settings.unlink_account"),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[4.5rem] w-full" />
        <Skeleton className="h-[4.5rem] w-full" />
      </div>
    );
  }

  const linked = new Map((data ?? []).map((a) => [a.providerId, a]));

  return (
    <div className="flex flex-col gap-3">
      {PROVIDERS.map((provider) => {
        const account = linked.get(provider.id);
        // better-auth refuses to unlink the last credential, and it is the
        // right refusal — mirror it here so the button never lies.
        const canUnlink = provider.unlinkable && account != null && linked.size > 1;

        return (
          <Well key={provider.id} className="flex-row flex-wrap items-center gap-4 p-4">
            <HugeiconsIcon
              icon={provider.icon}
              size={20}
              className={account ? "text-foreground" : "text-muted-foreground"}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Text size="xs" className="tracking-widest uppercase">
                  {provider.label}
                </Text>
                {account ? (
                  <Badge size="label" variant="outline">
                    CONNECTED
                  </Badge>
                ) : null}
              </div>
              <Text size="xs" variant="muted">
                {account ? `Connected ${timeAgo(account.createdAt)}` : provider.hint}
              </Text>
            </div>

            {account ? (
              canUnlink ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="tracking-widest text-destructive"
                  disabled={unlinking}
                  onClick={async () => {
                    const ok = await openConfirmModal({
                      title: `Disconnect ${provider.label}?`,
                      message: `You'll no longer be able to sign in with ${provider.label}. Your account and everything on it stays.`,
                      confirmText: "Disconnect",
                      variant: "destructive",
                    });
                    if (ok) {
                      unlink({ providerId: provider.id, accountId: account.accountId });
                    }
                  }}
                >
                  <HugeiconsIcon icon={UnavailableIcon} size={14} />
                  DISCONNECT
                </Button>
              ) : null
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="tracking-widest"
                disabled={linking}
                onClick={() => link(provider.id)}
              >
                <HugeiconsIcon icon={Link01Icon} size={14} />
                CONNECT
              </Button>
            )}
          </Well>
        );
      })}
    </div>
  );
}
