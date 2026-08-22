import { describe, expect, it } from "vite-plus/test";

import { isPublicProcedure } from "@/orpc/public-procedures";
import { EXTRA_READ_NAMES, READ_NAME_PATTERN, isReadName } from "@/orpc/read-names";
import router from "@/orpc/router";

/**
 * The client facade (src/orpc/client.ts) routes every call by its
 * procedure's *name*: public names go to the cacheable mount, read names
 * (get/list/count/search + EXTRA_READ_NAMES) go to the private mount
 * untouched, and everything else is treated as a write and stamps the
 * recent-write window. Nothing else enforces the convention — a procedure
 * named outside it silently lands on the wrong tier. These assertions make
 * a misnamed addition fail CI instead.
 */

/**
 * Every verb a write procedure may start with. A new procedure whose name
 * opens with none of these (and isn't a read) fails below — add its verb
 * here deliberately, having checked which side of the read/write dispatch
 * it belongs on.
 */
const WRITE_VERBS = [
  "add",
  "approve",
  "ban",
  "block",
  "cancel",
  "close",
  "create",
  "delete",
  "edit",
  "extend",
  "feature",
  "import",
  "invite",
  "leave",
  "link",
  "lock",
  "mark",
  "reject",
  "remove",
  "reopen",
  "report",
  "request",
  "resolve",
  "respond",
  "revoke",
  "set",
  "sync",
  "transfer",
  "unban",
  "unblock",
  "unlink",
  "update",
  "withdraw",
] as const;

const READ_VERBS = ["get", "list", "count", "search"] as const;

const startsWithVerb = (name: string, verb: string) =>
  name.startsWith(verb) && /[A-Z]/.test(name.charAt(verb.length));

const isWriteName = (name: string) => WRITE_VERBS.some((verb) => startsWithVerb(name, verb));

const names = Object.keys(router);

describe("read/write naming convention", () => {
  it("classifies every procedure as public, read, or a known write verb", () => {
    for (const name of names) {
      const classified = isPublicProcedure(name) || isReadName(name) || isWriteName(name);
      expect(
        classified,
        `"${name}" fits no dispatch class: not a public procedure, not a read ` +
          `(${READ_NAME_PATTERN} or EXTRA_READ_NAMES), and no WRITE_VERBS entry — ` +
          "the client facade would treat it as a write and stamp the recent-write " +
          "window on every call. Name it into the convention, or classify its verb.",
      ).toBe(true);
    }
  });

  it("keeps the read and write vocabularies disjoint", () => {
    // A verb on both sides would make the classification above vacuous.
    for (const verb of WRITE_VERBS) {
      expect(READ_VERBS).not.toContain(verb);
    }
    for (const name of names) {
      if (isReadName(name)) {
        expect(isWriteName(name), `"${name}" matches both the read pattern and a write verb`).toBe(
          false,
        );
      }
    }
  });

  it("keeps EXTRA_READ_NAMES pointing at procedures that still exist", () => {
    // A stale entry here is harmless today but would silently classify a
    // future same-named write as a read.
    for (const name of EXTRA_READ_NAMES) {
      expect(names, `EXTRA_READ_NAMES lists "${name}", which is not in the router`).toContain(name);
    }
  });

  it("keeps non-public write-classified procedures out of the read pattern", () => {
    // The inverse direction: a write named `get…` would skip the
    // recent-write stamp, so the user's own write could be answered by a
    // stale edge cache. The read pattern is the classifier, so this holds
    // by construction — the assertion documents it and guards refactors.
    for (const name of names) {
      if (!isPublicProcedure(name) && !isReadName(name)) {
        expect(READ_NAME_PATTERN.test(name)).toBe(false);
      }
    }
  });
});
