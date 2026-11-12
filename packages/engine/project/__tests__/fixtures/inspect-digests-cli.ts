import { inspectDigests } from "./inspect-digests";

const runtime = typeof process.versions.bun === "string" ? "bun" : "node";
void inspectDigests().then((digests) => {
  process.stdout.write(`${JSON.stringify({ runtime, digests })}\n`);
});
