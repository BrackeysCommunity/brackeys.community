import type { AssetEntry, Referrer } from "../../../project/index";
import { Confirm } from "../../kit/confirm";
import { Icon } from "../../kit/icon";
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
      <ul aria-label="Used by" className="je-ptree-referrers">
        {referrers.map((r) => (
          <li key={`${r.id}${r.pointer}`}>
            <Icon icon={kindIcon(r.kind)} />
            <span className="je-ptree-name je-ptree-strong">{r.id}</span>
            <span className="je-ptree-name">{r.pointer}</span>
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
