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
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { escapeLike } from "./sql-like";

/** Matches `term` against `column` by containment or by trigram similarity. */
export function fuzzyMatch(column: PgColumn, term: string): SQL {
  const pattern = `%${escapeLike(term)}%`;
  return sql`(${column} ILIKE ${pattern} OR ${term} % ${column} OR ${term} <% ${column})`;
}

/**
 * How well `term` matches the best of `columns`, 0–1, for `ORDER BY … DESC`.
 * An exact containment ranks above any similarity so a title that literally
 * contains the term is never outsorted by a near-miss.
 */
export function fuzzyRank(columns: [PgColumn, ...PgColumn[]], term: string): SQL<number> {
  const pattern = `%${escapeLike(term)}%`;
  const parts = columns.flatMap((column) => [
    sql`(case when ${column} ILIKE ${pattern} then 1.0 else 0.0 end)`,
    sql`similarity(${term}, ${column})`,
    sql`word_similarity(${term}, ${column})`,
  ]);
  return sql<number>`greatest(${sql.join(parts, sql`, `)})`;
}
