import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { MANIFEST } from "../src/manifest.ts";

/**
 * The bot's operator and admin documents name only what exists: env names
 * the bot or the world reads, slash commands in MANIFEST, the sheets'
 * own numbers, and no host but Discord's (the site's domain lives in
 * src/lib/legal-meta.ts alone).
 */

const BOT = join(import.meta.dir, "..");
const ROOT = join(BOT, "..", "..");
const WORLD = join(ROOT, "services", "mmo-world");

const read = (path: string) => readFileSync(path, "utf8");

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(full, keep);
    return keep(e.name) ? [full] : [];
  });
}

const DOCS = [join(BOT, "README.md"), ...files(join(BOT, "docs"), (n) => n.endsWith(".md"))];
const ENV_EXAMPLE = join(BOT, ".env.example");

/** The env names src/config.ts reads: `env.X`, `env["X"]`, need("X") and integer("X"). */
function configNames(): Set<string> {
  const src = read(join(BOT, "src", "config.ts"));
  const out = new Set<string>();
  const re =
    /env\.([A-Z][A-Z0-9_]+)|env\[\s*"([A-Z][A-Z0-9_]+)"\s*\]|(?:need|integer)\(\s*"([A-Z][A-Z0-9_]+)"/g;
  for (const m of src.matchAll(re)) out.add((m[1] ?? m[2] ?? m[3])!);
  return out;
}

/** Every source an env name in these docs may come from: the bot's code and scripts, and the world's env. */
function envSources(): string {
  return [
    ...files(join(BOT, "src"), (n) => n.endsWith(".ts")),
    ...files(join(BOT, "scripts"), (n) => /\.(ts|sh)$/.test(n)),
    join(WORLD, "service", "env.go"),
    join(WORLD, "gateway", "env.go"),
  ]
    .map(read)
    .join("\n");
}

const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
const ENV_LIKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/** Env names a doc mentions: backticked names (alone or as NAME=value) and assignments or expansions in code blocks. */
function envMentions(text: string): string[] {
  const out: string[] = [];
  const prose = text.replace(FENCE, "");
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const name = m[1]!.split("=")[0]!.trim();
    if (name.length >= 3 && ENV_LIKE.test(name)) out.push(name);
  }
  for (const block of text.matchAll(FENCE))
    for (const m of block[1]!.matchAll(
      /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)=|\$\{?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)/g,
    ))
      out.push((m[1] ?? m[2])!);
  return out;
}

/** The section of a Markdown file under a level-two heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`no "## ${heading}" section`);
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

/** A Markdown table's body rows, as cells, from the first table in the text. */
function tableRows(text: string, header: string): string[][] {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("|") && l.split("|")[1]?.trim() === header);
  if (at < 0) throw new Error(`no table headed "${header}"`);
  const rows: string[][] = [];
  for (const line of lines.slice(at + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim()),
    );
  }
  return rows;
}

const unticked = (cell: string) => cell.replace(/^`|`$/g, "");

test("config.ts is read for its names", () => {
  const names = configNames();
  for (const n of ["DISCORD_TOKEN", "DISCORD_APP_ID", "MMO_API_TOKEN", "ANTHROPIC_API_KEY"])
    expect(names.has(n)).toBe(true);
  expect(names.size).toBeGreaterThanOrEqual(15);
});

test(".env.example lists every config.ts name, empty, each under a comment", () => {
  const lines = read(ENV_EXAMPLE).split("\n");
  const names: string[] = [];
  lines.forEach((line, i) => {
    if (!line.trim() || line.startsWith("#")) return;
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    expect(m, `line ${i + 1}: ${line}`).not.toBeNull();
    expect(m![2], `${m![1]} has a value`).toBe("");
    expect(lines[i - 1]?.startsWith("#"), `${m![1]} has no comment above it`).toBe(true);
    names.push(m![1]!);
  });
  expect(new Set(names).size).toBe(names.length);
  expect(names.toSorted()).toEqual([...configNames()].toSorted());
});

test("the README's env table is exactly config.ts's names, each marked secret or not", () => {
  const rows = tableRows(section(read(join(BOT, "README.md")), "Environment"), "Name");
  const names = rows.map((r) => unticked(r[0]!));
  expect(names.toSorted()).toEqual([...configNames()].toSorted());
  for (const r of rows) expect(r[1], `${r[0]}'s Secret column`).toMatch(/^(yes|no)\b/);
});

test("every env name the docs mention is read by the bot or the world", () => {
  const sources = envSources();
  const config = configNames();
  const missing = [...DOCS, ENV_EXAMPLE].flatMap((path) =>
    envMentions(read(path))
      .filter((n) => !config.has(n) && !new RegExp(`\\b${n}\\b`).test(sources))
      .map((n) => `${relative(BOT, path)}: ${n}`),
  );
  expect(missing).toEqual([]);
});

const SLASH = new Set<string>(MANIFEST.filter((c) => c.type === 1).map((c) => c.name));

test("every slash command the docs name is in MANIFEST", () => {
  const unknown = DOCS.flatMap((path) =>
    [...read(path).matchAll(/(?<![\w/.:~<>-])\/([a-z][a-z-]*)(?![\w/.-])/g)]
      .map((m) => m[1]!)
      .filter((name) => !SLASH.has(name))
      .map((name) => `${relative(BOT, path)}: /${name}`),
  );
  expect(unknown).toEqual([]);
});

