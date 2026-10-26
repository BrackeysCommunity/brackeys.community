/**
 * Message references in summaries. The model sees each message numbered
 * (`#12`) and cites with a markdown link to that number, `[phrase](#12)`,
 * which costs a few tokens where a 19-digit id would cost many. Numbers are
 * per call, so a cached chunk summary stores the real id (`<m:ID>`) and
 * each request renumbers it.
 */

const NUMBERED_LINK = /\[([^\]\n]+)\]\(#(\d+)\)/g;
const STORED_LINK = /\[([^\]\n]+)\]\(<m:(\d{17,20})>\)/g;

/** Numbers messages for one model call, in the order they're shown. */
export class RefTable {
  private ids: string[] = [];
  private numbers = new Map<string, number>();

  number(id: string): number {
    let n = this.numbers.get(id);
    if (n === undefined) {
      this.ids.push(id);
      n = this.ids.length;
      this.numbers.set(id, n);
    }
    return n;
  }

  id(n: number): string | undefined {
    return this.ids[n - 1];
  }
}

/** A model's `[x](#n)` links as stored ones; a number it made up loses its link. */
export function storeLinks(text: string, refs: RefTable): string {
  return text.replace(NUMBERED_LINK, (_, label: string, n: string) => {
    const id = refs.id(Number(n));
    return id ? `[${label}](<m:${id}>)` : label;
  });
}

/** Stored links renumbered into this call's table, for the model to cite again. */
export function numberLinks(text: string, refs: RefTable): string {
  return text.replace(STORED_LINK, (_, label: string, id: string) => {
    return `[${label}](#${refs.number(id)})`;
  });
}

/** Link text for a citation the model made with a bare number instead of words. */
const BARE_LABEL = "message";
const BARE_NUMBER = /^#?\d+$/;

/** The final answer's `[x](#n)` links as Discord message links. */
export function resolveLinks(text: string, refs: RefTable, messageUrl: (id: string) => string) {
  const resolved = text.replace(NUMBERED_LINK, (_, label: string, n: string) => {
    const id = refs.id(Number(n));
    const bare = BARE_NUMBER.test(label);
    if (!id) return bare ? "" : label;
    return `[${bare ? BARE_LABEL : label}](${messageUrl(id)})`;
  });
  return tidy(resolved);
}

/** What removing a citation can leave behind: `()`, `(, )`, a space before punctuation. */
function tidy(text: string): string {
  return text
    .replace(/(^|\s)\(\s*(?:,\s*)*\)/g, "$1")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/\s*,\s*\)/g, ")")
    .replace(/ +([.,;:])/g, "$1")
    .replace(/ {2,}/g, " ");
}

const URL_LINK = /\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g;

/**
 * Under `max` characters without cutting words or landing mid-link. Bare
 * citations go first, from the end, removed outright: unlinked they'd read
 * as a stray "message". Then other links are unlinked from the end, keeping
 * their words.
 */
export function fitLinks(text: string, max: number): string {
  let fitted = text;
  while (fitted.length > max) {
    const last = [...fitted.matchAll(URL_LINK)].filter((m) => m[1] === BARE_LABEL).at(-1);
    if (!last) break;
    fitted = tidy(fitted.slice(0, last.index) + fitted.slice(last.index + last[0].length));
  }
  while (fitted.length > max) {
    const last = [...fitted.matchAll(URL_LINK)].at(-1);
    if (!last) break;
    fitted = fitted.slice(0, last.index) + last[1] + fitted.slice(last.index + last[0].length);
  }
  return fitted;
}
