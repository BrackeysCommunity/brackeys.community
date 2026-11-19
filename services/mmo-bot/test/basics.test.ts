import { expect, test } from "bun:test";

import { buttonRows, createCooldown, toMessage } from "../../../packages/discord-kit/src/index.ts";
import { decodeId, encodeId } from "../src/ids.ts";
import { PostQueue, THREADS_PER_WINDOW, ThreadBudget } from "../src/publish.ts";
import { amount, band, change, ticks } from "../src/units.ts";

test("a custom_id carries action, target and version, and nothing else decodes", () => {
  const id = encodeId("press", "strike", 12);
  expect(decodeId(id)).toEqual({ action: "press", target: "strike", version: 12 });
  expect(decodeId("jam:page:2")).toBeNull();
  expect(() => encodeId("x", "y".repeat(120))).toThrow();
});

test("units read as the GDD writes them", () => {
  expect(amount(1240, "coin")).toBe("1,240 coin");
  expect(change(70, 64, "durability", 90)).toBe("70 to 64 of 90 durability");
  expect(ticks(2)).toBe("2 ticks (20 min)");
  expect(band("even")).toBe("Even (about 1 in 2)");
});

test("posts to a channel batch into one message every two seconds", async () => {
  let t = 0;
  const sent: string[] = [];
  const q = new PostQueue(
    async (_c, text) => void sent.push(text),
    () => t,
    20,
  );
  q.post("a", "one");
  q.post("a", "two");
  await Bun.sleep(5);
  expect(sent).toEqual(["one\ntwo"]);
  t = 5;
  q.post("a", "three");
  await Bun.sleep(5);
  expect(sent).toHaveLength(1);
  await Bun.sleep(30);
  expect(sent).toEqual(["one\ntwo", "three"]);
});

test("a server opens at most 40 threads in five minutes", () => {
  let t = 0;
  const b = new ThreadBudget(() => t);
  for (let i = 0; i < THREADS_PER_WINDOW; i++) expect(b.take("s")).toBe(true);
  expect(b.take("s")).toBe(false);
  expect(b.take("other")).toBe(true);
  t = 300_001;
  expect(b.take("s")).toBe(true);
});

test("the shared kit builds rows of five, selects on their own row, and drops a duplicate id", () => {
  const buttons = Array.from({ length: 7 }, (_, i) => ({
    kind: "page" as const,
    label: `b${i}`,
    customId: `id${i % 6}`,
  }));
  const m = toMessage({
    embeds: [],
    rows: [
      ...buttonRows(buttons),
      { select: { customId: "s", placeholder: "p", options: [{ label: "x", value: "x" }] } },
    ],
  });
  expect(m.components.map((r) => (r.components as unknown[]).length)).toEqual([5, 1, 1]);
  const c = createCooldown({ limit: 1, windowMs: 1000 });
  expect(c.check("u", 0).allowed).toBe(true);
  expect(c.check("u", 1).allowed).toBe(false);
});
