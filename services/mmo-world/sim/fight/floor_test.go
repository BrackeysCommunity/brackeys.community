package fight_test

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/tally"
)

func part(o fight.Option, label string) (int64, bool) {
	for _, p := range o.Why.Parts {
		if p.Label == label {
			return p.Value, true
		}
	}
	return 0, false
}

// Half way to the next tier is the midpoint, rounded down; past the
// ceiling each tier adds beyond-ceiling-difficulty; each shows as its own
// why line beside the party's.
func TestDeeperDifficulty(t *testing.T) {
	p := play(t)
	eel := p.Fight.Spawn("mire-stalker", nil, nil, nil)
	warden := p.Fight.Spawn("old-growth", nil, nil, nil)
	step := p.Fight.Param("beyond-ceiling-difficulty")
	for _, x := range []struct {
		name string
		s    fight.Situation
		want int64
	}{
		{"tier 2 half", fight.Situation{Kind: "clash", Creature: &eel, Party: 1, Half: true}, 35 + (55-35)/2},
		{"tier 4 half", fight.Situation{Kind: "clash", Creature: &warden, Party: 1, Half: true}, 80 + step/2},
		{"one past", fight.Situation{Kind: "clash", Creature: &warden, Party: 1, Beyond: 1}, 80 + step},
		{"two past, half", fight.Situation{Kind: "clash", Creature: &warden, Party: 1, Beyond: 2, Half: true}, 80 + 2*step + step/2},
		{"tier 2 half, pair", fight.Situation{Kind: "clash", Creature: &eel, Party: 2, Half: true}, 52},
	} {
		if d := p.Fight.Difficulty(x.s); d != x.want {
			t.Fatalf("%s: difficulty %d, want %d", x.name, d, x.want)
		}
	}
	c := char.New("c", hex.Hex{})
	equip(p, c, char.Hand, blade(p, "plain", 1, item.Vec{30, 10, 0, 0, 0, 0, 0, 0}), 1)
	s := fight.Situation{Encounter: "e", Kind: "clash", Creature: &warden, Party: 3, Half: true, Beyond: 1}
	o, ok := fight.OptionByID(p.Fight.Options(s, p.Fight.KitOf(c)), "strike")
	if !ok {
		t.Fatal("no strike")
	}
	half, h := part(o, fight.WhyHalf)
	past, b := part(o, fight.WhyBeyond)
	party, pt := part(o, fight.WhyParty)
	if !h || !b || !pt || half != step/2 || past != step || party != o.Difficulty-(80+step+step/2) {
		t.Fatalf("why %+v, difficulty %d", o.Why.Parts, o.Difficulty)
	}
	solo := fight.Situation{Encounter: "e", Kind: "clash", Creature: &eel, Party: 1}
	o, _ = fight.OptionByID(p.Fight.Options(solo, p.Fight.KitOf(c)), "strike")
	for _, l := range []string{fight.WhyHalf, fight.WhyBeyond, fight.WhyParty} {
		if _, ok := part(o, l); ok {
			t.Fatalf("a solo fight on the surface shows %s", l)
		}
	}
}

