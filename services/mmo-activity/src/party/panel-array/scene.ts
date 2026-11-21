import "./scene.css";
import { centre, geometry, mount as mountScrub } from "../../scenes/scrub/scene.ts";
import { set, svg, text } from "../../shell/board.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { plural } from "../../units.ts";
import { PartyBar, familyHost, playArea, seatName } from "../wrap.ts";
import { panelOf, type PanelModel } from "./model.ts";

// How long grit that has just blown in is ringed.
const ARRIVED_MS = 1500;

/** Scrub's plate with this seat's band live and newly blown grit ringed on every screen. */
export function mount(host: PartySceneHost): Scene {
  const model = () => host.model as PanelModel;
  const n = host.layout.size;
  const pass = host.layout.pass ?? 0;
  const next = (host.seat + 1) % host.seats;
  const before = (host.seat + host.seats - 1) % host.seats;
  const rows = (p: number) =>
    Array.from({ length: n }, (_, r) => r).filter((r) => panelOf(r * n, n, host.seats) === p);

  // The family draws square cells on either shape: the bands are rows of
  // the same machine.
  const family = mountScrub(
    familyHost(host, {
      model: () => host.model,
      layout: { ...host.layout, shape: 0 },
      mine: (a) => panelOf(a, n, host.seats) === host.seat,
    }),
  );
  const bar = new PartyBar(
    host,
    `${seatName(host.seat)} of ${host.seats}. You rub the band of ${plural(rows(host.seat).length, "row")} marked yours. ${pass > 0 ? `Every ${plural(pass, "rub")} on a band blows a layer of grit onto the next band's reading.` : ""}`,
  );
  bar.view.root.classList.add("panel-array");

  let rings: SVGCircleElement[] = [];

  function build(): void {
    const geo = geometry(n, playArea(bar.size));
    const side = geo.cell * n;
    for (let p = 0; p < host.seats; p++) {
      const band = rows(p);
      if (band.length === 0) continue;
      const y = geo.y + band[0]! * geo.cell;
      const h = band.length * geo.cell;
      if (p !== host.seat)
        bar.view.root.append(svg("rect", { class: "theirs", x: geo.x, y, width: side, height: h }));
      else
        bar.view.root.append(
          svg("rect", { class: "band yours", x: geo.x, y, width: side, height: h }),
        );
      if (p > 0) bar.view.root.append(svg("path", { class: "seam", d: `M${geo.x},${y}h${side}` }));
      bar.view.root.append(
        text(p === host.seat ? "band-tag yours" : "band-tag", geo.x - 12, y + h / 2, String(p + 1)),
      );
    }
    rings = Array.from({ length: host.seats }, () =>
      svg("circle", { class: "arrived", r: geo.cell * 0.46 }),
    );
    bar.view.root.append(...rings);
  }

  function frame(at: number): void {
    family.frame(at);
    if (bar.fit()) build();
    const m = model();
    const geo = geometry(n, playArea(bar.size));
    let landed = false;
    for (const [p, ring] of rings.entries()) {
      const b = m.blown[p]!;
      const fresh = b.cell >= 0 && host.now() - b.at < ARRIVED_MS;
      const c = fresh ? centre(geo, b.cell) : { x: 0, y: 0 };
      set(ring, { cx: c.x, cy: c.y, class: fresh ? "arrived on" : "arrived" });
      if (fresh && p === host.seat) landed = true;
    }
    const left = m.untilBlow(host.seat);
    bar.say(
      rows(host.seat).length === 0
        ? "This plate has no band for you."
        : landed
          ? `${seatName(before)} blew grit onto your band.`
          : left > 0
            ? `${plural(left, "rub")} until grit blows onto ${seatName(next)}'s band.`
            : "Rub your band's reading clean.",
    );
  }

  return {
    frame,
    destroy() {
      family.destroy();
      bar.remove();
    },
  };
}
