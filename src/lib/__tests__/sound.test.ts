// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { play } = vi.hoisted(() => ({ play: vi.fn() }));

vi.mock("cuelume", () => ({
  play,
  bind: vi.fn(),
  setEnabled: vi.fn(),
  setVolume: vi.fn(),
  sounds: ["tick", "whisper", "droplet", "press", "release", "toggle", "success"],
}));

const { bindHover, bindPullAway, playDismiss, playReveal, playToast } = await import("../sound");

/** Virtual clock, so the 150 ms throttle is steppable. */
let now = 0;

function fire(
  type: string,
  target: Element,
  relatedTarget: Element | null,
  pointerType = "mouse",
  bubbles = true,
  clientX = 0,
) {
  const event = new MouseEvent(type, { bubbles, relatedTarget, clientX });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

const press = (target: Element, pointerType = "mouse") =>
  fire("pointerdown", target, null, pointerType);
const out = (target: Element, to: Element | null, pointerType = "mouse") =>
  fire("pointerout", target, to, pointerType);
const release = (target: Element) => fire("pointerup", target, null);

/** Somewhere the pointer has not been yet, so an enter there reads as travel. */
let cursorX = 0;
const somewhereNew = () => (cursorX += 10);
const move = (x: number) => fire("pointermove", document.body, null, "mouse", true, x);
const scroll = () => document.body.dispatchEvent(new Event("scroll", { bubbles: false }));
/**
 * Non-bubbling, like the real thing: only the capture-phase listener sees it.
 * `x` is where the pointer is — repeat the previous one to model the enter a
 * browser fires when the DOM changes under a pointer that never moved.
 */
const enter = (
  target: Element,
  from: Element | null = null,
  x = somewhereNew(),
  pointerType = "mouse",
) => fire("pointerenter", target, from, pointerType, false, x);

const el = (id: string) => document.getElementById(id)!;

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  bindHover();
  bindPullAway();
});

describe("bindPullAway", () => {
  beforeEach(() => {
    play.mockClear();
    // Past the throttle window, so each test starts able to sound.
    now += 1000;
    document.body.innerHTML = `
      <button id="btn" data-sound-pull-away><span id="icon"></span><span id="label"></span></button>
      <button id="loud" data-sound-pull-away="droplet"></button>
      <button id="bogus" data-sound-pull-away="not-a-sound"></button>
      <div id="outside"></div>
    `;
  });

  it("plays quietly when a held press is dragged off the element", () => {
    press(el("btn"));
    out(el("icon"), el("outside"));

    expect(play).toHaveBeenCalledTimes(1);
    const [sound, options] = play.mock.calls[0] as [string, { volume: number }];
    expect(sound).toBe("whisper");
    expect(options.volume).toBeLessThan(1);
  });

  it("stays silent on a plain hover-out with no press held", () => {
    out(el("icon"), el("outside"));

    expect(play).not.toHaveBeenCalled();
  });

  it("stays silent once the press has been released", () => {
    press(el("btn"));
    release(el("btn"));
    out(el("icon"), el("outside"));

    expect(play).not.toHaveBeenCalled();
  });

  it("stays silent when the press started somewhere else", () => {
    press(el("outside"));
    out(el("btn"), el("outside"));

    expect(play).not.toHaveBeenCalled();
  });

  it("stays silent while a held pointer moves between children of the element", () => {
    press(el("btn"));
    out(el("icon"), el("label"));

    expect(play).not.toHaveBeenCalled();
  });

  it("ignores coarse pointers", () => {
    press(el("btn"), "touch");
    out(el("icon"), el("outside"), "touch");

    expect(play).not.toHaveBeenCalled();
  });

  it("honours a per-element cue override and falls back for an unknown name", () => {
    press(el("loud"));
    out(el("loud"), el("outside"));
    now += 200;
    press(el("bogus"));
    out(el("bogus"), el("outside"));

    expect(play.mock.calls.map((call) => call[0])).toEqual(["droplet", "whisper"]);
  });

  it("throttles to one cue per 150 ms", () => {
    press(el("btn"));
    out(el("btn"), el("outside"));
    now += 100;
    press(el("loud"));
    out(el("loud"), el("outside"));
    now += 100;
    press(el("bogus"));
    out(el("bogus"), el("outside"));

    expect(play).toHaveBeenCalledTimes(2);
  });
});

