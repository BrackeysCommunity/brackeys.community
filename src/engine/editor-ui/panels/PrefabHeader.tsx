import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useSyncExternalStore } from "react";

import type { EditorSession } from "../../editor/index";
import { Island } from "../frame/EditorFrame";
import { Button } from "../kit/index";
import { useBusy } from "../pending/use-pending";
import {
  createVariantTask,
  openPrefabTask,
  PREFAB_HEADER_SCOPE,
  type OpenPrefabLink,
} from "../session/live-scene-editor";

/**
 * Where the editor is while a prefab is open on its own, one row in the
 * frame's context: the way back, the variant's base, and Create variant.
 * Opening the base and creating a variant show busy on their own button
 * until the prefab is open.
 */
export function PrefabHeader({
  session,
  id,
  scene,
  onBack,
  onOpen,
  onCreateVariant,
}: OpenPrefabLink & { session: EditorSession }) {
  const base = useSyncExternalStore(
    (changed) => session.prefabs.subscribe(changed),
    () => session.getPrefabs().get(id)?.base,
  );
  const task = useBusy(PREFAB_HEADER_SCOPE);
  const creating = task?.id === createVariantTask(id);
  const openingBase = base !== undefined && task?.id === openPrefabTask(base);
  return (
    <Island className="je-prefab-header">
      <Button
        size="xs"
        variant="ghost"
        icon={ArrowLeft01Icon}
        tooltip={`Back to ${scene}`}
        onClick={onBack}
      >
        Back
      </Button>
      <nav aria-label="Breadcrumb" className="je-prefab-crumb">
        <span data-tone="muted">{scene}</span>
        <span className="je-prefab-crumb-sep" data-tone="muted">
          ›
        </span>
        <span className="je-prefab-crumb-id">{id}</span>
      </nav>
      {base !== undefined ? (
        <span className="je-prefab-variant">
          <span className="je-prefab-variant-of" data-tone="muted">
            Variant of
          </span>
          <Button
            size="xs"
            variant="link"
            className="je-prefab-base"
            tooltip={`Open ${base}`}
            disabled={!onOpen}
            busy={openingBase}
            onClick={() => onOpen?.(base)}
          >
            {base}
          </Button>
        </span>
      ) : null}
      {onCreateVariant ? (
        <Button
          size="xs"
          variant="outline"
          className="je-prefab-create"
          tooltip={`A new prefab based on ${id}, which keeps following it`}
          busy={creating}
          onClick={onCreateVariant}
        >
          Create variant
        </Button>
      ) : null}
    </Island>
  );
}
