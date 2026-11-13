import { Delete02Icon, Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { zipFiles } from "@jams/engine/export";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Empty } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { authClient } from "@/lib/auth-client";
import { downloadBlob } from "@/lib/download";
import {
  SITE_SAVE_ACCOUNT_BYTES,
  SITE_SAVE_EXPIRY_DAYS,
  SITE_SAVE_LIMITS,
} from "@/lib/engine/limits";
import { usageLevel } from "@/lib/engine/quota";
import type { AccountGameSaves, AccountSave } from "@/lib/engine/save-api";
import { SaveTime, saveTitle } from "@/lib/engine/save-labels";
import { deleteAccountSave, fetchAccountSaves, fetchSaveText } from "@/lib/engine/save-store";
import { formatBytes } from "@/lib/format-bytes";
import { SITE } from "@/lib/legal-meta";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useGameSavesSettings } from "./settings-tabs";
import { SettingsSection, SignedOutNotice } from "./SettingsUI";

/** The rule stated at the top of Settings → Game saves. */
export const GAME_SAVES_SETTINGS_RULE = `Games on ${SITE.name} can save to your account: up to ${SITE_SAVE_LIMITS.maxSlots} saves of ${formatBytes(SITE_SAVE_LIMITS.maxBytes)} per game, ${formatBytes(SITE_SAVE_ACCOUNT_BYTES)} in all. A save you don't load, overwrite or open the game's save menu for in ${SITE_SAVE_EXPIRY_DAYS} days is deleted. Saves made while signed out stay in that browser and aren't listed here.`;

export const ACCOUNT_SAVES_QUERY_KEY = ["engine-account-saves"] as const;

/** The zip "Download my saves" offers. */
export const SAVES_ZIP_NAME = "game-saves.zip";

/** Where a save sits inside the download. */
export const saveZipPath = (projectId: string, slot: string): string =>
  `${projectId}/${slot}.save.json`;

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

/** The route's pane: the section while hosted games are on, else the 404. */
export function GameSavesPage() {
  return useGameSavesSettings() ? <GameSaves /> : <NotFoundPage />;
}

export function GameSaves() {
  const { data: session, isPending } = authClient.useSession();
  const signedIn = session?.user != null;

  return (
    <SettingsSection index="01" title="Game saves" hint={GAME_SAVES_SETTINGS_RULE}>
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : signedIn ? (
        <AccountSavesList />
      ) : (
        <SignedOutNotice>Sign in to see the saves games keep on your account.</SignedOutNotice>
      )}
    </SettingsSection>
  );
}

function AccountSavesList() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ACCOUNT_SAVES_QUERY_KEY,
    queryFn: () => fetchAccountSaves(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ACCOUNT_SAVES_QUERY_KEY });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Well variant="ghost" className="items-center gap-3 p-10">
        <Text size="sm" variant="muted" align="center">
          Your saves didn't load.
        </Text>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </Well>
    );
  }

  const ratio = data.maxBytes > 0 ? data.usedBytes / data.maxBytes : 0;
  const percent = Math.min(100, ratio * 100);
  const level = usageLevel(ratio);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <MicroLabel as="span" className="uppercase">
            {formatBytes(data.usedBytes)} of {formatBytes(data.maxBytes)} used
          </MicroLabel>
          <Progress
            value={percent}
            data-level={level}
            className={cn(BAR_TONE[level])}
            aria-label={`Saves use ${formatBytes(data.usedBytes)} of ${formatBytes(data.maxBytes)}`}
          />
        </div>
        <DownloadSaves games={data.games} />
      </div>

      {data.games.length === 0 ? (
        <Empty>No games have saved to your account yet.</Empty>
      ) : (
        data.games.map((game) => (
          <GameSavesCard key={game.projectId} game={game} onChange={refresh} />
        ))
      )}
    </div>
  );
}

/** The bar turns amber from the quotas' warning share and red once full. */
const BAR_TONE = {
  ok: "",
  warn: "[&_[data-slot=progress-indicator]]:bg-warning",
  full: "[&_[data-slot=progress-indicator]]:bg-destructive",
} as const;

