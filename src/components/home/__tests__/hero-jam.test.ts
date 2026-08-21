import { describe, expect, it } from "vite-plus/test";

import { heroJamDisplacedByPin, pickHeroJam } from "@/components/home/hero-jam";
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

describe("pickHeroJam", () => {
  it("leads with the top of the featured tier when nothing is pinned", () => {
    const hero = pickHeroJam([jam(1), jam(2)], undefined, [], NOW);
    expect(hero?.jam.jamId).toBe(1);
    expect(hero?.source).toBe("ranked");
  });

  it("gives a Brackeys jam the slot over the ranking", () => {
    const hero = pickHeroJam([jam(1), brackeysJam(2)], undefined, [], NOW);
    expect(hero?.jam.jamId).toBe(2);
    expect(hero?.source).toBe("brackeys");
  });

  it("lets a pin take the slot from an upcoming Brackeys jam", () => {
    const all = [jam(1), brackeysJam(2, { startsIn: 20 })];
    const hero = pickHeroJam(all, all, [pin(1)], NOW);
    expect(hero?.jam.jamId).toBe(1);
    expect(hero?.source).toBe("pinned");
  });

  it("lets a pin take the slot from a live Brackeys jam too", () => {
    // No carve-out: the admin panel surfaces this via `heroJamDisplacedByPin`.
    const all = [jam(1), brackeysJam(2)];
    const hero = pickHeroJam(all, all, [pin(1)], NOW);
    expect(hero?.jam.jamId).toBe(1);
    expect(hero?.source).toBe("pinned");
  });

  it("falls back to the Brackeys jam when the pin has aged out", () => {
    const ended = jam(3, { startsIn: -30, lengthDays: 7 });
    const all = [jam(1), brackeysJam(2), ended];
    const hero = pickHeroJam(all, all, [pin(3)], NOW);
    expect(hero?.jam.jamId).toBe(2);
    expect(hero?.source).toBe("brackeys");
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

describe("heroJamDisplacedByPin", () => {
  it("names the Brackeys jam a pin is holding off the hero", () => {
    const all = [jam(1), brackeysJam(2)];
    const hero = pickHeroJam(all, all, [pin(1)], NOW);
    expect(heroJamDisplacedByPin(hero, all, NOW)?.jamId).toBe(2);
  });

  it("says nothing when the Brackeys jam has already ended", () => {
    const all = [jam(1), brackeysJam(2, { startsIn: -30, lengthDays: 7 })];
    const hero = pickHeroJam(all, all, [pin(1)], NOW);
    expect(heroJamDisplacedByPin(hero, all, NOW)).toBeNull();
  });

  it("says nothing when the hero is not a pin at all", () => {
    const all = [jam(1), brackeysJam(2)];
    const hero = pickHeroJam(all, all, [], NOW);
    expect(hero?.source).toBe("brackeys");
    expect(heroJamDisplacedByPin(hero, all, NOW)).toBeNull();
  });

  it("says nothing when the pinned jam *is* the Brackeys jam", () => {
    const all = [jam(1), brackeysJam(2)];
    const hero = pickHeroJam(all, all, [pin(2)], NOW);
    expect(hero?.jam.jamId).toBe(2);
    expect(heroJamDisplacedByPin(hero, all, NOW)).toBeNull();
  });
});