describe("bindHover", () => {
  beforeEach(() => {
    play.mockClear();
    now += 1000;
    document.body.innerHTML = `
      <button id="a" data-sound-hover><span id="icon"></span><span id="label"></span></button>
      <button id="b" data-sound-hover></button>
      <button id="c" data-sound-hover></button>
      <button id="loud" data-sound-hover="droplet"></button>
      <button id="bogus" data-sound-hover="not-a-sound"></button>
      <div id="outside"></div>
    `;
  });

  // The regression: cuelume's own hover cue shares one timestamp across every
  // element, so a fast sweep ticked once and swallowed the rest.
  it("ticks on every element a fast sweep crosses", () => {
    enter(el("a"), el("outside"));
    now += 20;
    enter(el("b"), el("a"));
    now += 20;
    enter(el("c"), el("b"));

    expect(play.mock.calls.map((call) => call[0])).toEqual(["tick", "tick", "tick"]);
  });

  it("throttles re-entering the same element to one cue per 150 ms", () => {
    enter(el("a"), el("outside"));
    now += 100;
    enter(el("a"), el("outside"));
    now += 100;
    enter(el("a"), el("outside"));

    expect(play).toHaveBeenCalledTimes(2);
  });

  it("stays silent while the pointer crosses between children of the element", () => {
    enter(el("icon"), el("label"));

    expect(play).not.toHaveBeenCalled();
  });

  it("ignores coarse pointers", () => {
    enter(el("a"), el("outside"), somewhereNew(), "touch");

    expect(play).not.toHaveBeenCalled();
  });

  it("honours a per-element cue override and falls back for an unknown name", () => {
    enter(el("loud"), el("outside"));
    enter(el("bogus"), el("outside"));

    expect(play.mock.calls.map((call) => call[0])).toEqual(["droplet", "tick"]);
  });

  // The other way an element lands under a still pointer, and the one that
  // should sound: the user drove the page past the cursor.
  it("ticks when a scroll brings a control under a still pointer", () => {
    const x = somewhereNew();
    enter(el("a"), el("outside"), x);
    move(x);
    play.mockClear();
    now += 1000;

    scroll();
    enter(el("b"), null, x);

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("stops ticking once the scroll has settled", () => {
    const x = somewhereNew();
    move(x);
    scroll();
    now += 500;
    enter(el("b"), null, x);

    expect(play).not.toHaveBeenCalled();
  });

  // Clicking a nav link re-renders it, and the browser fires a real enter on
  // whatever lands under the pointer. The page arrived; the user didn't move.
  it("stays silent when the element under a still pointer is replaced", () => {
    const x = somewhereNew();
    enter(el("a"), el("outside"), x);
    play.mockClear();
    now += 1000;

    document.body.innerHTML = `<button id="a" data-sound-hover>after the route change</button>`;
    enter(el("a"), null, x);

    expect(play).not.toHaveBeenCalled();
  });

  // The ordering the position check leans on: a browser fires the boundary
  // events for a tick *before* that tick's pointermove, so a real re-entry
  // always arrives while the recorded position is still the previous one.
  it("sounds again once the pointer has moved off and back", () => {
    const x = somewhereNew();
    enter(el("a"), el("outside"), x);
    move(x);
    play.mockClear();
    now += 1000;

    move(x + 40);
    enter(el("a"), el("outside"), x);
    move(x);

    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe("playDismiss", () => {
  beforeEach(() => play.mockClear());

  it("sounds for a dismissal the user performed", () => {
    for (const reason of ["close-press", "outside-press", "escape-key", "trigger-press", "swipe"]) {
      playDismiss(reason);
    }

    expect(play).toHaveBeenCalledTimes(5);
    expect(play.mock.calls.every((call) => call[0] === "droplet")).toBe(true);
  });

  // The stutter this exists to prevent: a dialog closing on its own after a
  // save would land droplet on top of the success toast's cue.
  it("stays silent for a close the app performed", () => {
    playDismiss("none");
    playDismiss("imperative-action");
    playDismiss("focus-out");

    expect(play).not.toHaveBeenCalled();
  });

  it("sounds unconditionally when the library reports no reason", () => {
    playDismiss();

    expect(play).toHaveBeenCalledWith("droplet", expect.anything());
  });
});

describe("playReveal and playToast", () => {
  beforeEach(() => play.mockClear());

  it("blooms open and drops closed", () => {
    playReveal(true);
    playReveal(false);

    expect(play.mock.calls.map((call) => call[0])).toEqual(["bloom", "droplet"]);
  });

  it("blooms a toast in, whatever the outcome was", () => {
    playToast();

    expect(play).toHaveBeenCalledWith("bloom", expect.anything());
  });
});