// A floor's site sets its beat count, asks for a machine where a hazard
// will not do, carries its place among the tiers, hides the party for
// the third way's beats, and puts the guardian last.
func TestFloorSite(t *testing.T) {
	p := play(t)
	pool := &fight.Pool{Health: 400, Max: 400}
	for i := range 120 {
		arch := p.Fight.Archetypes()[i%len(p.Fight.Archetypes())]
		site := fight.Site{ID: fmt.Sprint("floor-", i), Place: "floor:3,-2/4", Party: 1, Floor: 4, Tags: []tags.Tag{"dungeon"},
			Beats: 3 + int64(i%4), MixLock: true, Half: i%2 == 0, Beyond: int64(i % 3), Hidden: 1}
		if i%3 == 0 {
			site.Guardian = pool
		}
		e := p.Fight.Assemble(site, p.Fight.Spawn(arch, nil, nil, nil))
		if int64(len(e.Beats)) < site.Beats || e.Half != site.Half || e.Beyond != site.Beyond {
			t.Fatalf("%s: %d beats of %d, %+v", site.ID, len(e.Beats), site.Beats, e)
		}
		if !slices.ContainsFunc(e.Beats, func(b string) bool { return b == "lock" || b == "puzzle" }) {
			t.Fatalf("%s: a floor with no machine: %v", site.ID, e.Beats)
		}
		if (site.Guardian != nil && e.Beats[len(e.Beats)-1] != fight.BeatGuardian) || (site.Guardian != nil) != (e.Pool != nil) {
			t.Fatalf("%s: guardian %v, beats %v", site.ID, site.Guardian != nil, e.Beats)
		}
		if (e.Dungeon == "3,-2") != (site.Half || site.Beyond > 0) {
			t.Fatalf("%s: entrance %q", site.ID, e.Dungeon)
		}
		if !slices.Contains(e.SelfStates("x"), fight.StateHidden) {
			t.Fatalf("%s: not hidden on the first beat", site.ID)
		}
		e.At = 1
		if slices.Contains(e.SelfStates("x"), fight.StateHidden) {
			t.Fatalf("%s: still hidden on the second beat", site.ID)
		}
	}
	// A floor's machines take their level from the tier, not the depth.
	shallow := p.Fight.Assemble(fight.Site{ID: "deep-level", Place: "floor:0,0/1", Floor: 1, MixLock: true, Beats: 4, Tags: []tags.Tag{"dungeon"}},
		p.Fight.Spawn("seam-crawler", nil, nil, nil))
	deep := p.Fight.Assemble(fight.Site{ID: "deep-level", Place: "floor:0,0/1", Floor: 7, MixLock: true, Beats: 4, Tags: []tags.Tag{"dungeon"}},
		p.Fight.Spawn("seam-crawler", nil, nil, nil))
	if !slices.Equal(shallow.Levels, deep.Levels) {
		t.Fatalf("levels %v on floor 1, %v on floor 7", shallow.Levels, deep.Levels)
	}
}

// The guardian beat presses the dungeon's pool: the pool falls by what
// is removed, a solve's bonus removes more, and the marks it passes are
// counted.
func TestGuardianPool(t *testing.T) {
	p := play(t)
	row := "bunker-guardian"
	full, ok := p.Fight.GuardianPool(row, 3)
	if !ok || full.Health <= 0 || full.Max != full.Health {
		t.Fatalf("pool %+v", full)
	}
	k := blade(p, "big-guard", 4, item.Vec{99, 99, 0, 0, 0, 0, 0, 0})
	c := char.New("g", hex.Hex{})
	equip(p, c, char.Hand, k, 40)
	c.Practice = []char.Skill{{ID: "fight", Level: 20}}
	pool := full
	e := p.Fight.Assemble(fight.Site{ID: "bottom", Place: "floor:0,0/5", Floor: 5, Beats: 3, MixLock: true, Guardian: &pool,
		Tags: []tags.Tag{"dungeon"}}, p.Fight.Spawn("barrow-warden", nil, nil, nil))
	e.At = len(e.Beats) - 1
	press := func() int64 {
		before := pool.Health
		c.Item(c.ID + "-hand").Repair()
		e.Pool = &pool
		out, _, err := p.Fight.Press(e, []*fight.Member{{Ch: c, Kit: p.Fight.KitOf(c), Pick: "strike"}}, 0)
		if err != nil {
			t.Fatal(err)
		}
		if out[0].Outcome.Success && e.Guardian != pool.Health {
			t.Fatalf("the beat's guardian %d is not the pool's %d", e.Guardian, pool.Health)
		}
		if !out[0].Outcome.Success {
			return 0
		}
		return before - pool.Health
	}
	var plain int64
	for plain == 0 {
		plain = press()
	}
	e.Boost(p.Fight.Param("guardian-solve-bonus"), 0)
	var boosted int64
	for boosted == 0 {
		boosted = press()
	}
	if boosted <= plain || pool.Health >= full.Health || e.Over {
		t.Fatalf("plain %d, boosted %d, pool %d of %d", plain, boosted, pool.Health, full.Max)
	}
	if n := p.Fight.Marks(row, fight.Pool{Health: full.Max / 2, Max: full.Max}); n != 2 {
		t.Fatalf("half a pool passes %d marks", n)
	}
	if n := p.Fight.Marks(row, full); n != 0 {
		t.Fatalf("a whole pool passes %d marks", n)
	}
	e.Boost(50, 2)
	e2 := *e
	e2.At = 0
	for range 2 {
		c.Item(c.ID + "-hand").Repair()
		if _, _, err := p.Fight.Press(&e2, []*fight.Member{{Ch: c, Kit: p.Fight.KitOf(c), Pick: "hold"}}, 0); err != nil {
			t.Fatal(err)
		}
	}
	if e2.Bonus != 0 || e2.BonusLeft != 0 {
		t.Fatalf("a two-press bonus still holds: %d for %d", e2.Bonus, e2.BonusLeft)
	}
}

