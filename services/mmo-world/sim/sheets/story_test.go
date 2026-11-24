package sheets_test

import (
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/sheets"
)

// The story sheets hold every shipped template (GDD 12.4 to 12.10, 4.8,
// 4.13).
func TestStorySheets(t *testing.T) {
	b := live(t)
	if len(b.Pacing) != 4 || len(b.SeasonDays) != 4 || len(b.Arcs) != 24 || len(b.Troubles) != 7 ||
		len(b.Occasions) != 3 || len(b.PatternPuzzles) != 9 || len(b.Caches) != 5 || len(b.FactionCities) != 5 {
		t.Fatalf("%d pacing, %d days, %d arcs, %d troubles, %d occasions, %d puzzles, %d caches, %d cities",
			len(b.Pacing), len(b.SeasonDays), len(b.Arcs), len(b.Troubles), len(b.Occasions), len(b.PatternPuzzles), len(b.Caches), len(b.FactionCities))
	}
	scopes := map[string]int{}
	finales := 0
	for _, a := range b.Arcs {
		scopes[a.Scope]++
		if a.Finale {
			finales++
		}
		if a.Note == "" {
			t.Errorf("%s has no note", a.ID)
		}
	}
	if scopes["world"] != 8 || scopes["region"] != 10 || scopes["personal"] != 6 || finales != 3 {
		t.Errorf("scopes %v, %d finales", scopes, finales)
	}
	days := sheets.Lookup(b.SeasonDays)
	if r := days["rising"]; r.From != 8 || r.To != 28 || r.Split != 18 || days["finale"].To != 42 {
		t.Errorf("rising %+v, finale %+v", r, days["finale"])
	}
	for id, want := range map[string]int64{
		"season-days": 42, "season-zero-days": 14, "stage-days-least": 2, "stage-days-most": 5,
		"raid-mark": 7, "standing-for": 20, "standing-against": 60, "shunned-below": -50,
		"memory-kept": 512, "stocked-wall-defence": 20, "chronicle-min-weight": 60,
	} {
		if got := sheets.IntParam(b.StoryParams, id); got != want {
			t.Errorf("story.params %s is %d, want %d", id, got, want)
		}
	}
	for _, c := range []struct {
		rows []sheets.Param
		id   string
		want int64
	}{
		{b.SettlementParams, "city-users", 50}, {b.SettlementParams, "city-coin", 10000}, {b.SettlementParams, "city-keep", 25},
		{b.FactionParams, "faction-city-days", 21}, {b.NPCParams, "visit-range", 3}, {b.NPCParams, "dormant-summary", 5},
	} {
		if got := sheets.IntParam(c.rows, c.id); got != c.want {
			t.Errorf("%s is %d, want %d", c.id, got, c.want)
		}
	}
	facts := map[string]int64{}
	for _, f := range b.FactWeights {
		facts[f.Kind] = f.Weight
	}
	for kind, want := range map[string]int64{"trouble.held": 70, "trouble.lost": 85, "season.closed": 95, "arc.stage-ended": 80, "season.finale": 100} {
		if facts[kind] != want {
			t.Errorf("%s weighs %d, want %d", kind, facts[kind], want)
		}
	}
	hunts := sheets.Lookup(b.Hunts)
	creatures := sheets.Lookup(b.Creatures)
	raid := hunts["raid-band"]
	if raid == nil || creatures[raid.Creature].Tier != 1 || !slices.Contains(creatures[raid.Creature].Tags, "pack") || raid.SpawnChance != 0 {
		t.Errorf("raid band %+v", raid)
	}
	for _, s := range b.Structures {
		if s.ID == "wall" && s.TiersWait != "" {
			t.Errorf("the wall's tiers still wait for %s", s.TiersWait)
		}
	}
	for _, w := range b.GuildWorks {
		if w.ID == "stocked-wall" && w.Waits != "" {
			t.Errorf("stocked-wall waits for %s", w.Waits)
		}
	}
	waits := map[string]string{}
	for _, a := range b.Abilities {
		waits[a.ID] = a.Waits
	}
	for id, want := range map[string]string{"wall-captain": "", "bulwark-wall": "", "steward": "", "storm-reader": "MM13 (the live map)", "bind-the-weather": "MM12 (staged weather)",
		"third-method": "post-launch (methods learnt per process)", "reforge": "post-launch (reworking an instance)"} {
		if waits[id] != want {
			t.Errorf("%s waits for %q, want %q", id, waits[id], want)
		}
	}
	targets := map[string]string{}
	for _, tg := range b.Targets {
		if tg.HoldsFrom == "MM9" {
			targets[tg.ID] = tg.Runs
		}
	}
	if len(targets) != 6 || targets["season-zero"] != "season" || targets["city-takes-season"] != "economy" || targets["director-cost-flat"] != "world" {
		t.Errorf("MM9 targets %v", targets)
	}
}

