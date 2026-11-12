import type { ColliderTag, ColliderTags } from "./game/types";

export type { ColliderTag, ColliderTags };

export function createColliderTags(): ColliderTags {
  const byHandle = new Map<number, ColliderTag>();
  const byEntity = new Map<string, Set<number>>();

  function unindex(handle: number, entityId: string): void {
    const handles = byEntity.get(entityId);
    if (!handles) return;
    handles.delete(handle);
    if (handles.size === 0) byEntity.delete(entityId);
  }

  return {
    set(handle, tag) {
      const prev = byHandle.get(handle);
      if (prev) unindex(handle, prev.entityId);
      byHandle.set(handle, tag);
      let handles = byEntity.get(tag.entityId);
      if (!handles) {
        handles = new Set();
        byEntity.set(tag.entityId, handles);
      }
      handles.add(handle);
    },
    get(handle) {
      return byHandle.get(handle);
    },
    delete(handle) {
      const prev = byHandle.get(handle);
      if (!prev) return;
      byHandle.delete(handle);
      unindex(handle, prev.entityId);
    },
    clear() {
      byHandle.clear();
      byEntity.clear();
    },
    get size() {
      return byHandle.size;
    },
    handlesOf(entityId) {
      return [...(byEntity.get(entityId) ?? [])];
    },
  };
}
