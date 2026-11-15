import type { Registry } from "../game/types";
import { sameValue } from "../project/canonical";
import { byCodeUnit, isPlainObject } from "../project/kinds/define";
import { SOUND_KIND, type SoundFile, type SoundMatcher } from "../project/kinds/sound";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId } from "../project/types";
import type { StepEvent } from "../runtime/types";
import { entityTags, tagFieldsOf } from "../scene/schema";
import type { RuntimeEntity } from "../scene/types";
import type { Vec2 } from "../types";

/** What a `type` or `tag` matcher reads of an event's entity. */
export type TriggerEntity = { type: string; tags: ReadonlySet<string> };

/** Which sounds a step event plays: every sound doc's `on` matchers, in sound-id order. */
export type SoundTriggers = {
  /** Each sound at most once, however many of its matchers the event meets. */
  match(event: StepEvent): readonly AssetId[];
};

const NONE: readonly AssetId[] = Object.freeze([]);

/** A matcher's view of the entities `lookup` finds: each one's type and its tag fields' tags. */
export function triggerEntityOf(
  registry: Pick<Registry, "types">,
  lookup: (id: string) => RuntimeEntity | undefined,
): (id: string) => TriggerEntity | undefined {
  return (id) => {
    const e = lookup(id);
    return e
      ? { type: e.type, tags: entityTags(e, tagFieldsOf(registry.types.get(e.type))) }
      : undefined;
  };
}

/** Where a sound an event triggered plays from: the event's entity, if it names one, and its point. */
export function triggerSource(event: StepEvent): { entity?: string; at: Vec2 } {
  const at = { x: event.at.x, y: event.at.y };
  return event.entityId !== undefined ? { entity: event.entityId, at } : { at };
}

/**
 * The trigger index over a project's sound docs. `entity` answers a
 * matcher's `type` and `tag`, so it must still know an entity the event's
 * tick removed; without it, or for an event with no entity, those matchers
 * never match.
 */
export function soundTriggers(
  project: ProjectRuntimeView,
  entity?: (id: string) => TriggerEntity | undefined,
): SoundTriggers {
  const byEvent = new Map<string, { sound: AssetId; matchers: SoundMatcher[] }[]>();
  const ids = [...(project.docs?.(SOUND_KIND) ?? [])].sort(byCodeUnit);
  for (const sound of ids) {
    const file = project.doc?.<SoundFile>(SOUND_KIND, sound);
    for (const matcher of file?.on ?? []) {
      const list = byEvent.get(matcher.event) ?? [];
      if (!byEvent.has(matcher.event)) byEvent.set(matcher.event, list);
      const last = list[list.length - 1];
      if (last?.sound === sound) last.matchers.push(matcher);
      else list.push({ sound, matchers: [matcher] });
    }
  }

  const meets = (matcher: SoundMatcher, event: StepEvent): boolean => {
    if (matcher.type !== undefined || matcher.tag !== undefined) {
      const found = event.entityId === undefined ? undefined : entity?.(event.entityId);
      if (!found) return false;
      if (matcher.type !== undefined && found.type !== matcher.type) return false;
      if (matcher.tag !== undefined && !found.tags.has(matcher.tag)) return false;
    }
    if (matcher.data !== undefined) {
      if (!isPlainObject(event.data)) return false;
      const data = event.data;
      for (const [key, want] of Object.entries(matcher.data)) {
        if (!Object.hasOwn(data, key) || !sameValue(data[key], want)) return false;
      }
    }
    return true;
  };

  return {
    match(event) {
      const list = byEvent.get(event.type);
      if (!list) return NONE;
      const out: AssetId[] = [];
      for (const { sound, matchers } of list) {
        if (matchers.some((m) => meets(m, event))) out.push(sound);
      }
      return out;
    },
  };
}
