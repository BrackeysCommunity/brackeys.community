import { describe, expect, it } from "vite-plus/test";

import { HERO_SLIDE_MAX, heroJamSlides, pickHeroJam } from "@/components/home/hero-jam";
import type { JamFromList, JamHeroPin } from "@/components/jams/JamCalendarPage/helpers";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-20T00:00:00Z");

/** Only the fields the picker reads. Defaults to a week-long jam that is
 * live right now, which is the case a pin is for. */
function jam(
  jamId: number,
  { title = `Jam ${jamId}`, startsIn = -1, lengthDays = 7 } = {},
): JamFromList {
  const startsAt = new Date(NOW.getTime() + startsIn * DAY_MS);
  return {
    jamId,
    title,
    slug: `jam-${jamId}`,
    hosts: [],
    startsAt,
    endsAt: new Date(startsAt.getTime() + lengthDays * DAY_MS),
    votingEndsAt: null,
  } as unknown as JamFromList;
}

function pin(jamId: number): JamHeroPin {
  return { jamId, pinnedAt: NOW } as JamHeroPin;
}

const brackeysJam = (jamId: number, opts: { startsIn?: number; lengthDays?: number } = {}) =>
  jam(jamId, { title: "Brackeys Game Jam 2026.2", ...opts });

const slideIds = (slides: ReturnType<typeof heroJamSlides>) => slides.map((s) => s.jam.jamId);

describe("pickHeroJam", () => {
  it("leads with the top of the featured tier when nothing is curated", () => {
    const hero = pickHeroJam([jam(1), jam(2)], undefined, [], NOW);
    expect(hero?.jam.jamId).toBe(1);
    expect(hero?.source).toBe("ranked");
  });

  it("gives a Brackeys jam the slot over the ranking", () => {
    const hero = pickHeroJam([jam(1), brackeysJam(2)], undefined, [], NOW);
    expect(hero?.jam.jamId).toBe(2);
    expect(hero?.source).toBe("brackeys");
  });

  it("keeps an upcoming Brackeys jam in front of a pin", () => {
    const all = [jam(1), brackeysJam(2, { startsIn: 20 })];
    const hero = pickHeroJam(all, all, [pin(1)], NOW);
    expect(hero?.jam.jamId).toBe(2);
    expect(hero?.source).toBe("brackeys");
  });

  it("keeps a live Brackeys jam in front of a pin too", () => {
    const all = [jam(1), brackeysJam(2)];
    const hero = pickHeroJam(all, all, [pin(1)], NOW);
    expect(hero?.jam.jamId).toBe(2);
    expect(hero?.source).toBe("brackeys");
  });

  it("hands the front to a pin once the Brackeys jam has ended", () => {
    const all = [jam(1), brackeysJam(2, { startsIn: -30, lengthDays: 7 })];
    const hero = pickHeroJam(all, all, [pin(1)], NOW);
    expect(hero?.jam.jamId).toBe(1);
    expect(hero?.source).toBe("pinned");
  });

  it("prefers a pin over the ranking when no Brackeys jam is running", () => {
    const all = [jam(1), jam(2)];
    const hero = pickHeroJam(all, all, [pin(2)], NOW);
    expect(hero?.jam.jamId).toBe(2);
    expect(hero?.source).toBe("pinned");
  });

  it("promotes a pinned jam the featured tier never surfaced", () => {
    const outsider = jam(9);
    const hero = pickHeroJam([jam(1), jam(2)], [jam(1), jam(2), outsider], [pin(9)], NOW);
    expect(hero?.jam.jamId).toBe(9);
  });

  it("takes the first pin in server order, which is newest first", () => {
    const all = [jam(1), jam(2)];
    const hero = pickHeroJam(all, all, [pin(2), pin(1)], NOW);
    expect(hero?.jam.jamId).toBe(2);
  });

  it("falls through a pin whose jam has ended", () => {
    const ended = jam(2, { startsIn: -30, lengthDays: 7 });
    const all = [jam(1), ended];
    const hero = pickHeroJam(all, all, [pin(2)], NOW);
    expect(hero?.jam.jamId).toBe(1);
    expect(hero?.source).toBe("ranked");
  });

  it("lets the next pin down take over when the one above it ends", () => {
    const ended = jam(3, { startsIn: -30, lengthDays: 7 });
    const all = [jam(1), jam(2), ended];
    const hero = pickHeroJam(all, all, [pin(3), pin(2)], NOW);
    expect(hero?.jam.jamId).toBe(2);
    expect(hero?.source).toBe("pinned");
  });

  it("honours a pin on a jam that has not started yet", () => {
    const all = [jam(1), jam(2, { startsIn: 5 })];
    const hero = pickHeroJam(all, all, [pin(2)], NOW);
    expect(hero?.jam.jamId).toBe(2);
    expect(hero?.source).toBe("pinned");
  });

  it("ignores a pin whose jam is not in the board payload", () => {
    const all = [jam(1)];
    const hero = pickHeroJam(all, all, [pin(404)], NOW);
    expect(hero?.jam.jamId).toBe(1);
  });

  it("collapses the hero when there is nothing live or upcoming", () => {
    expect(pickHeroJam([], [], [pin(1)], NOW)).toBeNull();
  });
});

describe("heroJamSlides", () => {
  it("rotates the Brackeys jam first, then pins newest first", () => {
    const all = [jam(1), jam(2), brackeysJam(3)];
    const slides = heroJamSlides(all, all, [pin(2), pin(1)], NOW);
    expect(slideIds(slides)).toEqual([3, 2, 1]);
    expect(slides.map((s) => s.source)).toEqual(["brackeys", "pinned", "pinned"]);
  });

  it("shows a pinned Brackeys jam once, as the Brackeys slide", () => {
    const all = [jam(1), brackeysJam(2)];
    const slides = heroJamSlides(all, all, [pin(2), pin(1)], NOW);
    expect(slideIds(slides)).toEqual([2, 1]);
    expect(slides[0]?.source).toBe("brackeys");
  });

  it("caps the rotation", () => {
    const all = [brackeysJam(9), jam(1), jam(2), jam(3), jam(4), jam(5)];
    const pins = [pin(1), pin(2), pin(3), pin(4), pin(5)];
    const slides = heroJamSlides(all, all, pins, NOW);
    expect(slides).toHaveLength(HERO_SLIDE_MAX);
    expect(slides[0]?.source).toBe("brackeys");
  });

  it("skips pins whose jams have aged out rather than counting them", () => {
    const ended = jam(2, { startsIn: -30, lengthDays: 7 });
    const all = [jam(1), ended];
    const slides = heroJamSlides(all, all, [pin(2), pin(1)], NOW);
    expect(slideIds(slides)).toEqual([1]);
  });

  it("offers the ranking one slide only when nothing is curated", () => {
    const slides = heroJamSlides([jam(1), jam(2)], undefined, [], NOW);
    expect(slideIds(slides)).toEqual([1]);
    expect(slides[0]?.source).toBe("ranked");
  });

  it("never pads a curated rotation with the ranking", () => {
    const all = [jam(1), jam(2)];
    const slides = heroJamSlides(all, all, [pin(2)], NOW);
    expect(slideIds(slides)).toEqual([2]);
  });

  it("is empty when there is nothing live or upcoming", () => {
    expect(heroJamSlides([], [], [pin(1)], NOW)).toEqual([]);
  });
});
