import type { PuzzleLayout, PuzzleMove } from "../../api.ts";
import signal from "../../scenes/signal/index.ts";
import type { Model, Scene, Status } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { plural } from "../../units.ts";
import { PartyBar, familyHost } from "../wrap.ts";
import { UNLOCKED, type RelayChainModel } from "./model.ts";

/** A seat's own panel, as the family's scope draws one: its knobs, numbered from 0. */
export function panelOf(layout: PuzzleLayout, seat: number, per: number): PuzzleLayout {
  const lo = seat * per;
  return { ...layout, size: per, target: layout.target?.slice(lo, lo + per) };
}

// The merged model seen through one seat's panel.
class Panel implements Model {
  constructor(
    private readonly merged: () => RelayChainModel,
    private readonly seat: number,
  ) {}

  private get lo(): number {
    return this.seat * this.merged().per;
  }

  get knobs(): number[] {
    const m = this.merged();
    return m.knobs.slice(this.lo, this.lo + m.per);
  }

  matched(): boolean {
    return this.merged().tuned(this.seat);
  }

  run(at: number): [Status, number] {
    return this.merged().run(at);
  }

  apply(m: PuzzleMove): Status {
    return this.merged().apply({ ...m, a: m.a + this.lo, seat: this.seat });
  }

  snapshot(): number[] {
    return this.knobs;
  }
}

/**
 * One link of the relay chain: the family's scope and knobs for this
 * seat's own panel, and in the bar a lock lamp for every seat's panel. The
 * chain holds when every panel locks within the window of the last.
 */
export function mount(host: PartySceneHost): Scene {
  const merged = () => host.model as RelayChainModel;
  const per = merged().per;
  const lo = host.seat * per;
  const panel = new Panel(merged, host.seat);
  const scope = signal.mount(
    familyHost(host, {
      model: () => panel,
      layout: panelOf(host.layout, host.seat, per),
      mine: () => true,
      out: (a, b, c) => [a + lo, b, c],
      in: (m) => (merged().panelOf(m.a) === host.seat ? { ...m, a: m.a - lo } : undefined),
    }),
  );
  const bar = new PartyBar(
    host,
    `A relay chain of ${plural(host.seats, "panel")}, one a seat. Tune your own knobs until your panel locks; the chain holds when every panel locks close together.`,
  );

  function line(m: RelayChainModel): string {
    const waiting = m.lock.filter((at) => at === UNLOCKED).length;
    if (m.lock[host.seat] === UNLOCKED) return "Tune your panel to lock it";
    return waiting > 0 ? `Locked · waiting on ${plural(waiting, "panel")}` : "Every panel locked";
  }

  return {
    frame(at) {
      scope.frame(at);
      bar.fit();
      const m = merged();
      bar.say(line(m));
      for (let s = 0; s < host.seats; s++) bar.light(s, m.lock[s] !== UNLOCKED);
    },
    destroy() {
      scope.destroy();
      bar.remove();
    },
  };
}
