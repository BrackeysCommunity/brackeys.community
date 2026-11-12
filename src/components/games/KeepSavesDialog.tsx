import type { SaveLimits, SaveStore, SaveSummary } from "@jams/engine";
import { useEffect, useRef, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Confirm } from "@/components/ui/confirm";
import { TimeAgo } from "@/components/ui/time-ago";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { MicroLabel, Text } from "@/components/ui/typography";
import { claimSaves, planClaim, type ClaimRow } from "@/lib/engine/claim-saves";
import { SITE_SAVE_LIMITS } from "@/lib/engine/limits";
import { formatDate } from "@/lib/format-date";
import { toast } from "@/lib/toast";

/** Where a decline is remembered: this tab, for the sign-in that declined. */
export const keepSavesDeclinedKey = (projectId: string): string =>
  `jams-play:${projectId}:keep-saves-declined`;

export const REPLACE_ACCOUNT_SAVE = "Replace the account's save";

function declined(projectId: string, signIn: string): boolean {
  try {
    return globalThis.sessionStorage.getItem(keepSavesDeclinedKey(projectId)) === signIn;
  } catch {
    return false;
  }
}

function decline(projectId: string, signIn: string): void {
  try {
    globalThis.sessionStorage.setItem(keepSavesDeclinedKey(projectId), signIn);
  } catch {
    // Storage that refuses means the prompt comes back on the next load.
  }
}

const limitsOf = (store: SaveStore): SaveLimits => ({ ...SITE_SAVE_LIMITS, ...store.limits });

const saveTitle = (save: SaveSummary): string => save.meta.title?.trim() || `Slot ${save.slot}`;

const utcDate = (ms: number): string =>
  `${formatDate(new Date(ms), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} UTC`;

function SavedAt({ label, save }: { label: string; save: SaveSummary }) {
  const date = new Date(save.meta.savedAt);
  return (
    <SimpleTooltip content={utcDate(save.meta.savedAt)}>
      <time dateTime={date.toISOString()}>
        {label} <TimeAgo date={date} />
      </time>
    </SimpleTooltip>
  );
}

type Row = ClaimRow & { message?: string };

function ClaimRowItem({ row, onTick }: { row: Row; onTick: (ticked: boolean) => void }) {
  const id = `keep-save-${row.slot}`;
  return (
    <li className="flex items-start gap-3 py-2">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={row.ticked}
        onCheckedChange={(checked) => onTick(!!checked)}
      />
      <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Text size="sm" className="truncate">
          {saveTitle(row.local)}
        </Text>
        <MicroLabel as="span" className="flex flex-wrap gap-x-2">
          <span className="truncate">Scene {row.local.meta.scene}</span>
          <span aria-hidden>·</span>
          <SavedAt label={row.account ? "This browser" : "Saved"} save={row.local} />
          {row.account ? (
            <>
              <span aria-hidden>·</span>
              <SavedAt label="Your account" save={row.account} />
            </>
          ) : null}
        </MicroLabel>
        {row.collides ? (
          <Text size="xs" variant="warning">
            {REPLACE_ACCOUNT_SAVE}
          </Text>
        ) : null}
        {row.message ? (
          <Text size="xs" variant="danger" role="alert">
            {row.message}
          </Text>
        ) : null}
      </label>
    </li>
  );
}

export type KeepSavesDialogProps = {
  projectId: string;
  /** The release's game id, as the stores are called with. */
  gameId: string;
  /** The game's title, for the dialog's sentence. */
  title: string;
  /** This sign-in's id: a decline holds until the next sign-in. */
  signIn: string;
  /** This browser's saves for the project. */
  local: SaveStore;
  /** The account's saves for the project. */
  site: SaveStore;
  /** Some saves reached the account; the host tells the frame. */
  onClaimed: () => void;
};

/**
 * "Keep your saves": once signed in, offers this browser's saves for the
 * project to the account. Declining keeps them here and asks again on the
 * next sign-in.
 */
export function KeepSavesDialog({
  projectId,
  gameId,
  title,
  signIn,
  local,
  site,
  onClaimed,
}: KeepSavesDialogProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const [free, setFree] = useState(0);
  const finished = useRef(false);

  useEffect(() => {
    if (declined(projectId, signIn)) return;
    let live = true;
    void (async () => {
      const mine = await local.list(gameId);
      if (!live || mine.length === 0) return;
      const theirs = await site.list(gameId);
      if (!live) return;
      const limits = limitsOf(site);
      finished.current = false;
      setFree(Math.max(0, limits.maxSlots - theirs.length));
      setRows(planClaim(mine, theirs, limits));
      setOpen(true);
    })();
    return () => {
      live = false;
    };
  }, [projectId, gameId, signIn, local, site]);

  if (!rows) return null;
  const ticked = rows.filter((row) => row.ticked).length;
  const maxSlots = limitsOf(site).maxSlots;

  const tick = (slot: string, next: boolean) =>
    setRows((current) =>
      (current ?? []).map((row) => (row.slot === slot ? { ...row, ticked: next } : row)),
    );

  const keep = async () => {
    const results = await claimSaves(rows, local, site, gameId);
    const refused = new Map<string, string>();
    let kept = 0;
    for (const result of results) {
      if (result.ok) kept += 1;
      else refused.set(result.slot, result.message);
    }
    if (kept > 0) onClaimed();
    if (refused.size === 0) {
      finished.current = true;
      toast.success(
        kept === 1 ? "Your save is on your account." : "Your saves are on your account.",
      );
      return;
    }
    const uploaded = new Set(results.filter((r) => r.ok).map((r) => r.slot));
    setFree((n) => Math.max(0, n - kept));
    setRows(
      rows
        .filter((row) => !uploaded.has(row.slot))
        .map((row) => {
          const message = refused.get(row.slot);
          return message === undefined ? row : { ...row, ticked: false, message };
        }),
    );
    // Keeps the dialog open on the refused saves, each with its reason.
    throw new Error("Some saves stayed in this browser.");
  };

  return (
    <Confirm
      open={open}
      onOpenChange={(next) => {
        if (!next && !finished.current) decline(projectId, signIn);
        setOpen(next);
      }}
      title="Keep your saves?"
      message={
        <>
          <p>
            This browser holds saves for {title}. The ticked ones move to your account, which has
            room for {free} more of {maxSlots}; the rest stay in this browser.
          </p>
          <ul aria-label="Saves in this browser" className="divide-y divide-border">
            {rows.map((row) => (
              <ClaimRowItem key={row.slot} row={row} onTick={(next) => tick(row.slot, next)} />
            ))}
          </ul>
        </>
      }
      confirmText={ticked === 1 ? "Keep 1 save" : `Keep ${ticked} saves`}
      cancelText="Not now"
      confirmDisabled={ticked === 0}
      onConfirm={keep}
    />
  );
}
