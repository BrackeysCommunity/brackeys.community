import { sameValue } from "../project/canonical";
import { byCodeUnit, isPlainObject } from "../project/kinds/define";
import { SOUND_KIND, type SoundFile, type SoundMatcher } from "../project/kinds/sound";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetId } from "../project/types";
import type { StepEvent } from "../runtime/types";

/** What a `type` or `tag` matcher reads of an event's entity. */
export type TriggerEntity = { type: string; tags: ReadonlySet<string> };

/** Which sounds a step event plays: every sound doc's `on` matchers, in sound-id order. */
export type SoundTriggers = {
  /** Each sound at most once, however many of its matchers the event meets. */
  match(event: StepEvent): readonly AssetId[];
};

const NONE: readonly AssetId[] = Object.freeze([]);

/**
 * The trigger index over a project's sound docs. `entity` answers a
 * matcher's `type` and `tag`; without it, or for an event with no entity,
 * those matchers never match.
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
