/**
 * `ILIKE` pattern building for user-supplied search text.
 *
 * `%` and `_` are wildcards inside a LIKE pattern, so a search for
 * `100%` or `snake_case` silently matches far more than the user asked
 * for. Postgres' default escape character is the backslash, which is
 * what the replacement below relies on.
 *
 * This existed as a private `escapeLike` in four routers before it lived
 * here; the copies disagreed about whether to escape at all.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * A `%term%` containment pattern with wildcards escaped, or `null` when
 * the term is empty — so callers can drop the predicate entirely rather
 * than matching everything through `%%`.
 */
export function likeContains(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? `%${escapeLike(trimmed)}%` : null;
}
