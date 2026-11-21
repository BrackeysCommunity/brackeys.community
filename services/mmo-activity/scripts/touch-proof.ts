import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ActionReply,
  ActionRequest,
  ActivityState,
  OperatorRequest,
  ServerMessage,
  TokenReply,
} from "../src/api.ts";
import { RewireModel } from "../src/scenes/rewire/model.ts";
import { DONE } from "../src/shell/kit.ts";

/**
 * The Activity's production build in a headless Chrome the size of a
 * phone, against a live local world: the opening Rewire and one past the
 * phone's cap are solved by touch events alone, and the world says so. Run
 * it with Bun:
 *
 *   MMO_URL=http://localhost:18080 MMO_ACTIVITY_URL=http://localhost:18787 \
 *   MMO_OPERATOR_TOKEN=local-operator bun scripts/touch-proof.ts [out dir]
 *
 * The world must be disposable with MMO_ACTIVITY_DEV=1 and serve the
 * build (MMO_ACTIVITY_DIR). CHROME names the browser when it is not the
 * macOS default. Screenshots land in the out dir when one is given.
 */

const world = process.env.MMO_URL ?? "http://localhost:8080";
const activity = (process.env.MMO_ACTIVITY_URL ?? "").replace(/\/$/, "");
const operator = process.env.MMO_OPERATOR_TOKEN ?? "";
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = process.argv[2];
const PHONE = { width: 375, height: 812 };
// The level of the second Rewire, past the phone's cap of six wires at full size.
const LEVEL = 9;
const WAIT_MS = 20_000;

if (!activity) throw new Error("MMO_ACTIVITY_URL must name the world's Activity listener");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(
  what: string,
  f: () => Promise<T | undefined> | T | undefined,
  page?: Page,
): Promise<T> {
  for (const end = Date.now() + WAIT_MS; Date.now() < end; await sleep(50)) {
    const got = await f();
    if (got !== undefined) return got;
  }
  const shows = page ? `; the page shows: ${await page.text()}` : "";
  throw new Error(`timed out waiting for ${what}${shows}`);
}

