import type { EngineContext, RegisteredType } from "../game/types";
import { nodePose } from "../runtime/spawn-pose";
import type { Pt, RuntimeEntity } from "../scene/types";
import { createDataSystem, type DataSystem } from "./data";

export type NodeEntity = RuntimeEntity<{ at: Pt; rot?: number }>;

export type NodeSystem = DataSystem<NodeEntity>;

/** Poses with nothing else: parents that move, hide and destroy what sits under them. */
export function createNodeSystem(ctx: EngineContext, type: RegisteredType): NodeSystem {
  const data = createDataSystem<NodeEntity>(ctx, type);
  const place = (e: NodeEntity) => {
    const p = nodePose(e);
    ctx.poses.set(e.id, p.x, p.y, p.rot, { snap: true });
  };
  return {
    ...data,
    spawn(e) {
      data.spawn(e);
      place(e);
    },
    update(e, prev) {
      data.update?.(e, prev);
      place(e);
    },
  };
}
