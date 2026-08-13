import { ilike } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { db } from "@/db";
import { collabRoles, skills } from "@/db/schema";
import { escapeLike } from "@/lib/sql-like";

/**
 * The duplicate-name guards behind the admin vocabulary. The DB's unique
 * index on `name` is case-sensitive, which is not what "already exists"
 * means to a moderator looking at "c#" beside "C#" — so the guards match on
 * `ILIKE` with no wildcards. These assert the SQL that reaches Postgres;
 * `.toSQL()` needs no connection.
 */
describe("vocabulary name matching", () => {
  it("matches case-insensitively with no wildcards", () => {
    const query = db
      .select()
      .from(skills)
      .where(ilike(skills.name, escapeLike("c#")))
      .toSQL();

    expect(query.sql).toContain("ilike");
    expect(query.params).toEqual(["c#"]);
    // A bare term, not `%term%` — this is an equality test, not a search.
    expect(query.params[0]).not.toContain("%");
  });

  it("neutralises LIKE wildcards in the name", () => {
    const query = db
      .select()
      .from(collabRoles)
      .where(ilike(collabRoles.name, escapeLike("100% Designer_x")))
      .toSQL();

    expect(query.params).toEqual(["100\\% Designer\\_x"]);
  });
});
