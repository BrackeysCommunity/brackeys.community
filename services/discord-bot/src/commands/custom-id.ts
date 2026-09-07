/**
 * Pagination state lives in the button's `custom_id`, so a page turn works
 * after a restart and needs no store. Discord caps the id at 100
 * characters; every field is bounded so the widest legal state fits
 * (`custom-id.test.ts` encodes it), and the leading version token means a
 * button from an older deploy decodes to `null` and answers "run the
 * command again" instead of garbage.
 *
 * The free-text search is the last field and is stored raw — it may
 * contain the separator, so decoding rejoins everything after the fixed
 * fields. Its length is capped both here and on the slash-command option.
 */

export const CUSTOM_ID_MAX = 100;
/** UTF-16 units. 30 lets the widest collab state land at 99 characters. */
export const SEARCH_MAX = 30;
const SEP = "|";

export const JAM_ENTRY_SORTS = ["rank", "ratings", "recent", "title"] as const;
export type JamEntrySort = (typeof JAM_ENTRY_SORTS)[number];

export const COLLAB_TYPES = ["paid", "hobby"] as const;
export type CollabType = (typeof COLLAB_TYPES)[number];

export type PageState =
  | { kind: "jam_entries"; jamId: number; sort: JamEntrySort; page: number; search: string }
  | {
      kind: "collab_browse";
      type?: CollabType;
      skillId?: number;
      roleId?: number;
      jamId?: number;
      page: number;
      search: string;
    };

/** Max values the option definitions enforce, so the encoder's bounds and
 *  the manifest's cannot drift. */
export const ID_BOUNDS = {
  /** int4 — itch jam ids. */
  jamId: 2_147_483_647,
  /** Serial ids in tiny tables; seven digits is generous. */
  skillId: 9_999_999,
  roleId: 9_999_999,
  page: 9_999,
} as const;

const VERSION = { jam_entries: "j1", collab_browse: "c1" } as const;
const TYPE_CODE: Record<CollabType, string> = { paid: "p", hobby: "h" };
const CODE_TYPE: Record<string, CollabType> = { p: "paid", h: "hobby" };

export function truncateSearch(search: string | undefined): string {
  if (!search) return "";
  let cut = search.slice(0, SEARCH_MAX);
  // Never end on a high surrogate.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trim();
}

export function encodeCustomId(state: PageState): string {
  const search = truncateSearch(state.search);
  let id: string;
  switch (state.kind) {
    case "jam_entries":
      id = [VERSION.jam_entries, "e", state.jamId, state.sort, state.page, search].join(SEP);
      break;
    case "collab_browse":
      id = [
        VERSION.collab_browse,
        "b",
        state.type ? TYPE_CODE[state.type] : "",
        state.skillId ?? "",
        state.roleId ?? "",
        state.jamId ?? "",
        state.page,
        search,
      ].join(SEP);
      break;
  }
  if (id.length > CUSTOM_ID_MAX) {
    throw new Error(`custom_id over ${CUSTOM_ID_MAX} chars: ${id.length}`);
  }
  return id;
}

export function decodeCustomId(id: string): PageState | null {
  const parts = id.split(SEP);
  const version = parts[0];
  if (version === VERSION.jam_entries && parts[1] === "e") {
    const jamId = int(parts[2], ID_BOUNDS.jamId);
    const sort = parts[3];
    const page = int(parts[4], ID_BOUNDS.page, 0);
    if (jamId == null || jamId < 1 || page == null || !isSort(sort)) return null;
    return { kind: "jam_entries", jamId, sort, page, search: parts.slice(5).join(SEP) };
  }
  if (version === VERSION.collab_browse && parts[1] === "b") {
    const type = parts[2] === "" ? undefined : CODE_TYPE[parts[2] ?? ""];
    if (parts[2] !== "" && type === undefined) return null;
    const skillId = optionalInt(parts[3], ID_BOUNDS.skillId);
    const roleId = optionalInt(parts[4], ID_BOUNDS.roleId);
    const jamId = optionalInt(parts[5], ID_BOUNDS.jamId);
    const page = int(parts[6], ID_BOUNDS.page, 0);
    if (skillId === null || roleId === null || jamId === null || page == null) return null;
    return {
      kind: "collab_browse",
      type,
      skillId,
      roleId,
      jamId,
      page,
      search: parts.slice(7).join(SEP),
    };
  }
  return null;
}

function isSort(value: string | undefined): value is JamEntrySort {
  return (JAM_ENTRY_SORTS as readonly string[]).includes(value ?? "");
}

function int(raw: string | undefined, max: number, min = 1): number | null {
  if (raw == null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/** `undefined` for an empty field, `null` for a malformed one. */
function optionalInt(raw: string | undefined, max: number): number | undefined | null {
  if (raw === "" || raw === undefined) return undefined;
  return int(raw, max);
}
