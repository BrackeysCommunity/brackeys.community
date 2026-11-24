import { describe, expect, test } from "bun:test";

import {
  costMicros,
  type ModelCall,
  type ModelReply,
  type NarrationModel,
  stubModel,
  USE_CONFIG,
  type UseId,
  USES,
} from "../../../packages/mmo-narrate/src/index.ts";
import { callsPerDay, SCALES, VOLUME } from "../../../packages/mmo-narrate/src/volume.ts";
import {
  costMarkdown,
  costNarrator,
  measure,
  parseCostArgs,
  REAL_MOST_CALLS,
  REAL_SAMPLE,
  realRun,
  realSamples,
  samples,
  stubFigure,
} from "../scripts/narration-cost.ts";

/** The stub, keeping every reply it gave beside the call it answered. */
function recordingStub(): NarrationModel & { replies: { call: ModelCall; reply: ModelReply }[] } {
  const stub = stubModel();
  const replies: { call: ModelCall; reply: ModelReply }[] = [];
  return {
    replies,
    async complete(call, signal) {
      const reply = await stub.complete(call, signal);
      replies.push({ call, reply });
      return reply;
    },
  };
}

describe("the stub figure", () => {
  test("is the same every run, and covers every use with accepted calls", async () => {
    const a = await stubFigure();
    const b = await stubFigure();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(costMarkdown(b)).toBe(costMarkdown(a));
    expect(a.fellBack).toEqual([]);
    for (const use of USES) {
      const f = a.uses[use];
      expect(f, use).toBeDefined();
      expect(f!.calls, use).toBeGreaterThan(0);
      expect(f!.usdMicros, use).toBeGreaterThan(0);
      expect(f!.model, use).toBe(USE_CONFIG[use].model);
    }
    expect(a.totals.small).toBeGreaterThan(0);
    expect(a.totals.large).toBeGreaterThan(a.totals.small);
  });

  test("a world day is calls a day times dollars a call, summed over the uses", async () => {
    const f = await stubFigure();
    for (const s of ["small", "large"] as const) {
      let sum = 0;
      for (const use of USES) {
        const u = f.uses[use]!;
        const calls = callsPerDay(use, SCALES[s]);
        expect(u.perDay[s].calls, use).toBe(calls);
        expect(u.perDay[s].usdMicros, use).toBe(Math.round((calls * u.usdMicros) / u.calls));
        sum += u.perDay[s].usdMicros;
      }
      expect(f.totals[s]).toBe(sum);
    }
    const md = costMarkdown(f);
    expect(md).toContain("## 1 server, 50 players");
    expect(md).toContain("## 100 servers, 5,000 players");
    for (const use of USES) expect(md).toContain(VOLUME[use].source);
  });
});

describe("the ledger arithmetic", () => {
  test("a simulated day's ledger is the sum of costMicros over its calls, to the micro-dollar", async () => {
    const model = recordingStub();
    const narrator = costNarrator(model, 1_000, () => {});
    const list = await samples();
    // The day's calls, then the same prompts again: cache hits that cost nothing.
    const first = await measure(narrator, list);
    expect(first.fellBack).toEqual([]);
    const again = await measure(narrator, list);
    expect(model.replies).toHaveLength(list.length);

    const want = new Map<UseId, { calls: number; micros: number; input: number; output: number }>();
    let total = 0;
    for (const { call, reply } of model.replies) {
      const micros = costMicros(call.model, reply.usage);
      total += micros;
      const w = want.get(call.use) ?? { calls: 0, micros: 0, input: 0, output: 0 };
      w.calls++;
      w.micros += micros;
      w.input += reply.usage.input;
      w.output += reply.usage.output;
      want.set(call.use, w);
    }
    expect(again.ledger.usdMicros).toBe(total);
    expect(first.ledger.usdMicros).toBe(total);
    for (const [use, w] of want) {
      expect(again.ledger.uses[use], use).toMatchObject({
        calls: w.calls,
        hits: w.calls,
        usdMicros: w.micros,
        input: w.input,
        output: w.output,
        cacheRead: 0,
        cacheWrite: 0,
      });
    }
  });
});