test("the README names every slash command", () => {
  const readme = read(join(BOT, "README.md"));
  for (const name of SLASH) expect(readme).toContain(`\`/${name}\``);
});

test("verification.md counts the manifest's commands as they are", () => {
  const text = read(join(BOT, "docs", "verification.md")).replace(/\s+/g, " ");
  const m = /The manifest has (\d+) slash commands and (\d+) message commands?/.exec(text);
  expect(m).not.toBeNull();
  expect(Number(m![1])).toBe(SLASH.size);
  expect(Number(m![2])).toBe(MANIFEST.filter((c) => c.type === 3).length);
});

/** The site's own hosts, as legal-meta.ts names them. */
function siteHosts(): string[] {
  const meta = read(join(ROOT, "src", "lib", "legal-meta.ts"));
  return [...meta.matchAll(/(?:DOMAIN|MAIL_DOMAIN) = "([^"]+)"/g)].map((m) => m[1]!);
}

const HOST =
  /\b(?:[a-z0-9-]+\.)+(?:com|dev|team|community|gg|io|app|net|org|co|xyz|me|site|gl)\b/gi;
const discordHost = (h: string) => /^(?:[a-z0-9-]+\.)*discord\.com$/i.test(h);

test("the docs name no host but Discord's", () => {
  const hosts = siteHosts();
  expect(hosts.length).toBeGreaterThan(0);
  const found = [...DOCS, ENV_EXAMPLE].flatMap((path) => {
    const text = read(path);
    return [
      ...[...text.matchAll(HOST)].map((m) => m[0]).filter((h) => !discordHost(h)),
      ...hosts.filter((h) => text.toLowerCase().includes(h.toLowerCase())),
    ].map((h) => `${relative(BOT, path)}: ${h}`);
  });
  expect(found).toEqual([]);
});

/** A sheet's rows by id, from its "<dir>.<name>" sheet id. */
function sheetRows(sheet: string): Map<string, Record<string, unknown>> {
  const [dir, name] = sheet.split(".") as [string, string];
  const body = JSON.parse(read(join(WORLD, "sheets", dir, `${name}.json`))) as {
    rows: Record<string, unknown>[];
  };
  return new Map(body.rows.map((r) => [String(r.id), r]));
}

test("admins.md's staging templates are liveops.templates, row for row", () => {
  const rows = tableRows(read(join(BOT, "docs", "admins.md")), "Template");
  const sheet = sheetRows("liveops.templates");
  expect(rows.map((r) => unticked(r[0]!)).toSorted()).toEqual([...sheet.keys()].toSorted());
  for (const [id, kind, points, staff, days] of rows) {
    const row = sheet.get(unticked(id!))!;
    expect(kind!.split(" ")[0], `${id} kind`).toBe(String(row.kind));
    expect(Number(points), `${id} points`).toBe(Number(row.points));
    expect(staff, `${id} staff`).toBe(row.staff ? "yes" : "no");
    expect(Number(days), `${id} days`).toBe(Number(row.days));
    if (row.crates !== undefined) expect(kind).toContain(`${row.crates} crates`);
    if (row.tier !== undefined) expect(kind).toContain(`tier ${row.tier}`);
  }
});

test("admins.md's limits are the sheets' cells", () => {
  const rows = tableRows(read(join(BOT, "docs", "admins.md")), "Sheet cell");
  expect(rows.length).toBeGreaterThan(0);
  for (const [cell, value] of rows) {
    const m = /^`([a-z-]+\.[a-z-]+)\[([a-z0-9-]+)\]\.([A-Za-z]+)`$/.exec(cell!);
    expect(m, `cell ${cell}`).not.toBeNull();
    const row = sheetRows(m![1]!).get(m![2]!);
    expect(row, `${cell}'s row`).toBeDefined();
    expect(Number(value), String(cell)).toBe(Number(row![m![3]!]));
  }
});

/** Discord's permission bits, by the name the portal and the install screen show. */
const PERMISSION_BITS: Record<string, number> = {
  "View Channel": 10,
  "Send Messages": 11,
  "Create Posts": 11,
  "Embed Links": 14,
  "Attach Files": 15,
  "Read Message History": 16,
  "Manage Roles": 28,
  "Manage Threads": 34,
  "Create Public Threads": 35,
  "Create Private Threads": 36,
  "Send Messages in Threads": 38,
  "Use Embedded Activities": 39,
};

test("admins.md's permissions integer is the sum of the permissions it lists", () => {
  const text = read(join(BOT, "docs", "admins.md"));
  const bits = new Set<number>();
  for (const [name] of tableRows(text, "Permission")) {
    expect(PERMISSION_BITS[name!], `bit of ${name}`).toBeDefined();
    bits.add(PERMISSION_BITS[name!]!);
  }
  const sum = [...bits].reduce((s, b) => s + (1n << BigInt(b)), 0n);
  expect(text).toContain(`The permissions integer for the link is \`${sum}\``);
  expect(text).toContain(`permissions=${sum}`);
});

test("every relative link in the docs reaches a file", () => {
  const broken = DOCS.flatMap((path) =>
    [...read(path).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
      .map((m) => m[1]!)
      .filter((href) => !/^[a-z]+:/.test(href))
      .filter((href) => !existsSync(join(dirname(path), href)))
      .map((href) => `${relative(BOT, path)}: ${href}`),
  );
  expect(broken).toEqual([]);
});
