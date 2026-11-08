import { runCli } from "./commands";
import type { ToolContext } from "./context";
import { defaultToolContext } from "./default-context";
import { ProjectDiscoveryError } from "./projects";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

let ctx: ToolContext | null = null;
try {
  ctx = await defaultToolContext();
} catch (e) {
  if (!(e instanceof ProjectDiscoveryError)) throw e;
  process.stderr.write(`error: ${e.message}\n`);
  process.exitCode = 1;
}
if (ctx) {
  const { exitCode, stdout, stderr } = await runCli(process.argv.slice(2), { ...ctx, readStdin });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exitCode = exitCode;
}
