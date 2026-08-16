import { describe, expect, it, vi } from "vite-plus/test";

import { applyUnsubscribe, isEmailGloballyDisabled, setEmailsDisabled } from "../unsubscribe";

/**
 * A drizzle stand-in that records every insert/update it receives. Both the
 * web app and the worker pass their own handle into these helpers, so the
 * contract under test is the call shape, not any real SQL.
 */
function fakeDb(selectRows: unknown[] = []) {
  const inserts: { table: unknown; values: unknown; conflictSet?: unknown }[] = [];

  return {
    inserts,
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => selectRows }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const record: { table: unknown; values: unknown; conflictSet?: unknown } = {
          table,
          values,
        };
        inserts.push(record);
        const chain = {
          onConflictDoUpdate: ({ set }: { set: unknown }) => {
            record.conflictSet = set;
            return Promise.resolve(undefined);
          },
          then: (resolve: (v: undefined) => void) => resolve(undefined),
        };
        return chain;
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
}

/** Values written to the settings table across all recorded inserts. */
function settingsWrites(db: ReturnType<typeof fakeDb>) {
  return db.inserts
    .map((i) => ({ ...(i.values as Record<string, unknown>), ...(i.conflictSet as object) }))
    .filter((v) => "emailsDisabled" in v);
}

describe("isEmailGloballyDisabled", () => {
  it("is false when the user has no settings row", async () => {
    expect(await isEmailGloballyDisabled(fakeDb([]), "user-1")).toBe(false);
  });

  it("is false when the column is false", async () => {
    expect(await isEmailGloballyDisabled(fakeDb([{ emailsDisabled: false }]), "user-1")).toBe(
      false,
    );
  });

  it("is true only for an explicit true", async () => {
    expect(await isEmailGloballyDisabled(fakeDb([{ emailsDisabled: true }]), "user-1")).toBe(true);
  });
});

describe("setEmailsDisabled", () => {
  it("upserts the flag so a first-time user gets a settings row", async () => {
    const db = fakeDb();
    await setEmailsDisabled(db, "user-1", true);

    const writes = settingsWrites(db);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ userId: "user-1", emailsDisabled: true });
  });

  it("can clear the flag again", async () => {
    const db = fakeDb();
    await setEmailsDisabled(db, "user-1", false);
    expect(settingsWrites(db)[0]).toMatchObject({ emailsDisabled: false });
  });
});

describe("applyUnsubscribe", () => {
  it("flips the global switch for scope 'all' — a type added later must stay off", async () => {
    const db = fakeDb();
    await applyUnsubscribe(db, "user-1", "all");

    expect(settingsWrites(db)).toEqual([
      expect.objectContaining({ userId: "user-1", emailsDisabled: true }),
    ]);
  });

  it("leaves the global switch alone when unsubscribing a single type", async () => {
    const db = fakeDb();
    const result = await applyUnsubscribe(db, "user-1", "comment_reply");

    expect(settingsWrites(db)).toEqual([]);
    expect(result).toEqual({ scope: "comment_reply" });
  });

  it("turns off both email and digest for the targeted type", async () => {
    const db = fakeDb();
    await applyUnsubscribe(db, "user-1", "comment_reply");

    const prefWrite = db.inserts.find(
      (i) => (i.values as Record<string, unknown>).type === "comment_reply",
    );
    expect(prefWrite?.values).toMatchObject({ email: false, digest: false });
    expect(prefWrite?.conflictSet).toMatchObject({ email: false, digest: false });
  });
});

describe("token issuance", () => {
  it("does not clobber an existing token", async () => {
    const db = fakeDb([{ token: "existing-token" }]);
    const insertSpy = vi.spyOn(db, "insert");

    const { getOrCreateUnsubscribeToken } = await import("../unsubscribe");
    const token = await getOrCreateUnsubscribeToken(db, "user-1");

    expect(token).toBe("existing-token");
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
