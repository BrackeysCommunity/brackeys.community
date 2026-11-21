import "./scene.css";
import { DOWN } from "../../scenes/splice/model.ts";
import { centre, geometry, mount as mountSplice } from "../../scenes/splice/scene.ts";
import { set, svg, text } from "../../shell/board.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { plural } from "../../units.ts";
import { PartyBar, familyHost, playArea, seatName } from "../wrap.ts";
import type { SolderModel } from "./model.ts";

// How long a touch made while another seat has the iron is answered.
const REFUSED_MS = 1200;

interface Joint {
  /** The position that starts a segment. */
  at: number;
  ring: SVGCircleElement;
  tag: SVGTextElement;
}

/**
 * Relay solder: Splice's board, its trace cut into segments of a few
 * positions, each a seat's. The iron is in one seat's hand; at the end of
 * a segment it lifts, and the next seat sets it down at the joint.
 */
export function mount(host: PartySceneHost): Scene {
  const model = () => host.model as SolderModel;
  const cols = host.layout.size;
  const rows = host.layout.range ?? 0;
  const length = host.layout.order?.length ?? 0;
  const pass = host.layout.pass ?? 0;

  // A finger put down while another seat has the iron does not reach the
  // board, so no stray iron is drawn here.
  let refused = 0;
  const down = (ev: PointerEvent) => {
    if (model().seatFor(DOWN) === host.seat) return;
    refused = performance.now() + REFUSED_MS;
    ev.stopImmediatePropagation();
  };
  host.surface.addEventListener("pointerdown", down, { capture: true });

  // The family draws its flat board on either shape: the segments are
  // the same trace.
  const family = mountSplice(
    familyHost(host, {
      model: () => host.model,
      layout: { ...host.layout, shape: 0 },
      mine: (_a, _b, c) => model().seatFor(c) === host.seat,
    }),
  );
  const bar = new PartyBar(
    host,
    `${seatName(host.seat)} of ${host.seats}. The trace is cut into segments of ${plural(pass, "position")}, each a seat's. At the end of a segment the iron lifts, and the next seat sets it down at the joint.`,
  );
  bar.view.root.classList.add("relay-solder");

  let joints: Joint[] = [];

  function build(): void {
    joints = [];
    for (let at = 0; pass > 0 && at < length; at += pass) {
      const ring = svg("circle", { class: "joint" });
      const tag = text("joint-tag", 0, 0, String(model().ironAt(at) + 1));
      bar.view.root.append(ring, tag);
      joints.push({ at, ring, tag });
    }
  }

  function line(m: SolderModel, holder: number): string {
    if (holder !== host.seat)
      return `${performance.now() < refused ? "Wait: " : ""}${seatName(holder)} has the iron.`;
    if (m.k === 0) return "Set the iron down at the left end.";
    if (m.ironAt(m.k - 1) !== host.seat) return "The iron is yours: set it down at the joint.";
    return m.on ? "You have the iron." : "Set the iron down past the gap.";
  }

  function frame(at: number): void {
    family.frame(at);
    if (bar.fit()) build();
    const m = model();
    const geo = geometry(cols, rows, playArea(bar.size));
    const r = Math.min(geo.w, geo.h) * 0.58;
    for (const j of joints) {
      const p = centre(geo, m.cell(j.at));
      const seat = m.ironAt(j.at);
      const cls = `${seat === host.seat ? " yours" : ""}${j.at <= m.k && m.k < j.at + pass ? " now" : ""}${j.at + pass <= m.k ? " past" : ""}`;
      set(j.ring, { cx: p.x, cy: p.y, r, class: `joint${cls}` });
      set(j.tag, { x: p.x, y: p.y - r - 8, class: `joint-tag${cls}` });
    }
    const holder = m.seatFor(DOWN);
    for (let s = 0; s < host.seats; s++) bar.light(s, s === holder, "holds");
    bar.say(line(m, holder));
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
