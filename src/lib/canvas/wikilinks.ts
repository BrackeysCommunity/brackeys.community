/**
 * Obsidian's `[[wikilinks]]`: parsing one, and whether it points at a vault
 * path. Shared with the plugin, so no `@/` imports.
 */

export interface Wikilink {
  /** The linked path or name, without `#heading` or `^block`. */
  target: string;
  /** `#heading` or `^block`, with its marker. */
  subpath?: string;
  alias?: string;
  /** `![[…]]`: embed the target rather than link to it. */
  embed: boolean;
}

const WIKILINK = /^(!?)\[\[([^[\]\n]+?)\]\]/;

/** The wikilink at the very start of `src`, and how much of `src` it spans. */
export function parseWikilink(src: string): { link: Wikilink; raw: string } | null {
  const match = WIKILINK.exec(src);
  if (!match) return null;
  const inner = match[2]!;
  const pipe = inner.indexOf("|");
  const ref = pipe === -1 ? inner : inner.slice(0, pipe);
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim() || undefined;
  const mark = ref.search(/[#^]/);
  const target = (mark === -1 ? ref : ref.slice(0, mark)).trim();
  if (!target) return null;
  return {
    raw: match[0],
    link: {
      target,
      subpath: mark === -1 ? undefined : ref.slice(mark).trim() || undefined,
      alias,
      embed: match[1] === "!",
    },
  };
}

function linkKey(pathOrTarget: string): string {
  return pathOrTarget.trim().toLowerCase().replace(/\.md$/, "");
}

/**
 * Obsidian's matching, reduced to what a canvas can see: `[[Note]]` names
 * `Note.md` in any folder and `[[Ideas/Note]]` a path ending in it, with
 * `.md` optional and case ignored.
 */
export function wikilinkMatches(target: string, path: string): boolean {
  const want = linkKey(target);
  const have = linkKey(path);
  return have === want || have.endsWith(`/${want}`);
}

/** What the link reads as: its alias, else the target's name without `.md`. */
export function wikilinkLabel(link: Wikilink): string {
  if (link.alias) return link.alias;
  const name = link.target.slice(link.target.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  return link.subpath ? `${name} › ${link.subpath.slice(1)}` : name;
}
