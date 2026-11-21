import rewire from "../../scenes/rewire/index.ts";
import { geometry, pick } from "../../scenes/rewire/scene.ts";
import { letter, pointers, set, svg, text } from "../../shell/board.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { plural } from "../../units.ts";
import { PartyBar, familyHost, playArea } from "../wrap.ts";
import { EMPTY, GRAB, PLUG, type BigRewireModel } from "./model.ts";

/** The junction box with every hand's held wire ringed and labelled with its seat. */
export function mount(host: PartySceneHost): Scene {
  const merged = () => host.model as BigRewireModel;
  const layout = host.layout;
  const n = layout.size;
  const shape = layout.shape ?? 0;
  let geo = geometry(n, playArea({ width: 1, height: 1 }), shape);

  // Ahead of the box's own handler, so the grab lands before its drag starts.
  const unbind = pointers(host.surface, {
    down(p) {
      const m = merged();
      const wire = pick(geo, m.at, p);
      if (wire !== undefined && m.hold[host.seat] === EMPTY && m.holderOf(wire) === undefined)
        host.move(wire, 0, GRAB);
      return false;
    },
  });
  const box = rewire.mount(
    familyHost(host, {
      model: () => merged(),
      mine: (a) => merged().hold[host.seat] === a,
      out: (a, b) => [a, b, PLUG],
      in: (m) => ((m.c ?? 0) === GRAB ? undefined : m),
    }),
  );
  const bar = new PartyBar(
    host,
    `A junction box of ${plural(n, "wire")} for ${plural(host.seats, "seat")}. Press a plug to hold its wire and drop it in its port; a plug run across a wire another hand holds drops every hand.`,
  );
  let rings: SVGGElement[] = [];

  function build(): void {
    geo = geometry(n, playArea(bar.size), shape);
    rings = Array.from({ length: host.seats }, (_, s) => {
      const tag = text("held-tag", 0, -geo.r * 1.3, String(s + 1));
      const g = svg(
        "g",
        { display: "none" },
        svg("circle", { class: "held", r: geo.r * 1.08 }),
        tag,
      );
      bar.view.root.append(g);
      return g;
    });
  }

  function line(m: BigRewireModel): string {
    const mine = m.hold[host.seat]!;
    if (mine !== EMPTY) return `You hold wire ${letter(mine)}: drop it in a port`;
    const others = m.hold.filter((h) => h !== EMPTY).length;
    return others > 0
      ? `${plural(others, "wire")} held · press a plug`
      : "Press a plug to hold its wire";
  }

  return {
    frame(at) {
      box.frame(at);
      if (bar.fit()) build();
      const m = merged();
      for (const [s, ring] of rings.entries()) {
        const h = m.hold[s]!;
        const p = h === EMPTY ? undefined : geo.seats[m.at[h]!];
        set(
          ring,
          p ? { display: "inline", transform: `translate(${p.x} ${p.y})` } : { display: "none" },
        );
      }
      bar.say(line(m));
      for (let s = 0; s < host.seats; s++) bar.light(s, m.hold[s] !== EMPTY, "holds");
    },
    destroy() {
      unbind();
      box.destroy();
      bar.remove();
    },
  };
}
