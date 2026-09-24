/**
 * Trigram fuzzy matching for user-supplied search text (`pg_trgm`).
 *
 * A directory search has to survive the way people actually type: a word
 * from the middle of a title, a typo, a slug fragment. Containment
 * (`ILIKE '%term%'`) covers the first and the last; word similarity
 * covers the typo. Both halves are served by a `gin_trgm_ops` index on the
 * column, so the union stays cheap at any table size.
 *
 * Two similarity operators, both index-served: `%` compares whole strings
 * (threshold `pg_trgm.similarity_threshold`, 0.3 by default) and catches a
 * short title typed with a typo; `<%` compares the term against the best
 * *substring* of the column (threshold `pg_trgm.word_similarity_threshold`,
 * 0.6) and catches one misspelt word out of a long title, which `%` would
 * punish for being long.
 *
 * `{ fold: true }` also strips diacritics from both sides (`f_unaccent`), so
 * "love" finds "LÖVE". It wraps the column in a function call, which a plain
 * `gin_trgm_ops` index on the column can't serve — use it on small tables
 * (the taxonomy) or back it with an expression index.
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { escapeLike } from "./sql-like";

interface FuzzyOptions {
  fold?: boolean;
}

/** Accent-folds a value for comparison: `f_unaccent`, from the migrations. */
export function unaccented(value: PgColumn | SQL | string): SQL {
  return sql`public.f_unaccent(${value})`;
}

function operands(column: PgColumn, term: string, { fold }: FuzzyOptions) {
  const pattern = `%${escapeLike(term)}%`;
  return fold
    ? { col: unaccented(column), q: unaccented(term), pattern: unaccented(pattern) }
    : { col: sql`${column}`, q: sql`${term}`, pattern: sql`${pattern}` };
}

/** Matches `term` against `column` by containment or by trigram similarity. */
export function fuzzyMatch(column: PgColumn, term: string, options: FuzzyOptions = {}): SQL {
  const { col, q, pattern } = operands(column, term, options);
  return sql`(${col} ILIKE ${pattern} OR ${q} % ${col} OR ${q} <% ${col})`;
}

/**
 * How well `term` matches the best of `columns`, 0–1, for `ORDER BY … DESC`.
 * An exact containment ranks above any similarity so a title that literally
 * contains the term is never outsorted by a near-miss.
 */
export function fuzzyRank(
  columns: [PgColumn, ...PgColumn[]],
  term: string,
  options: FuzzyOptions = {},
): SQL<number> {
  const parts = columns.flatMap((column) => {
    const { col, q, pattern } = operands(column, term, options);
    return [
      sql`(case when ${col} ILIKE ${pattern} then 1.0 else 0.0 end)`,
      sql`similarity(${q}, ${col})`,
      sql`word_similarity(${q}, ${col})`,
    ];
  });
  return sql<number>`greatest(${sql.join(parts, sql`, `)})`;
}
