import { describe, expect, it, vi } from "vite-plus/test";

import type { EditorNotify } from "../host";
import { createPending, type PendingStep } from "../pending/pending";

function fakeNotify() {
  const notify = Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  });
  return notify as typeof notify & EditorNotify;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const spec = { label: "Importing crate.png", scope: "project:import", error: "Import failed" };

describe("createPending", () => {
  it("adds the task before the work's first await and removes it once it settles", async () => {
    const pending = createPending({ notify: fakeNotify(), now: () => 42 });
    const work = deferred<string>();
    const result = pending.run(spec, () => work.promise);
    expect(pending.store.state.tasks).toEqual([
      {
        id: "project:import",
        label: "Importing crate.png",
        scope: "project:import",
        progress: null,
        startedAt: 42,
      },
    ]);
    expect(pending.busy("project:import")?.label).toBe("Importing crate.png");
    expect(pending.busy("panel:problems")).toBeUndefined();
    work.resolve("done");
    expect(await result).toEqual({ ok: true, value: "done" });
    expect(pending.store.state.tasks).toEqual([]);
    expect(pending.busy("project:import")).toBeUndefined();
  });

  it("joins a run whose id is running instead of starting the work again", async () => {
    const pending = createPending({ notify: fakeNotify() });
    const work = deferred<number>();
    const first = vi.fn(() => work.promise);
    const second = vi.fn(() => Promise.resolve(2));
    const a = pending.run({ ...spec, id: "import:crate" }, first);
    const b = pending.run({ ...spec, id: "import:crate" }, second);
    expect(b).toBe(a);
    expect(second).not.toHaveBeenCalled();
    expect(pending.store.state.tasks).toHaveLength(1);
    const other = pending.run({ ...spec, id: "import:tile" }, () => Promise.resolve(3));
    expect(pending.store.state.tasks).toHaveLength(2);
    work.resolve(1);
    expect(await a).toEqual({ ok: true, value: 1 });
    expect(await other).toEqual({ ok: true, value: 3 });
    // Settled, the id runs again.
    expect(await pending.run({ ...spec, id: "import:crate" }, second)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("keeps progress monotonic and takes a new label", async () => {
    const pending = createPending({ notify: fakeNotify() });
    const work = deferred<void>();
    let step!: PendingStep;
    const result = pending.run({ ...spec, total: 5 }, (s) => {
      step = s;
      return work.promise;
    });
    const task = () => pending.store.state.tasks[0];
    expect(task()?.progress).toEqual({ done: 0, total: 5 });
    step.progress(2);
    expect(task()?.progress).toEqual({ done: 2, total: 5 });
    step.progress(1);
    expect(task()?.progress).toEqual({ done: 2, total: 5 });
    step.progress(3, 6);
    expect(task()?.progress).toEqual({ done: 3, total: 6 });
    step.label("Importing tile.png");
    expect(task()?.label).toBe("Importing tile.png");
    expect(task()?.progress).toEqual({ done: 3, total: 6 });
    work.resolve();
    await result;
    step.progress(6);
    expect(pending.store.state.tasks).toEqual([]);
  });

  it("toasts one error, resolves { ok: false } and never rejects", async () => {
    const notify = fakeNotify();
    const pending = createPending({ notify });
    const boom = new Error("disk full");
    const work = deferred<void>();
    const result = pending.run(spec, () => work.promise);
    const joined = pending.run(spec, () => Promise.resolve());
    work.reject(boom);
    await expect(result).resolves.toEqual({ ok: false, error: boom });
    await expect(joined).resolves.toEqual({ ok: false, error: boom });
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalledWith("Import failed", { description: "disk full" });
    expect(notify.success).not.toHaveBeenCalled();
    expect(pending.store.state.tasks).toEqual([]);
  });

  it("titles the error toast from the error, and says success when asked", async () => {
    const notify = fakeNotify();
    const pending = createPending({ notify });
    await pending.run({ ...spec, error: (e) => `Couldn't import: ${String(e)}` }, () =>
      Promise.reject("nope"),
    );
    expect(notify.error).toHaveBeenCalledWith("Couldn't import: nope", { description: "nope" });
    await pending.run({ ...spec, success: (n: number) => `Imported ${n} files` }, async () => 3);
    expect(notify.success).toHaveBeenCalledWith("Imported 3 files");
    await pending.run({ ...spec, success: () => null }, async () => 0);
    expect(notify.success).toHaveBeenCalledTimes(1);
  });

  it("settles the task when the work throws synchronously", async () => {
    const notify = fakeNotify();
    const pending = createPending({ notify });
    const boom = new Error("bad path");
    const result = pending.run(spec, () => {
      throw boom;
    });
    expect(await result).toEqual({ ok: false, error: boom });
    expect(pending.store.state.tasks).toEqual([]);
    expect(notify.error).toHaveBeenCalledTimes(1);
  });

  it("holds until released, and announces a release's error once", () => {
    const notify = fakeNotify();
    const pending = createPending({ notify });
    const release = pending.hold({
      id: "checks",
      label: "Checking physics",
      scope: "panel:problems",
    });
    expect(pending.busy("panel:problems")?.label).toBe("Checking physics");
    release({ error: new Error("worker died"), errorTitle: "Checks failed" });
    release({ error: new Error("again") });
    expect(pending.store.state.tasks).toEqual([]);
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalledWith("Checks failed", { description: "worker died" });
  });

  it("keeps a held id busy until every hold of it is released", () => {
    const notify = fakeNotify();
    const pending = createPending({ notify });
    const hold = { id: "boot", label: "Opening the scene", scope: "editor" };
    const first = pending.hold(hold);
    const second = pending.hold(hold);
    expect(pending.store.state.tasks).toHaveLength(1);
    first();
    expect(pending.busy("editor")).toBeDefined();
    second();
    expect(pending.busy("editor")).toBeUndefined();
    pending.hold(hold)({});
    expect(pending.store.state.tasks).toEqual([]);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("names the newest task in a scope as busy", async () => {
    const pending = createPending({ notify: fakeNotify() });
    const a = deferred<void>();
    const b = deferred<void>();
    void pending.run({ ...spec, id: "a", label: "A" }, () => a.promise);
    void pending.run({ ...spec, id: "b", label: "B" }, () => b.promise);
    expect(pending.busy("project:import")?.label).toBe("B");
    b.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(pending.busy("project:import")?.label).toBe("A");
    a.resolve();
  });
});
