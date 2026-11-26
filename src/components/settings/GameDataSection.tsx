import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { Button } from "@/components/ui/button";
import { openConfirmModal } from "@/components/ui/confirm";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import type { GameDataStatus } from "@/lib/mmo-forget";
import { toast } from "@/lib/toast";

import type { ForgetReply } from "../../../packages/mmo-api/src/index.ts";
import { SettingsSection } from "./SettingsUI";

const HIDDEN: GameDataStatus = { shown: false };

async function sessionUserId(): Promise<string | undefined> {
  const { auth } = await import("@/lib/auth");
  const session = await auth.api.getSession({ headers: getRequest().headers }).catch(() => null);
  return session?.user.id;
}

/** The privacy page's gate: anything unreadable hides the section rather than failing the page. */
export const loadGameDataStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<GameDataStatus> => {
    try {
      const { gameDataStatus } = await import("@/lib/mmo-forget");
      return await gameDataStatus(await sessionUserId());
    } catch {
      return HIDDEN;
    }
  },
);

export const forgetMyGameData = createServerFn({ method: "POST" }).handler(
  async (): Promise<ForgetReply> => {
    const userId = await sessionUserId();
    if (!userId) throw new Error("Sign in to forget your game data");
    const { forgetUserGameData } = await import("@/lib/mmo-forget");
    return forgetUserGameData(userId);
  },
);

/**
 * Forgetting the game's hold on the player without deleting the account
 * (GDD 14.9). Shown only when the world can be asked and a Discord account
 * keys a character there.
 */
export function GameDataSection({ status, index }: { status: GameDataStatus; index: string }) {
  const { mutate: forget, isPending } = useMutation({
    mutationFn: () => forgetMyGameData(),
    onSuccess: (reply) =>
      reply.forgotten
        ? toast.success("Your character is forgotten", {
            description: "Your Discord id is gone from the world; your deeds stay as a traveller.",
          })
        : toast("The world holds no character for your Discord account"),
    onError: () =>
      toast.error("Your game data was not forgotten", {
        description: "The game world did not answer. Nothing changed; try again in a few minutes.",
      }),
  });

  if (!status.shown) return null;

  return (
    <SettingsSection
      index={index}
      title="Game data"
      hint="The Discord game keeps your Discord user id, your character and what it does, and the words you type to its bot. Forgetting removes your id from the world at once and returns your character's goods and coin to it; the deeds stay, shown as a traveller."
    >
      <Well className="flex-row items-center gap-4 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <MicroLabel as="p" className="uppercase">
            Cannot be undone
          </MicroLabel>
          <Text size="xs" variant="muted">
            Your account here stays. Playing again later starts a new character.
          </Text>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="tracking-widest"
          disabled={isPending}
          tooltip="Forget your character in the game world"
          onClick={async () => {
            const ok = await openConfirmModal({
              title: "Forget your game data?",
              message:
                "Your character stops for good: its goods and coin go back to the world and its deeds are shown as a traveller's. This cannot be undone.",
              confirmText: "Forget me",
              variant: "destructive",
            });
            if (ok) forget();
          }}
        >
          <HugeiconsIcon icon={Delete02Icon} size={14} />
          FORGET ME
        </Button>
      </Well>
    </SettingsSection>
  );
}