// A floor past the ceiling hauls more on every line; a half step's lines
// may come up a tier.
func TestDeepHaul(t *testing.T) {
	p := play(t)
	got := fight.GrowHaul([]item.Spoil{{Material: "a", Qty: 8}, {Material: "b", Qty: 3}}, 25)
	if got[0].Qty != 10 || got[1].Qty != 3 {
		t.Fatalf("grown %v", got)
	}
	k := blade(p, "big-haul", 4, item.Vec{99, 99, 0, 0, 0, 0, 0, 0})
	took := map[string]bool{}
	for i := range 40 {
		c := char.New("h", hex.Hex{})
		equip(p, c, char.Hand, k, 40)
		c.Practice = []char.Skill{{ID: "fight", Level: 20}}
		e := p.Fight.Assemble(fight.Site{ID: fmt.Sprint("haul-", i), Place: "floor:1,1/2", Floor: 2, Half: true, Beats: 3,
			Tags: []tags.Tag{"dungeon"}}, p.Fight.Spawn("reed-rat", nil, nil, nil))
		for n := 0; !e.Over && n < 30; n++ {
			pick := "strike"
			if e.Beats[e.At] != "clash" && e.Beats[e.At] != "chase" {
				pick = "hold"
			}
			c.Item(c.ID + "-hand").Repair()
			if _, _, err := p.Fight.Press(e, []*fight.Member{{Ch: c, Kit: p.Fight.KitOf(c), Pick: pick}}, 0); err != nil {
				break
			}
		}
		for _, s := range e.Haul {
			took[s.Material] = true
		}
	}
	if !took["cinder-ore"] && !took["saltglass"] {
		t.Fatalf("a half step never took tier 2's material: %v", took)
	}
}

// Split sums every line exactly, and a tie for the last unit is drawn,
// the same each time for the same stream.
func TestSplitTies(t *testing.T) {
	share := tally.Tally{{Key: "a", N: 2}, {Key: "b", N: 2}, {Key: "c", N: 2}, {Key: "d", N: 1}}
	haul := []item.Spoil{{Material: "x", Qty: 10}, {Material: "y", Qty: 1}, {Material: "z", Qty: 997}}
	d := draw.NewDrawer(keys.Throwaway("split").Roll)
	winners := map[string]bool{}
	for k := range 40 {
		tie := func() *draw.Stream { return d.Stream("haul.split", draw.Int(int64(k))) }
		got, again := fight.Split(haul, share, tie()), fight.Split(haul, share, tie())
		for _, line := range haul {
			var n int64
			for _, who := range []string{"a", "b", "c", "d"} {
				for _, s := range got[who] {
					if s.Material == line.Material {
						n += s.Qty
					}
				}
			}
			if n != line.Qty {
				t.Fatalf("%s: parts sum to %d of %d", line.Material, n, line.Qty)
			}
		}
		if fmt.Sprint(got) != fmt.Sprint(again) {
			t.Fatal("a tie drew differently from the same stream")
		}
		for who, ss := range got {
			for _, s := range ss {
				if s.Material == "y" {
					winners[who] = true
				}
			}
		}
	}
	if len(winners) < 2 || winners["d"] {
		t.Fatalf("one unit three ways went to %v", winners)
	}
}

