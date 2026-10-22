/**
 * Load check, not part of `bun test`: N peers (default 50) on a 2,000-card
 * canvas, each sending 25 Hz pointer awareness and 5 Hz card drags, while a
 * probe measures edit latency end to end. Prints the service's own metrics
 * for the window: event-loop lag p99 (budget < 20ms) and store p99 (a
 * snapshot worker is only worth building above 15ms). Results go in LOAD.md.
 *
 *   CANVAS_SYNC_TEST_DATABASE_URL=… bun run test/load.ts
 */
import * as Y from "yjs";

import { connect, seedCanvas, seedUser, sleep, testDb, until } from "./harness.ts";

const N = Number(process.env.N ?? 50);
const SECS = Number(process.env.SECS ?? 15);
const PORT = 4150;

const { db, end } = testDb();
const canvasId = await seedCanvas(db);
for (let i = 0; i < N; i++) await seedUser(db, `load-u${i}`);

const server = Bun.spawn([process.execPath, "test/load-server.ts"], {
  env: { ...process.env, PORT: String(PORT) },
  stdout: "inherit",
  stderr: "inherit",
});
const endWindow = async () => (await fetch(`http://127.0.0.1:${PORT + 1}/window`)).json();
await until(async () => {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/health`)).ok;
  } catch {
    return false;
  }
}, 15_000);

const clients = Array.from({ length: N }, (_, i) => connect(PORT, canvasId, `load-u${i}`));
if (!(await until(() => clients.every((c) => c.provider.isSynced), 30_000)))
  throw new Error("peers never synced");

const seeder = clients[0]!;
for (let batch = 0; batch < 10; batch++) {
  seeder.doc.transact(() => {
    for (let k = batch * 200; k < (batch + 1) * 200; k++) {
      const node = new Y.Map<unknown>();
      node.set("type", "text");
      node.set("x", k);
      node.set("y", 0);
      node.set("w", 200);
      node.set("h", 100);
      node.set("z", "a0");
      node.set("text", new Y.Text("hello ".repeat(20)));
      seeder.nodes.set(`n${k}`, node);
    }
  });
  await sleep(200);
}
if (!(await until(() => clients.every((c) => c.nodes.size === 2000), 30_000))) {
  throw new Error(`seed never reached every peer: ${clients.map((c) => c.nodes.size).join(",")}`);
}
// Let the seed's stores settle, then start the measured window clean.
await sleep(3000);
await endWindow();

const latencies: number[] = [];
const timers: ReturnType<typeof setInterval>[] = [];
for (const [i, client] of clients.slice(0, N - 1).entries()) {
  timers.push(
    setInterval(
      () =>
        client.provider.setAwarenessField("pointer", {
          x: Math.random() * 1000,
          y: Math.random() * 1000,
        }),
      40,
    ),
  );
  timers.push(
    setInterval(
      () =>
        (client.nodes.get(`n${i}`) as Y.Map<unknown> | undefined)?.set("x", Math.random() * 1000),
      200,
    ),
  );
}
const observer = clients[N - 1]!;
timers.push(setInterval(() => seeder.doc.getMap("probe").set("t", performance.now()), 100));
observer.doc.getMap("probe").observe(() => {
  latencies.push(performance.now() - (observer.doc.getMap("probe").get("t") as number));
});

await sleep(SECS * 1000);
const service = await endWindow();
timers.forEach(clearInterval);
const closed = clients.filter((c) => c.closes.length > 0).length;
if (closed)
  console.warn(
    `${closed} peer(s) saw a close: ${JSON.stringify(clients.flatMap((c) => c.closes))}`,
  );
latencies.sort((a, b) => a - b);
const pick = (p: number) => +(latencies[Math.floor(latencies.length * p)] ?? NaN).toFixed(1);
console.log(
  JSON.stringify(
    {
      peers: N,
      cards: 2000,
      awarenessHz: 25,
      dragHz: 5,
      editLatencyP50: pick(0.5),
      editLatencyP99: pick(0.99),
      service,
    },
    null,
    2,
  ),
);

for (const client of clients) client.destroy();
server.kill("SIGTERM");
await server.exited;
await end();
process.exit(0);
