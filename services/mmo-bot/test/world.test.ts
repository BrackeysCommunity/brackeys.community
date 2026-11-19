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
