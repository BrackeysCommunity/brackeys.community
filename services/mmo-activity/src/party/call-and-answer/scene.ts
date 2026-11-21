import "./scene.css";
import { Unseen } from "../../api.ts";
import { geometry, mount as mountOverride } from "../../scenes/override/scene.ts";
import { glyph, glyphName, pieceColour, say, set, svg, text } from "../../shell/board.ts";
import type { Scene } from "../../shell/kit.ts";
import type { PartySceneHost } from "../../shell/party-registry.ts";
import { PartyBar, familyHost, playArea, seatName } from "../wrap.ts";
import { CALL, type CallModel } from "./model.ts";

// The calls the screen keeps in view, newest last.
const SHOWN = 4;

/**
 * Call and answer: Override's terminal with its screen dark. One seat
 * holds the keypad and presses; every other seat was dealt some of the
 * sequence's symbols, and a tap on a pad calls that symbol to the others.
 * The calls line up on every screen, and the keypad passes each round.
 */
export function mount(host: PartySceneHost): Scene {
  const model = () => host.model as CallModel;
  const symbols = Math.max(1, host.layout.range ?? 1);
  const keypad = () => model().keypad === host.seat;

  // The family draws its grid of pads on either shape: a ring pad is the
  // same keypad.
  const family = mountOverride(
    familyHost(host, {
      model: () => host.model,
      layout: { ...host.layout, shape: 0 },
      mine: () => true,
      // Off the keypad, a pad tapped is a call of its symbol.
      out: (a, b, c) => (keypad() ? [a, b, c] : [a, 0, CALL]),
    }),
  );
  host.surface.querySelector("svg.board.override")?.classList.add("party-family");
  const bar = new PartyBar(
    host,
    `${seatName(host.seat)} of ${host.seats}. One seat holds the keypad and presses the sequence; the others were each dealt some of its symbols, and tap a pad to call one. The keypad passes each round.`,
  );
  bar.view.root.classList.add("call-and-answer");

  let said: SVGTextElement | undefined;
  let next: SVGGElement | undefined;
  let calls: SVGGElement | undefined;
  let lastCalls = -1;
  let lastNext = Number.NaN;

  function build(): void {
    const { screen } = geometry(symbols, playArea(bar.size));
    said = text("cs-said", screen.x + 12, screen.y + 20);
    next = svg("g", { class: "cs-next" });
    calls = svg("g", { class: "cs-calls" });
    bar.view.root.append(said, next, calls);
    lastCalls = -1;
    lastNext = Number.NaN;
  }

  function drawCalls(m: CallModel): void {
    const { screen } = geometry(symbols, playArea(bar.size));
    const shown = m.calls.slice(-SHOWN);
    const r = Math.min(screen.height * 0.18, 20);
    const gap = r * 3;
    const y = screen.y + screen.height / 2 + 4;
    const right = screen.x + screen.width - 12 - r;
    calls!.replaceChildren(
      ...shown.flatMap((call, i) => {
        const x = right - (shown.length - 1 - i) * gap;
        const fade = i === shown.length - 1 ? "cs-call last" : "cs-call";
        return [
          svg("g", { class: fade }, glyph(call.symbol, { x, y }, r, pieceColour(call.symbol))),
          text("cs-who", x, y + r + 14, call.seat === host.seat ? "You" : seatName(call.seat)),
        ];
      }),
    );
  }

  function drawNext(symbol: number): void {
    const { screen } = geometry(symbols, playArea(bar.size));
    const r = Math.min(screen.height * 0.24, 26);
    const at = { x: screen.x + 18 + r, y: screen.y + screen.height / 2 + 6 };
    next!.replaceChildren(
      ...(symbol === Unseen ? [] : [glyph(symbol, at, r, pieceColour(symbol))]),
    );
  }

  function frame(at: number): void {
    family.frame(at);
    if (bar.fit()) build();
    const m = model();
    if (m.calls.length !== lastCalls) {
      lastCalls = m.calls.length;
      drawCalls(m);
    }
    // The next symbol shows only on the screen of the seat dealt it.
    const want = m.wanted();
    const { entered } = m.progress();
    const caller = entered % host.seats;
    const yours = want !== Unseen && m.sees(host.seat, entered);
    // A glimpse of the next seat's part shows its symbol before it is called.
    const glimpsed =
      !yours && caller === (host.seat + 1) % host.seats
        ? (host.glimpse?.order?.[entered] ?? Unseen)
        : Unseen;
    const shown = yours ? want : glimpsed;
    if (shown !== lastNext) {
      lastNext = shown;
      drawNext(shown);
    }
    set(next!, {
      class: yours ? "cs-next on" : glimpsed !== Unseen ? "cs-next on glimpse" : "cs-next",
    });
    const done = m.k >= (host.layout.size * (host.layout.size + 1)) / 2;
    const line = done
      ? ""
      : keypad()
        ? yours
          ? `Press ${glyphName(want)}: it is yours.`
          : glimpsed !== Unseen
            ? `${seatName(caller)} calls ${glyphName(glimpsed)} next.`
            : `${seatName(caller)} calls next. Press what is called.`
        : yours
          ? `Call ${glyphName(want)}: tap its pad.`
          : glimpsed !== Unseen
            ? `${seatName(caller)} calls ${glyphName(glimpsed)} next.`
            : `${seatName(caller)} calls next.`;
    set(said!, { class: yours ? "cs-said yours" : "cs-said" });
    say(said!, line);
    for (let s = 0; s < host.seats; s++) bar.light(s, s === m.keypad, "holds");
    bar.say(
      keypad()
        ? "You hold the keypad: press what is called."
        : `${seatName(m.keypad)} holds the keypad. Tap a pad to call it.`,
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