async function post<T>(url: string, body: unknown, token = ""): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// The Chrome DevTools Protocol over one page's socket.
class Page {
  private n = 0;
  private waiting = new Map<
    number,
    (v: { result?: unknown; error?: { message: string } }) => void
  >();

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      this.waiting.get(msg.id)?.(msg);
      this.waiting.delete(msg.id);
    });
  }

  send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = ++this.n;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (msg) =>
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result as T),
      );
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async read<T>(expression: string): Promise<T> {
    const got = await this.send<{ result: { value: T } }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    return got.result.value;
  }

  /** What the page says, on one line. */
  async text(): Promise<string> {
    const text = await this.read<string>(`document.querySelector("#app")?.innerText ?? ""`);
    return text.split(/\n+/).join(" | ");
  }

  /** One finger down and up on the button that says this. */
  async tap(label: string): Promise<void> {
    const at = await until(
      `the ${label} button`,
      () =>
        this.read<{ x: number; y: number } | undefined>(
          `(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return undefined; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
        ),
      this,
    );
    await sleep(100);
    await this.touch("touchStart", [at]);
    await sleep(40);
    await this.touch("touchEnd", []);
    await sleep(200);
  }

  private touch(type: string, points: { x: number; y: number }[]): Promise<unknown> {
    return this.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p) => ({ ...p, id: 1, radiusX: 11, radiusY: 11, force: 1 })),
    });
  }

  /** One finger down at from, dragged to to, and lifted. */
  async drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await this.touch("touchStart", [from]);
    for (let i = 1; i <= 8; i++) {
      await sleep(16);
      const t = i / 8;
      await this.touch("touchMove", [
        { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
      ]);
    }
    await sleep(16);
    await this.touch("touchEnd", []);
    await sleep(120);
  }

  async shot(name: string): Promise<void> {
    if (!out) return;
    const { data } = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(out, name), Buffer.from(data, "base64"));
  }
}

async function browser(): Promise<{ page: Page; close(): void }> {
  const profile = mkdtempSync(join(tmpdir(), "mmo-touch-"));
  const proc = spawn(
    chrome,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let log = "";
  proc.stderr.on("data", (d) => (log += String(d)));
  const port = await until(
    "Chrome's debugging port",
    () => /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log)?.[1],
  );
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
    type: string;
    webSocketDebuggerUrl: string;
  }[];
  const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  return {
    page: new Page(ws),
    close() {
      ws.close();
      proc.kill();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

// The script's own seat beside the page's: it reads what the world says.
async function watch(
  discord: string,
): Promise<{ state(): ActivityState | undefined; close(): void }> {
  const tok = await post<TokenReply>(`${activity}/api/activity/token`, { dev: discord });
  const ws = new WebSocket(`${activity.replace(/^http/, "ws")}/api/activity/ws`);
  let state: ActivityState | undefined;
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    if (msg.t === "state") state = msg.state;
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  ws.send(
    JSON.stringify({
      t: "hello",
      hello: { session: tok.session, instance: "touch-proof", viewer: { compact: true } },
    }),
  );
  await until("the watcher's first state", () => state);
  return { state: () => state, close: () => ws.close() };
}

interface Seen {
  wires: number;
  drags: number;
  compact: boolean;
  level: number;
  solvedAt: number;
  clean: boolean;
  hit: number;
}

// Solves the Rewire on the page by dragging each plug to its port, and
// waits for the world to say so.
async function rewire(
  page: Page,
  eye: { state(): ActivityState | undefined },
  intro: boolean,
): Promise<Seen> {
  const rest = await until("a Rewire at rest", () => {
    const m = eye.state()?.machine;
    return m && m.family === "rewire" && !m.armed && Boolean(m.intro) === intro ? m : undefined;
  });
  const n = rest.layout.size;
  // The page has drawn this machine when its box holds this many seats.
  const box = () =>
    page.read<{ x: number; y: number; r: number }[]>(
      `[...document.querySelectorAll("svg.board.rewire circle.seat")].map((c) => { const b = c.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, r: b.width / 2 }; })`,
    );
  await until(
    "the junction box on the page",
    async () => ((await box()).length === n ? true : undefined),
    page,
  );
  // The page settles (fonts, the bar) before the seats are where a finger finds them.
  await sleep(500);
  const seats = await box();
  await page.shot(intro ? "1-opening-rewire-at-rest.png" : "3-rewire-at-rest.png");
  const model = new RewireModel(rest.layout);
  const target = rest.layout.target ?? [];
  let drags = 0;
  let compact = false;
  let level = 0;
  for (let w = 0; w < n; w++) {
    if (model.at[w] === target[w]) continue;
    await page.drag(seats[model.at[w]!]!, seats[target[w]!]!);
    drags++;
    const st = model.apply({ at: 0, a: w, b: target[w]! });
    if (drags === 1) {
      const armed = await until(
        "the machine armed by the first drop",
        () => {
          const m = eye.state()?.machine;
          return m?.armed ? m : undefined;
        },
        page,
      );
      compact = Boolean(armed.compact);
      level = armed.level ?? 0;
      await page.shot(intro ? "2-opening-rewire-armed.png" : "4-rewire-armed.png");
    }
    if (st === DONE) break;
  }
  const last = await until(
    "the world's word that it was solved",
    () => {
      const st = eye.state();
      return st && !st.character.armed && st.last?.family === "rewire" ? st.last : undefined;
    },
    page,
  );
  if (!last.result.solved)
    throw new Error(`the Rewire was not solved: ${JSON.stringify(last.result)}`);
  await sleep(400);
  await page.shot(intro ? "2b-opening-rewire-solved.png" : "5-rewire-solved.png");
  return {
    wires: n,
    drags,
    compact,
    level,
    solvedAt: last.result.at,
    clean: last.result.clean,
    hit: Math.round(Math.min(...seats.map((s) => s.r))),
  };
}

async function main(): Promise<void> {
  if (out) mkdirSync(out, { recursive: true });
  const run = Date.now().toString(36);
  const discord = `touch-${run}`;
  const made = await post<ActionReply>(`${world}/v1/actions`, {
    interactionId: `touch-new-${run}`,
    discordId: discord,
    kind: "create",
    option: "knife",
  } satisfies Partial<ActionRequest>);
  const set = (n: number, level: number) =>
    post<ActionReply>(
      `${world}/v1/operator`,
      {
        interactionId: `touch-set-${run}-${n}`,
        characterId: made.character.id,
        kind: "set-machine",
        asset: "rewire",
        units: level,
        note: "the touch proof",
      } satisfies OperatorRequest,
      operator,
    );
  await set(0, 1);
  const eye = await watch(discord);
  const { page, close } = await browser();
  try {
    await page.send("Emulation.setDeviceMetricsOverride", {
      ...PHONE,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await page.send("Page.enable");
    await page.send("Page.navigate", { url: `${activity}/?as=${discord}` });
    const pointer = await until("the page", async () =>
      (await page.read<boolean>(`document.querySelector("svg.board") !== null`))
        ? page.read<{ coarse: boolean; w: number; h: number; touch: number }>(
            `({ coarse: matchMedia("(pointer: coarse)").matches, w: innerWidth, h: innerHeight, touch: navigator.maxTouchPoints })`,
          )
        : undefined,
    );
    const first = await rewire(page, eye, true);
    await page.tap("Carry on");
    await set(1, LEVEL);
    const second = await rewire(page, eye, false);
    console.log(
      JSON.stringify(
        { viewport: pointer, opening: first, rewire: second, page: await page.text() },
        null,
        2,
      ),
    );
    if (!second.compact) throw new Error("a phone-sized page did not arm a compact machine");
  } finally {
    close();
    eye.close();
  }
}

await main();