function DownloadSaves({ games }: { games: readonly AccountGameSaves[] }) {
  const [busy, setBusy] = useState(false);
  const count = games.reduce((n, game) => n + game.saves.length, 0);

  const download = async () => {
    setBusy(true);
    try {
      const encoder = new TextEncoder();
      const wanted = games.flatMap((game) =>
        game.saves.map((save) => ({ projectId: game.projectId, slot: save.slot })),
      );
      const texts = await Promise.all(
        wanted.map(({ projectId, slot }) =>
          fetchSaveText(projectId, slot).then(
            (text) => text,
            () => null,
          ),
        ),
      );
      const files = wanted.flatMap(({ projectId, slot }, i) => {
        const text = texts[i];
        return text == null
          ? []
          : [{ path: saveZipPath(projectId, slot), bytes: encoder.encode(text) }];
      });
      if (files.length === 0) {
        toast.error("Your saves didn't download. Try again.");
        return;
      }
      downloadBlob(
        SAVES_ZIP_NAME,
        new Blob([zipFiles(files) as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
      );
      const missed = wanted.length - files.length;
      if (missed > 0) {
        toast.warning(
          `Downloaded ${files.length} of ${wanted.length} saves. ${missed === 1 ? "One" : missed} didn't load.`,
        );
      } else {
        toast.success(
          files.length === 1 ? "Downloaded your save." : `Downloaded ${files.length} saves.`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy || count === 0}
      aria-busy={busy || undefined}
      onClick={() => void download()}
    >
      {busy ? (
        <Spinner data-icon="inline-start" className="size-3.5" />
      ) : (
        <HugeiconsIcon icon={Download01Icon} data-icon="inline-start" />
      )}
      {busy ? "Preparing…" : "Download my saves"}
    </Button>
  );
}

function GameSavesCard({ game, onChange }: { game: AccountGameSaves; onChange: () => unknown }) {
  const bytes = game.saves.reduce((n, save) => n + save.bytes, 0);

  const deleteAll = async () => {
    let failed = 0;
    let lastError: unknown;
    for (const save of game.saves) {
      try {
        await deleteAccountSave(game.projectId, save.slot);
      } catch (error) {
        failed++;
        lastError = error;
      }
    }
    await onChange();
    if (failed === 0) toast.success(`Deleted your saves for ${game.title}.`);
    else
      toast.error(
        `${failed} of ${game.saves.length} saves for ${game.title} weren't deleted. ${errorText(lastError, "Try again.")}`,
      );
  };

  return (
    <Well variant="ghost" className="gap-0 p-0" aria-label={game.title} role="region">
      <div className="flex items-center gap-3 border-b border-dashed border-muted/40 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Text size="sm" className="truncate font-medium">
            {game.title}
          </Text>
          <MicroLabel as="span">
            {game.saves.length === 1 ? "1 save" : `${game.saves.length} saves`} ·{" "}
            {formatBytes(bytes)}
          </MicroLabel>
        </div>
        <Confirm
          title={`Delete every save for ${game.title}?`}
          message={`${game.saves.length === 1 ? "Its save is" : `All ${game.saves.length} saves are`} removed from your account. This can't be undone.`}
          confirmText="Delete all"
          variant="destructive"
          onConfirm={deleteAll}
        >
          <Button variant="ghost" size="sm" className="text-destructive">
            <HugeiconsIcon icon={Delete02Icon} data-icon="inline-start" />
            Delete all
          </Button>
        </Confirm>
      </div>
      <ul className="divide-y divide-dashed divide-muted/40">
        {game.saves.map((save) => (
          <SaveRow key={save.slot} game={game} save={save} onChange={onChange} />
        ))}
      </ul>
    </Well>
  );
}

function SaveRow({
  game,
  save,
  onChange,
}: {
  game: AccountGameSaves;
  save: AccountSave;
  onChange: () => unknown;
}) {
  const title = saveTitle(save.meta, save.slot);

  const remove = async () => {
    try {
      await deleteAccountSave(game.projectId, save.slot);
      toast.success(`Deleted “${title}”.`);
    } catch (error) {
      toast.error(errorText(error, `“${title}” wasn't deleted. Try again.`));
    }
    await onChange();
  };

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Text size="sm" className="truncate">
          {title}
        </Text>
        <MicroLabel as="span" className="flex flex-wrap gap-x-2">
          <span>{formatBytes(save.bytes)}</span>
          <span aria-hidden>·</span>
          <SaveTime label="Last used" date={save.usedAt} showDay />
        </MicroLabel>
      </div>
      <Confirm
        title={`Delete “${title}”?`}
        message={`This save for ${game.title} is removed from your account. This can't be undone.`}
        confirmText="Delete"
        variant="destructive"
        onConfirm={remove}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${title}`}
          tooltip="Delete this save"
          className="text-destructive"
        >
          <HugeiconsIcon icon={Delete02Icon} />
        </Button>
      </Confirm>
    </li>
  );
}