// A party machine's one result is every present member's pick; only the
// members who moved on it gain a share.
func TestPressMachine(t *testing.T) {
	p := play(t)
	var e *fight.Encounter
	for i := range 200 {
		x := p.Fight.Assemble(fight.Site{ID: fmt.Sprint("machine-", i), Place: "floor:0,0/1", Floor: 1, MixLock: true, Party: 3,
			Tags: []tags.Tag{"dungeon"}}, p.Fight.Spawn("seam-crawler", nil, nil, nil))
		if at := slices.IndexFunc(x.Beats, func(b string) bool { return b == "lock" || b == "puzzle" }); at >= 0 && at < len(x.Beats)-1 {
			x.At, e = at, x
			break
		}
	}
	if e == nil {
		t.Fatal("no machine before the last beat")
	}
	var ms []*fight.Member
	for _, id := range []string{"a", "b", "c"} {
		c := char.New(id, hex.Hex{})
		equip(p, c, char.Hand, blade(p, id+"-blade", 1, item.Vec{30, 10, 0, 0, 0, 0, 0, 0}), 1)
		ms = append(ms, &fight.Member{Ch: c, Kit: p.Fight.KitOf(c), Pick: "hold"})
	}
	e.Down = append(e.Down, "c")
	at := e.At
	out, _, err := p.Fight.PressMachine(e, ms, puzzle.Result{Solved: true, Clean: true}, []string{"a"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 || !out[0].Option.Puzzle || !out[1].Option.Puzzle || !out[0].Outcome.Success || !out[1].Outcome.Success {
		t.Fatalf("pressed %+v", out)
	}
	if e.Share.Get("a") == 0 || e.Share.Get("b") != 0 || e.Share.Get("c") != 0 || e.At != at+1 {
		t.Fatalf("shares %v, at %d", e.Share, e.At)
	}
	if _, _, err := p.Fight.PressMachine(e, ms, puzzle.Result{Solved: true}, nil, 0); err == nil && !slices.Contains([]string{"lock", "puzzle"}, e.Beats[at+1]) {
		t.Fatal("a machine press on a beat with no machine")
	}
	if p.Fight.Cautious() != "hold" {
		t.Fatalf("cautious %q", p.Fight.Cautious())
	}
}

// A pack that gathers is a second creature for the beats it joins.
func TestJoined(t *testing.T) {
	p := play(t)
	threat := []tags.Measure{{ID: "threat", Value: 900}}
	rat := p.Fight.Spawn("reed-rat", nil, nil, threat)
	e := p.Fight.Assemble(fight.Site{ID: "pack", Party: 1, Measures: threat}, rat)
	if e.Joined == nil || e.Joined.Creature.Archetype != "reed-rat" || e.Beats[e.Joined.Until] != "clash" {
		t.Fatalf("joined %+v, beats %v", e.Joined, e.Beats)
	}
	if e.Joined.Until > 0 {
		e.At = e.Joined.Until - 1
	}
	if p.Fight.Situation(e, "x").Joined == nil {
		t.Fatal("the joined creature is not in its own beats")
	}
	e.At = e.Joined.Until + 1
	if e.At < len(e.Beats) && p.Fight.Situation(e, "x").Joined != nil {
		t.Fatal("the joined creature stays past its beats")
	}
	calm := p.Fight.Assemble(fight.Site{ID: "pack"}, p.Fight.Spawn("reed-rat", nil, nil, nil))
	if calm.Joined != nil {
		t.Fatal("a calm rat brought a friend")
	}
}
