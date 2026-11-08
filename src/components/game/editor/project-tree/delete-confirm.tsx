import { HugeiconsIcon } from "@hugeicons/react";
import type { AssetEntry, Referrer } from "@jams/engine/project";

import { Confirm } from "@/components/ui/confirm";

import { kindIcon } from "./kind-icons";
import { baseName } from "./tree-rows";

export type PendingDelete = { entry: AssetEntry; referrers: readonly Referrer[] };

function ReferrerList({ referrers }: { referrers: readonly Referrer[] }) {
  return (
    <>
      <p>
        {referrers.length === 1 ? "One reference names" : `${referrers.length} references name`} it.
        Deleting it leaves them pointing at the trash until it's restored.
      </p>
      <ul aria-label="Used by" className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {referrers.map((r) => (
          <li key={`${r.id}${r.pointer}`} className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon icon={kindIcon(r.kind)} className="size-3.5 shrink-0" />
            <span className="truncate text-foreground">{r.id}</span>
            <span className="truncate">{r.pointer}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Moving an asset to the trash through the shared confirm. With referrers
 * it's the in-use variant: it lists them and its action is "Delete anyway".
 */
export function DeleteConfirm({
  pending,
  onConfirm,
  onClose,
}: {
  pending: PendingDelete | null;
  onConfirm: (pending: PendingDelete) => Promise<void>;
  onClose: () => void;
}) {
  const name = pending ? baseName(pending.entry.path) : "";
  const inUse = (pending?.referrers.length ?? 0) > 0;
  return (
    <Confirm
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="destructive"
      title={inUse ? `${name} is in use` : `Move ${name} to the trash?`}
      message={
        inUse && pending ? (
          <ReferrerList referrers={pending.referrers} />
        ) : (
          "You can restore it from the Trash."
        )
      }
      confirmText={inUse ? "Delete anyway" : "Move to trash"}
      onConfirm={() => (pending ? onConfirm(pending) : undefined)}
    />
  );
}
