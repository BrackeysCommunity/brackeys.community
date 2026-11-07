import { fileURLToPath } from "node:url";

import { runCli } from "./commands";
import type { ToolContext } from "./context";
import { loadCompatRapier } from "./rapier-compat";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const ctx: ToolContext = {
  scenesDir: fileURLToPath(new URL("../../src/game/scenes", import.meta.url)),
  loadRapier: loadCompatRapier,
  readStdin,
};

const { exitCode, stdout, stderr } = await runCli(process.argv.slice(2), ctx);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
process.exitCode = exitCode;
