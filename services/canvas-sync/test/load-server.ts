// The service in its own process for test/load.ts. GET /window on PORT+1
// ends a metrics window and answers with the service's metrics for it.
import { createDb } from "../src/db.ts";
import { startServer } from "../src/index.ts";
import { SECRET } from "./harness.ts";

const { db } = createDb(process.env.CANVAS_SYNC_TEST_DATABASE_URL!);
const server = await startServer({
  port: Number(process.env.PORT ?? 4150),
  secret: SECRET,
  db,
  instanceId: "load",
  telemetry: { captureException() {}, capture() {}, async shutdown() {} },
  metricsWindowMs: 60 * 60 * 1000,
});
let windowStart = Date.now();
Bun.serve({
  port: server.port + 1,
  fetch() {
    const now = Date.now();
    const gauges = {
      documents: server.hocuspocus.getDocumentsCount(),
      connections: server.hocuspocus.getConnectionsCount(),
    };
    const metrics = server.metrics.drain(now - windowStart, gauges);
    windowStart = now;
    return Response.json(metrics);
  },
});
