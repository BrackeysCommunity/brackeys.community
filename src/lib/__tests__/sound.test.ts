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

const { bindPullAway, playDismiss, playReveal, playToast } = await import("../sound");

/** Virtual clock, so the 150 ms throttle is steppable. */
let now = 0;

function fire(type: string, target: Element, relatedTarget: Element | null, pointerType = "mouse") {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

const press = (target: Element, pointerType = "mouse") =>
  fire("pointerdown", target, null, pointerType);
const out = (target: Element, to: Element | null, pointerType = "mouse") =>
  fire("pointerout", target, to, pointerType);
const release = (target: Element) => fire("pointerup", target, null);

describe("bindPullAway", () => {
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
    bindPullAway();
  });

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

  const el = (id: string) => document.getElementById(id)!;

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
