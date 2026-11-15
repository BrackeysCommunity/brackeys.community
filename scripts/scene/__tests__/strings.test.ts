// @vitest-environment node
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ToolContext } from "../context";
import { loadCompatRapier } from "../rapier-compat";
import {
  formatCsv,
  parseCsv,
  stringsExport,
  stringsImport,
  stringsMissing,
} from "../tools/strings";
import { validate } from "../tools/validate";
import { tempProject } from "./fixtures";

const FIXTURE = fileURLToPath(new URL("./fixtures/strings", import.meta.url));

let root: string;
let dir: string;
let ctx: ToolContext;

type Data = Record<string, unknown>;
type MissingReport = {
  projects: {
    project: string;
    default: string;
    locales: { locale: string; default: boolean; missing: { key: string; uses: Data[] }[] }[];
  }[];
};

const stringsFiles = async () => ({
  extra: await readFile(join(dir, "strings/extra.json"), "utf8"),
  ui: await readFile(join(dir, "strings/ui.json"), "utf8"),
});

const exportFr = async () => {
  const result = await stringsExport({ locale: "fr", csv: true }, ctx);
  expect(result.exitCode, result.text).toBe(0);
  return (result.data as { csv: string }).csv;
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-strings-"));
  dir = join(root, "lines");
  await cp(FIXTURE, dir, { recursive: true });
  await rm(join(dir, "fr.csv"));
  await writeFile(join(root, "fr.csv"), await readFile(join(FIXTURE, "fr.csv")));
  ctx = { projects: [await tempProject(dir, { id: "lines" })], loadRapier: loadCompatRapier };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("CSV", () => {
  it("quotes only fields holding a quote, comma or line break, and reads them back", () => {
    const records = [
      ["plain", 'say "hi"', "a, b", "two\nlines", "crlf\r\nline", ""],
      ["", "", "", "", "", "end"],
    ];
    const csv = formatCsv(records);
    expect(csv).toBe('plain,"say ""hi""","a, b","two\nlines","crlf\r\nline",\n,,,,,end\n');
    expect(parseCsv(csv)).toEqual(records);
  });

  it("reads CRLF records, a byte-order mark and a missing last line break", () => {
    expect(parseCsv('﻿key,en\r\na,"b\r\nc"\r\nd,e')).toEqual([
      ["key", "en"],
      ["a", "b\r\nc"],
      ["d", "e"],
    ]);
  });

  it("refuses an unclosed quote and text after a closing one", () => {
    expect(() => parseCsv('a,"b\nc')).toThrow(/line 1: a quoted field never closes/);
    expect(() => parseCsv('a\n"b"c,d')).toThrow(/line 2: text after a closing quote/);
  });
});

describe("strings on files", { timeout: 60_000 }, () => {
  it("missing lists each locale's keys with where they're used, exit 1 for the default", async () => {
    const result = await stringsMissing({}, ctx);
    expect(result.exitCode).toBe(1);
    const [project] = (result.data as MissingReport).projects;
    expect(project?.default).toBe("en");
    const byLocale = Object.fromEntries(
      (project?.locales ?? []).map((l) => [l.locale, l.missing.map((m) => m.key)]),
    );
    expect(Object.keys(byLocale)).toEqual(["en", "ar", "fr"]);
    expect(byLocale.en).toEqual(["intro.bye", "sign.exit"]);
    expect(byLocale.fr).toEqual([
      "speaker.guide",
      "intro.ask",
      "intro.no",
      "intro.bye",
      "sign.welcome",
      "sign.exit",
      "caption.hit",
    ]);
    // ar's one row loses to extra.json's, the first by path, which has no ar.
    expect(byLocale.ar).toContain("intro.hello");
    const bye = project?.locales[0]?.missing[0];
    expect(bye?.uses).toEqual([
      { kind: "dialogue", id: "intro", pointer: "/nodes/@bye/lines/0/text" },
    ]);
    expect(result.text).toContain("en  sign.exit  scene sign /entities/@exit/behaviors/text/key");
  });

  it("missing --locale reports that locale alone, exit 0 when it isn't the default", async () => {
    const result = await stringsMissing({ locale: "fr" }, ctx);
    expect(result.exitCode).toBe(0);
    const [project] = (result.data as MissingReport).projects;
    expect(project?.locales.map((l) => l.locale)).toEqual(["fr"]);
    const other = await stringsMissing({ locale: "de" }, ctx);
    expect(other.exitCode).toBe(0);
    expect(other.text).toContain(`"de" isn't one of lines's locales (en, ar, fr)`);
    expect((await stringsMissing({ locale: "not a tag" }, ctx)).exitCode).toBe(2);
  });

  it("export writes key,<default>,<locale>,note in path then row order", async () => {
    const result = await stringsExport({ locale: "fr", csv: true }, ctx);
    expect(result.exitCode).toBe(0);
    expect(result.text.split("\n").slice(0, 4)).toEqual([
      "key,en,fr,note",
      "caption.hit,[Thud],,Caption for crate hits.",
      "intro.hello,Hello again.,Rebonjour.,",
      'intro.ask,"Say ""yes"", or no?",,"A question, with a comma."',
    ]);
    expect(`${result.text}\n`).toBe((result.data as { csv: string }).csv);
    expect((await stringsExport({ locale: "fr" }, ctx)).exitCode).toBe(2);
    expect((await stringsExport({ locale: "en", csv: true }, ctx)).exitCode).toBe(2);
  });

  it("export of the files as they are imports back with nothing to write", async () => {
    const before = await stringsFiles();
    const csv = await exportFr();
    await writeFile(join(root, "same.csv"), csv);
    const result = await stringsImport({ file: join(root, "same.csv") }, ctx);
    expect(result.exitCode, result.text).toBe(0);
    expect(result.data).toMatchObject({ written: false, changed: [] });
    expect(await stringsFiles()).toEqual(before);
  });

  it("imports a translator's CSV and exports it back byte for byte", async () => {
    const fixture = await readFile(join(root, "fr.csv"), "utf8");
    const result = await stringsImport({ file: join(root, "fr.csv") }, ctx);
    expect(result.exitCode, result.text).toBe(0);
    const data = result.data as Data & { written: boolean; docs: string[] };
    expect(data.written).toBe(true);
    expect(data.changed).toEqual([
      "caption.hit",
      "intro.ask",
      "intro.no",
      "sign.welcome",
      "speaker.guide",
    ]);
    expect(data.stale).toEqual([]);
    expect(await exportFr()).toBe(fixture);

    const files = await stringsFiles();
    const extra = JSON.parse(files.extra) as { strings: Data[] };
    const ui = JSON.parse(files.ui) as { strings: Data[] };
    expect(extra.strings[0]).toEqual({
      key: "caption.hit",
      en: "[Thud]",
      fr: "[Choc]",
      note: "Caption for crate hits.",
    });
    // intro.hello's fr is extra.json's; ui.json's losing row keeps its own.
    expect(ui.strings.find((r) => r.key === "intro.hello")?.fr).toBe("Bonjour, {name}.");
    expect(ui.strings.find((r) => r.key === "intro.ask")?.fr).toBe(
      'Dis «\u00a0oui\u00a0», ou "non"\u00a0?',
    );
    expect(ui.strings.find((r) => r.key === "intro.no")?.fr).toBe("Non,\njamais.");

    const missing = await stringsMissing({ locale: "fr" }, ctx);
    const [project] = (missing.data as MissingReport).projects;
    expect(project?.locales[0]?.missing.map((m) => m.key)).toEqual(["intro.bye", "sign.exit"]);
  });

  it("import is one batch with one editAsset per strings file it changes", async () => {
    const result = await stringsImport({ file: join(root, "fr.csv"), dryRun: true }, ctx);
    expect(result.exitCode, result.text).toBe(0);
    expect(result.data).toMatchObject({ written: false, dryRun: true });
    expect(result.text).toContain("2 ops (editAsset, editAsset)");
    expect(await readFile(join(dir, "strings/ui.json"), "utf8")).not.toContain("jamais");
  });

  it("flags rows whose default text moved since the export, and writes them", async () => {
    const csv = (await readFile(join(root, "fr.csv"), "utf8")).replace("Yes.,Oui.", "Yes!,Oui !");
    await writeFile(join(root, "stale.csv"), csv);
    const result = await stringsImport({ file: join(root, "stale.csv") }, ctx);
    expect(result.exitCode, result.text).toBe(0);
    expect(result.data).toMatchObject({ stale: ["intro.yes"] });
    expect(result.text).toContain("1 key changed in en since the export: intro.yes");
  });

  it("refuses a CSV with a bad header, an unknown or repeated key, or a short record", async () => {
    const cases: [string, RegExp][] = [
      ["key,en,note\na,b,c\n", /header must be key,en,<locale>,note/],
      ["key,de,fr,note\nintro.yes,Yes.,Oui.,\n", /second column is "de"/],
      ["key,en,en,note\nintro.yes,Yes.,Yes.,\n", /the default locale/],
      [
        "key,en,fr,note\nintro.yess,Yes.,Oui.,\n",
        /no strings file holds "intro.yess"; did you mean "intro.yes"/,
      ],
      [
        "key,en,fr,note\nintro.yes,Yes.,Oui.,\nintro.yes,Yes.,Oui.,\n",
        /record 3: "intro.yes" is in the CSV twice/,
      ],
      ["key,en,fr,note\nintro.yes,Yes.\n", /record 2: 2 fields, expected 4/],
      ["key,en,fr,note\nIntro,Yes.,Oui.,\n", /"Intro" isn't a string key/],
    ];
    const before = await stringsFiles();
    for (const [csv, message] of cases) {
      await writeFile(join(root, "bad.csv"), csv);
      const result = await stringsImport({ file: join(root, "bad.csv") }, ctx);
      expect(result.exitCode, csv).toBe(2);
      expect(result.text).toMatch(message);
    }
    expect(await stringsFiles()).toEqual(before);
  });
});

describe("validate in a project", { timeout: 60_000 }, () => {
  type Issue = { code: string; severity: string; line?: number; entityIds: string[] };
  type Validated = {
    counts: Record<string, number>;
    issues: Issue[];
    project: { id: string; issues: Issue[] };
  };

  it("fails on a text key with no default text, and lists other docs' issues without failing", async () => {
    const result = await validate({ target: "sign" }, ctx);
    expect(result.exitCode).toBe(1);
    const data = result.data as Validated;
    expect(data.issues).toEqual([
      expect.objectContaining({ code: "string-key-missing", severity: "error", line: 17 }),
    ]);
    expect(data.project.id).toBe("lines");
    const others = data.project.issues.map((i) => `${i.code} ${i.entityIds[0]}`);
    expect(others).toEqual(
      expect.arrayContaining(["locale-unknown extra", "locale-unknown ui", "dup-id ui"]),
    );
    expect(result.text).toContain("project lines, other docs:");

    await writeFile(
      join(dir, "sign.json"),
      (await readFile(join(dir, "sign.json"), "utf8")).replace("sign.exit", "sign.welcome"),
    );
    const fixed = await validate({ target: "sign" }, ctx);
    expect(fixed.exitCode, fixed.text).toBe(0);
    expect((fixed.data as Validated).project.issues.length).toBeGreaterThan(0);
  });
});