describe("volume", () => {
  test("calls a world day follow the stated rules at both scales", () => {
    const at = (use: UseId) => [callsPerDay(use, SCALES.small), callsPerDay(use, SCALES.large)];
    expect(at("chronicle")).toEqual([1, 100]);
    expect(at("stage")).toEqual([0.5, 0.5]);
    expect(at("recap")).toEqual([25, 2_500]);
    expect(at("voice")).toEqual([75, 7_500]);
    expect(at("names")).toEqual([2.5, 52]);
    expect(at("screen")[1]).toBeCloseTo(15);
    expect(at("summary")).toEqual([0.5, 50]);
    expect(at("digest")).toEqual([1 / 7, 1 / 7]);
    expect(at("proposals")).toEqual([1 / 14, 1 / 14]);
    expect(at("pool")).toEqual([0, 0]);
    for (const use of USES) expect(VOLUME[use].source.length, use).toBeGreaterThan(0);
  });
});

describe("the real run's caps, with no network", () => {
  test("its arguments refuse more than 30 calls or 50 cents", () => {
    expect(parseCostArgs(["--out", "x"])).toMatchObject({ mode: "stub" });
    expect(parseCostArgs(["--real", "--calls", "30", "--usd", "0.50", "--out", "x"])).toEqual({
      mode: "real",
      out: "x",
      calls: 30,
      usd: 0.5,
    });
    expect(parseCostArgs(["--real", "--calls", "31", "--usd", "0.5", "--out", "x"])).toContain(
      "over the cap",
    );
    expect(parseCostArgs(["--real", "--calls", "5", "--usd", "0.6", "--out", "x"])).toContain(
      "over the cap",
    );
    expect(typeof parseCostArgs(["--real", "--calls", "0", "--out", "x"])).toBe("string");
    expect(typeof parseCostArgs(["--stub", "--calls", "3", "--out", "x"])).toBe("string");
    expect(typeof parseCostArgs(["--real"])).toBe("string");
  });

  test("the sample is 8 chronicle, 4 stage, 6 recap, 6 voice, 3 names, 2 summary and 1 screen", async () => {
    const all = await samples();
    const full = realSamples(all, REAL_MOST_CALLS);
    expect(full).toHaveLength(30);
    const counts: Partial<Record<UseId, number>> = {};
    for (const s of full) counts[s.use] = (counts[s.use] ?? 0) + 1;
    expect(counts).toEqual(REAL_SAMPLE);
    // A smaller run still reaches every sampled use first.
    expect(new Set(realSamples(all, 7).map((s) => s.use)).size).toBe(7);
  });

  test("it stops before a call whose upper estimate would cross the cap", async () => {
    const stub = await stubFigure();
    const model = recordingStub();
    const tight = await realRun(model, 30, 0.000_1, stub, () => {});
    expect(model.replies).toHaveLength(0);
    expect(tight.stopped).toContain("before chronicle");
    expect(tight.figure.real).toMatchObject({ calls: 0, usdMicros: 0 });
    expect(tight.figure.uses.chronicle?.from).toBe("stub");

    const roomy = recordingStub();
    const r = await realRun(roomy, 30, 0.5, stub, () => {});
    expect(r.stopped).toBeUndefined();
    expect(roomy.replies).toHaveLength(30);
    expect(r.figure.real!.calls).toBe(30);
    const spent = roomy.replies.reduce((n, x) => n + costMicros(x.call.model, x.reply.usage), 0);
    expect(r.figure.real!.usdMicros).toBe(spent);
    expect(r.figure.uses.chronicle).toMatchObject({ from: "real", calls: 8 });
    expect(r.figure.uses.pool?.from).toBe("stub");
  });
});
