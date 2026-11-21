import circuit from "../../scenes/circuit/index.ts";
import { centre, geometry } from "../../scenes/circuit/scene.ts";
import { svg } from "../../shell/board.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { plural } from "../../units.ts";
import { PartyBar, familyHost, playArea } from "../wrap.ts";
import { region, type SplitGridModel } from "./model.ts";

/**
 * The circuit board cut into one region a seat: the family's board, where
 * only this seat's tiles turn, with every other seat's tiles shaded over.
 */
export function mount(host: PartySceneHost): Scene {
  const merged = () => host.model as SplitGridModel;
  const layout = host.layout;
  const n = layout.size;
  const hex = (layout.shape ?? 0) > 0;
  const board = circuit.mount(
    familyHost(host, {
      model: () => merged().grid,
      mine: (a) => region(layout, a) === host.seat,
    }),
  );
  const bar = new PartyBar(
    host,
    `The board is cut into ${plural(host.seats, "region")}, one a seat. Turn only the tiles of yours, the unshaded ones; the power has to cross the seams.`,
  );

  function build(): void {
    const area = playArea(bar.size);
    const geo = geometry(n, area, layout.shape ?? 0);
    for (let c = 0; c < n * n; c++) {
      if (region(layout, c) === host.seat) continue;
      const at = centre(geo, n, c);
      bar.view.root.append(
        hex
          ? svg("circle", { class: "theirs", cx: at.x, cy: at.y, r: geo.cell / 2 })
          : svg("rect", {
              class: "theirs",
              x: at.x - geo.cell / 2,
              y: at.y - geo.cell / 2,
              width: geo.cell,
              height: geo.cell,
            }),
      );
    }
  }

  return {
    frame(at) {
      board.frame(at);
      if (bar.fit()) build();
      bar.say("Your tiles are the bright ones");
    },
    destroy() {
      board.destroy();
      bar.remove();
    },
  };
}
