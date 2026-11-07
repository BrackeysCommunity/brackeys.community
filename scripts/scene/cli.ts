import { runCli } from "./commands";
import { defaultToolContext } from "./default-context";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const { exitCode, stdout, stderr } = await runCli(process.argv.slice(2), {
  ...defaultToolContext(),
  readStdin,
});
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
process.exitCode = exitCode;
