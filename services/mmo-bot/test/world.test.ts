import { expect, test } from "bun:test";

import { CodeNotFound } from "../src/api.ts";
import { Notifier } from "../src/notify.ts";
import { httpWorld } from "../src/world.ts";

test("a wiped character stops being polled, while a transient outage is retried", async () => {
  const requests = new Map<string, number>();
  const fetcher: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const id = new URL(String(input)).searchParams.get("characterId")!;
      requests.set(id, (requests.get(id) ?? 0) + 1);
      if (id === "wiped") {
        return Response.json({ code: CodeNotFound, message: "no character" }, { status: 404 });
      }
      if (requests.get(id) === 1) return new Response(null, { status: 503 });
      return Response.json({ long: { kind: "gather" } });
    },
    { preconnect: () => {} },
  );
  const notify = new Notifier(httpWorld("http://localhost", "", fetcher), async () => {});
  notify.watch("one", "wiped");
  notify.watch("two", "active");
  await notify.poll();
  await notify.poll();
  expect(requests.get("wiped")).toBe(1);
  expect(requests.get("active")).toBe(2);
});

test("the board, forum, arcs and promotions reads carry the server they are asked for", async () => {
  const urls: URL[] = [];
  const fetcher: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      urls.push(new URL(String(input)));
      return Response.json({});
    },
    { preconnect: () => {} },
  );
  const world = httpWorld("http://localhost", "", fetcher);
  await world.board("g1");
  await world.forum("g1");
  await world.arcs("", "g1");
  await world.storyPromotions(5, "g1");
  expect(urls.map((u) => u.searchParams.get("server"))).toEqual(["g1", "g1", "g1", "g1"]);
  expect(urls[3]!.searchParams.get("after")).toBe("5");
  expect(urls[2]!.searchParams.has("characterId")).toBe(false);
  await world.board();
  expect(urls[4]!.searchParams.has("server")).toBe(false);
  await world.chronicleFact(undefined, 7, "g1");
  expect(urls[5]!.searchParams.get("server")).toBe("g1");
  expect(urls[5]!.searchParams.get("id")).toBe("7");
  expect(urls[5]!.searchParams.has("characterId")).toBe(false);
  await world.storyEvents(3, "g1");
  expect(urls[6]!.searchParams.get("server")).toBe("g1");
});