// Load refuses a story book whose templates do not hang together.
func TestStoryProblems(t *testing.T) {
	arc := func(b *sheets.Book, id string) *sheets.ArcRow {
		i := slices.IndexFunc(b.Arcs, func(a sheets.ArcRow) bool { return a.ID == id })
		if i < 0 {
			t.Fatalf("no arc %s", id)
		}
		return &b.Arcs[i]
	}
	// live loads a fresh book, so each case edits its own.
	for _, c := range []struct {
		name, want string
		edit       func(*sheets.Book)
	}{
		{"an effect names a role the cast lacks", "the-succession the-claim lapse[0]: role claimant-c is not in the cast", func(b *sheets.Book) {
			arc(b, "the-succession").Stages[2].Lapse[0].Role = "claimant-c"
		}},
		{"a side's sponsor is not cast", "the-siege the-approach garrison: role attacker is not in the cast", func(b *sheets.Book) {
			arc(b, "the-siege").Stages[0].Sides[0].Opponent = "attacker"
		}},
		{"a cast role is dropped", "the-defector the-wavering shelter-them: role rival is not in the cast", func(b *sheets.Book) {
			a := arc(b, "the-defector")
			a.Cast = slices.DeleteFunc(a.Cast, func(r sheets.CastRow) bool { return r.Role == "rival" })
		}},
		{"a world arc of two stages", "the-siege: a world arc has 3 stages, not 2", func(b *sheets.Book) {
			a := arc(b, "the-siege")
			a.Stages = a.Stages[:2]
		}},
		{"a world stage with days", "the-long-cold the-deep-cold: a world stage ends on its band", func(b *sheets.Book) {
			arc(b, "the-long-cold").Stages[1].Days = 4
		}},
		{"a finale of two stages", "the-last-stand: a finale is a world arc of one stage", func(b *sheets.Book) {
			a := arc(b, "the-last-stand")
			a.Stages = append(a.Stages, a.Stages[0])
		}},
		{"a region stage of one day", "the-overrun the-overrun: 1 days is outside stage-days-least..stage-days-most", func(b *sheets.Book) {
			arc(b, "the-overrun").Stages[0].Days = 1
		}},
		{"a personal stage of six days", "the-return the-return: 6 days is outside stage-days-least..stage-days-most", func(b *sheets.Book) {
			arc(b, "the-return").Stages[0].Days = 6
		}},
		{"a side wants an unknown tag", `the-walls garrison: tag "marble" is not a goods tag`, func(b *sheets.Book) {
			arc(b, "the-siege").Stages[1].Sides[0].Tag = "marble"
		}},
		{"a trouble wants an unknown tag", `story.troubles fire: tag "kindling" is not a goods tag`, func(b *sheets.Book) {
			b.Troubles[slices.IndexFunc(b.Troubles, func(r sheets.TroubleRow) bool { return r.ID == "fire" })].Tag = "kindling"
		}},
		{"a lapse names an unknown trouble", "trouble flood is not a story.troubles id", func(b *sheets.Book) {
			arc(b, "the-dry-seam").Stages[0].Lapse[0].Ref = "flood"
		}},
		{"a win opens an unknown cache", "cache attic-cache is not a story.caches id", func(b *sheets.Book) {
			arc(b, "the-opening").Stages[0].Sides[1].Won[0].Ref = "attic-cache"
		}},
		{"a stage with one side", "the-grudge the-grudge: a stage has at least two sides", func(b *sheets.Book) {
			s := &arc(b, "the-grudge").Stages[0]
			s.Sides = s.Sides[:1]
		}},
		{"a pattern opens an unknown arc", `story.pattern-puzzles second-triangle: opens arc "the-closing" does not resolve`, func(b *sheets.Book) {
			p := &b.PatternPuzzles[slices.IndexFunc(b.PatternPuzzles, func(r sheets.PatternPuzzle) bool { return r.ID == "second-triangle" })]
			p.Opens[1].Ref = "the-closing"
		}},
		{"a placed pattern without a shape", "second-triangle: a puzzle names a scaffold pattern, or lays one", func(b *sheets.Book) {
			b.PatternPuzzles[slices.IndexFunc(b.PatternPuzzles, func(r sheets.PatternPuzzle) bool { return r.ID == "second-triangle" })].Shape = ""
		}},
		{"a day table with a gap", "story.days last: bands run on from day 1 without a gap", func(b *sheets.Book) {
			b.SeasonDays[2].From++
		}},
		{"a day table short of the season", "story.days: the last band ends on story.params season-days", func(b *sheets.Book) {
			b.SeasonDays[3].To--
		}},
		{"no pacing for a scope", "story.pacing: no row for personal", func(b *sheets.Book) {
			b.Pacing = slices.DeleteFunc(b.Pacing, func(r sheets.Pacing) bool { return r.ID == "personal" })
		}},
		{"an archetype without a city", "story.faction-cities: archetype order needs exactly one row", func(b *sheets.Book) {
			b.FactionCities = slices.DeleteFunc(b.FactionCities, func(r sheets.FactionCityRow) bool { return r.ID == "order" })
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			b := live(t)
			c.edit(b)
			err := b.Validate()
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Errorf("want %q, got %v", c.want, err)
			}
		})
	}
	if err := live(t).Validate(); err != nil {
		t.Fatalf("the shipped book: %v", err)
	}
}
