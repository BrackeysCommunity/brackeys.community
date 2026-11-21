import "./scene.css";
import { geometry, land, mount as mountLeak } from "../../scenes/leak/scene.ts";
import { letter, pointIn, say, set, sizeOf, svg, text } from "../../shell/board.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { PartyBar, familyHost, playArea, seatName } from "../wrap.ts";
import { runOf, type PipeModel } from "./model.ts";

// How long a touch on another seat's run is answered in the bar, the
// share of a gauge under which it is marked low, and the gap between two
// runs' gauges.
const REFUSED_MS = 1200;
const LOW = 0.3;
const GAP = 8;

interface Gauge {
  label: SVGTextElement;
  fill: SVGRectElement;
}

/** Leak's pipe in runs, this seat's joints lit and the others' dimmed. */
export function mount(host: PartySceneHost): Scene {
  const model = () => host.model as PipeModel;
  const n = host.layout.size;
  const yours = (slot: number) => runOf(slot, host.seats) === host.seat;
  const joints = Array.from({ length: n }, (_, s) => s)
    .filter(yours)
    .map(letter)
    .join(", ");

  let refused: { slot: number; until: number } | undefined;
  const down = (ev: PointerEvent) => {
    const geo = geometry(n, playArea(sizeOf(host.surface)));
    const { slot } = land(geo, pointIn(host.surface, ev));
    if (slot === undefined || yours(slot)) return;
    refused = { slot, until: performance.now() + REFUSED_MS };
    ev.stopImmediatePropagation();
  };
  host.surface.addEventListener("pointerdown", down, { capture: true });

  // The family draws its straight pipe on either shape: the runs are the
  // same machine.
  const family = mountLeak(
    familyHost(host, {
      model: () => host.model,
      layout: { ...host.layout, shape: 0 },
      mine: (a) => yours(a),
    }),
  );
  host.surface.querySelector("svg.board.leak")?.classList.add("party-family");
  const bar = new PartyBar(
    host,
    `${seatName(host.seat)} of ${host.seats}. Your run is joints ${joints}, with its own gauge. Any run that runs dry empties the whole tank.`,
  );
  bar.view.root.classList.add("pipe-crew");

  let gauges: Gauge[] = [];

  function build(): void {
    const geo = geometry(n, playArea(bar.size));
    const width = (geo.width - GAP * (host.seats - 1)) / host.seats;
    gauges = Array.from({ length: host.seats }, (_, r) => {
      const x = geo.x + r * (width + GAP);
      const label = text("run-label", x, 18);
      const fill = svg("rect", { class: "run-fill", x, y: geo.top, width, height: geo.bar });
      bar.view.root.append(
        label,
        svg("rect", {
          class: r === host.seat ? "run-track yours" : "run-track",
          x,
          y: geo.top,
          width,
          height: geo.bar,
        }),
        fill,
      );
      return { label, fill };
    });
    for (const [s, at] of geo.slots.entries())
      if (!yours(s))
        bar.view.root.append(svg("circle", { class: "theirs", cx: at.x, cy: at.y, r: geo.r + 6 }));
      else
        bar.view.root.append(
          svg("circle", { class: "run-ring", cx: at.x, cy: at.y, r: geo.r + 6 }),
        );
  }

  function frame(at: number): void {
    family.frame(at);
    if (bar.fit()) build();
    const m = model();
    const geo = geometry(n, playArea(bar.size));
    const width = (geo.width - GAP * (host.seats - 1)) / host.seats;
    for (const [r, g] of gauges.entries()) {
      const share = Math.max(0, m.g[r]!) / Math.max(1, m.full);
      const low = share < LOW;
      const who = r === host.seat ? "Your run" : `${seatName(r)}'s run`;
      say(g.label, low ? `${who}: low!` : who);
      set(g.label, { class: low ? "run-label low" : "run-label" });
      set(g.fill, { width: width * share, class: low ? "run-fill low" : "run-fill" });
    }
    if (refused && performance.now() > refused.until) refused = undefined;
    bar.say(
      refused
        ? `Joint ${letter(refused.slot)} is on ${seatName(runOf(refused.slot, host.seats))}'s run.`
        : `Your joints: ${joints}.`,
    );
  }

  return {
    frame,
    destroy() {
      host.surface.removeEventListener("pointerdown", down, { capture: true });
      family.destroy();
      bar.remove();
    },
  };
}
