import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useSyncExternalStore } from "react";

import type { EditorSession } from "../../editor/index";
import { Island } from "../frame/EditorFrame";
import { Button } from "../kit/index";
import type { OpenPrefabLink } from "../session/live-scene-editor";

/** Where the editor is while a prefab is open on its own: the way back, the variant's base, and Create variant. */
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
  return (
    <Island className="je-prefab-header">
      <div className="je-prefab-header-row">
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
      </div>
      {base !== undefined || onCreateVariant ? (
        <div className="je-prefab-header-row" data-size="sm">
          {base !== undefined ? (
            <>
              <span className="je-prefab-variant-of" data-tone="muted">
                Variant of
              </span>
              <Button
                size="xs"
                variant="link"
                className="je-prefab-base"
                tooltip={`Open ${base}`}
                disabled={!onOpen}
                onClick={() => onOpen?.(base)}
              >
                {base}
              </Button>
            </>
          ) : null}
          {onCreateVariant ? (
            <Button
              size="xs"
              variant="outline"
              className="je-prefab-create"
              tooltip={`A new prefab based on ${id}, which keeps following it`}
              onClick={onCreateVariant}
            >
              Create variant
            </Button>
          ) : null}
        </div>
      ) : null}
    </Island>
  );
}
