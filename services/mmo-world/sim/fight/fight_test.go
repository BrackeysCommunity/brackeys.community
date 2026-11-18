package fight_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/tags"
)

func play(t *testing.T) *harness.Play {
	t.Helper()
	b, err := harness.LoadBook(harness.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	p, err := harness.NewPlay(b, keys.Throwaway("fight-test"))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// blade freezes a kind with the given vector and tags, as if crafted.
func blade(p *harness.Play, id string, tier int64, vec item.Vec, ts ...tags.Tag) *item.Kind {
	k := &item.Kind{ID: id, KindProps: item.KindProps{Tier: tier, Slot: "blade", Vec: vec, Durability: 90,
		Tags: append([]tags.Tag{"item", "blade"}, ts...)}}
	return p.Deriver.Reg.Freeze(k)
}

func equip(p *harness.Play, c *char.Character, slot string, k *item.Kind, level int64) *item.Instance {
	in := item.NewInstance(c.ID+"-"+slot, k, "")
	in.Level = level
	c.Pack = append(c.Pack, in)
	c.Equip(slot, 0, in.ID)
	return in
}

// GDD 7.8, to the digit: Ossa strikes a tier-2 wire-eel with a
// Copperline blade (Edge 34 pts, tier 2, level 9) and Fight practice 6.
func TestWorkedExample(t *testing.T) {
	p := play(t)
	k := blade(p, "copperline", 2, item.Vec{34, 18, 0, 48, 0, 0, 0, 0}, "metal", "conductive", "keen")
	ossa := char.New("ossa", hex.Hex{})
	equip(p, ossa, char.Hand, k, 9)
	ossa.Practice = []char.Skill{{ID: "fight", Level: 6}}

	if g := p.Growth.Gain(2, 9); g.String() != "0.1575" {
		t.Fatalf("level band: %s, want 0.1575 (about +16%%)", g)
	}
	if s := p.Growth.Stat(34, 2, 9); s != 39 {
		t.Fatalf("Edge at level 9: %d pts, want 39", s)
	}
	// An EM storm is over the region, so the eel is charged.
	place := []tags.Tag{"storm", "marsh"}
	eel := p.Fight.Spawn("mire-stalker", nil, place, nil)
	if !slices.Contains(eel.Tags, "charged") || eel.Tier != 2 {
		t.Fatalf("the eel under a storm: %v tier %d", eel.Tags, eel.Tier)
	}
	s := fight.Situation{Encounter: "e", Kind: "clash", Creature: &eel, Place: place, Party: 1}
	opts := p.Fight.Options(s, p.Fight.KitOf(ossa))
	i := slices.IndexFunc(opts, func(o fight.Option) bool { return o.ID == "strike" })
	if i < 0 {
		t.Fatalf("no strike: %v", opts)
	}
	o := opts[i]
	if o.Stat != 39 || o.Score != 36 || o.Difficulty != 35 || o.Margin != 1 {
		t.Fatalf("stat %d score %d difficulty %d margin %d; want 39, 32 + 4 = 36, 35, +1", o.Stat, o.Score, o.Difficulty, o.Margin)
	}
	if p.Fight.BandName(o.Why.BandFrom) != "even" || p.Fight.BandName(o.Band) != "likely" || o.Chance.String() != "0.75" {
		t.Fatalf("band %s then %s at %s; want even then likely (about 3 in 4)", p.Fight.BandName(o.Why.BandFrom), p.Fight.BandName(o.Band), o.Chance)
	}
	fired := map[string]bool{}
	for _, st := range o.Why.Rules.Steps {
		fired[st.Rule] = true
	}
	if !fired["keen-bites"] || !fired["conductive-bites"] {
		t.Fatalf("why: %v", o.Why.Rules.Steps)
	}
	// Greywater is above 800 threat, so it counts as troubled.
	if xp := p.Growth.FightXP(2, 2, true, true); xp != 38 {
		t.Fatalf("troubled xp %d, want 30 × 1.25 = 38", xp)
	}
}

func TestEveryBeatOffersCautionAndAWayOut(t *testing.T) {
	p := play(t)
	c := char.New("c", hex.Hex{})
	eel := p.Fight.Spawn("mire-stalker", nil, nil, nil)
	for _, beat := range []string{"clash", "standoff", "chase", "hazard", "lock", "parley", "harvest", "guardian", "puzzle"} {
		opts := p.Fight.Options(fight.Situation{Encounter: "e", Kind: beat, Creature: &eel, Party: 1, Puzzle: "rewire", Level: 1}, p.Fight.KitOf(c))
		var careful, out bool
		for _, o := range opts {
			careful = careful || o.Kind == fight.Careful
			out = out || o.Kind == fight.WayOut
		}
		if !careful || !out {
			t.Fatalf("%s: %v", beat, opts)
		}
	}
}

// A hidden creature leaves only the cautious option and the way out,
// unless the item is true.
func TestHiddenIsUnanswered(t *testing.T) {
	p := play(t)
	c := char.New("c", hex.Hex{})
	equip(p, c, char.Hand, blade(p, "plain", 1, item.Vec{30, 10, 0, 0, 0, 0, 0, 0}), 1)
	eel := p.Fight.Spawn("mire-stalker", nil, nil, nil)
	s := fight.Situation{Encounter: "e", Kind: "clash", Creature: &eel, Other: []tags.Tag{"hidden"}, Party: 1}
	for _, o := range p.Fight.Options(s, p.Fight.KitOf(c)) {
		if o.Kind == fight.Win {
			t.Fatalf("answered a hidden creature with %s", o.ID)
		}
	}
	c2 := char.New("c2", hex.Hex{})
	equip(p, c2, char.Hand, blade(p, "true", 1, item.Vec{30, 10, 0, 0, 0, 0, 0, 0}, "true"), 1)
	if !slices.ContainsFunc(p.Fight.Options(s, p.Fight.KitOf(c2)), func(o fight.Option) bool { return o.ID == "strike" }) {
		t.Fatal("a true blade could not answer")
	}
}

func TestPartyDifficulty(t *testing.T) {
	p := play(t)
	eel := p.Fight.Spawn("mire-stalker", nil, nil, nil)
	// 35 at tier 2, +15% a member past the first.
	for party, want := range map[int64]int64{1: 35, 2: 40, 4: 51} {
		if d := p.Fight.Difficulty(fight.Situation{Kind: "clash", Creature: &eel, Party: party}); d != want {
			t.Fatalf("party of %d: difficulty %d, want %d", party, d, want)
		}
	}
}

func TestAssemble(t *testing.T) {
	p := play(t)
	for i := range 200 {
		site := fight.Site{ID: "enc-" + string(rune('a'+i%26)) + string(rune('a'+i/26)), Party: 1}
		if i%2 == 0 {
			site.Floor = 1 + int64(i%7)
			site.Tags = []tags.Tag{"dungeon"}
		}
		arch := p.Fight.Archetypes()[i%len(p.Fight.Archetypes())]
		c := p.Fight.Spawn(arch, nil, nil, nil)
		e := p.Fight.Assemble(site, c)
		again := p.Fight.Assemble(site, c)
		if !slices.Equal(e.Beats, again.Beats) {
			t.Fatal("assembly is not deterministic")
		}
		tier := p.Fight.Tier(c.Tier)
		if int64(len(e.Beats)) < 1 || int64(len(e.Beats)) > tier.BeatsMax+1 {
			t.Fatalf("%s: %d beats", arch, len(e.Beats))
		}
		if site.Floor > 0 && !slices.ContainsFunc(e.Beats, func(b string) bool { return b == "hazard" || b == "lock" || b == "puzzle" }) {
			t.Fatalf("a dungeon floor without a hazard, lock or puzzle: %v", e.Beats)
		}
		for j, b := range e.Beats {
			if (b == "lock" || b == "puzzle") != (e.Machines[j] != "") {
				t.Fatalf("beat %s with machine %q", b, e.Machines[j])
			}
		}
	}
}

// Two failures put a character down; the haul is lost; a wound follows
// a failed clash.
func TestSecondFailureDowns(t *testing.T) {
	p := play(t)
	c := char.New("weak", hex.Hex{})
	equip(p, c, char.Hand, blade(p, "twig", 1, item.Vec{2, 2, 0, 0, 0, 0, 0, 0}), 1)
	crawler := p.Fight.Spawn("old-growth", nil, nil, nil)
	for i := range 50 {
		e := p.Fight.Assemble(fight.Site{ID: "down-" + string(rune('a'+i)), Party: 1}, crawler)
		for !e.Over {
			m := &fight.Member{Ch: c, Kit: p.Fight.KitOf(c), Pick: "strike"}
			if e.Beats[e.At] != "clash" && e.Beats[e.At] != "guardian" {
				m.Pick = "hold"
			}
			if _, _, err := p.Fight.Press(e, []*fight.Member{m}, 0); err != nil {
				t.Fatal(err)
			}
		}
		if e.Result == fight.Lost {
			if len(e.Haul) != 0 || c.Fights.Downs == 0 || !c.Has("down", 0) {
				t.Fatalf("a loss kept its haul or did not down: %+v", e)
			}
			return
		}
	}
	t.Fatal("a twig never lost to a walking factory")
}

func TestHuntSplitsByHealth(t *testing.T) {
	p := play(t)
	h, err := p.Fight.StartHunt("hunt-1", "walking-factory", fight.Site{}, 0)
	if err != nil {
		t.Fatal(err)
	}
	k := blade(p, "big", 4, item.Vec{99, 99, 0, 0, 0, 0, 0, 0})
	var hunters []*char.Character
	for i := range 3 {
		c := char.New("h"+string(rune('a'+i)), hex.Hex{})
		equip(p, c, char.Hand, k, 30+int64(i)*5)
		c.Practice = []char.Skill{{ID: "fight", Level: 20}}
		hunters = append(hunters, c)
	}
	for tick := int64(0); !h.Over && tick < 100; tick++ {
		for _, c := range hunters {
			c.Item(c.ID + "-hand").Repair()
			if _, _, err := p.Fight.HuntBeat(h, &fight.Member{Ch: c, Kit: p.Fight.KitOf(c), Pick: "strike"}, tick); err != nil {
				break
			}
		}
	}
	if !h.Slain {
		t.Fatalf("hunt not slain: %d of %d health left", h.Health, h.Max)
	}
	spoils := p.Fight.Spoils(h)
	var whole, removed int64
	for _, c := range h.Removed {
		removed += c.N
	}
	if removed != h.Max {
		t.Fatalf("removed %d of %d", removed, h.Max)
	}
	for _, ss := range spoils {
		for _, s := range ss {
			whole += s.Qty
		}
	}
	if whole == 0 || len(spoils) == 0 {
		t.Fatal("no spoils")
	}
}

func TestSplitIsExact(t *testing.T) {
	share := item.Tally{{Key: "a", N: 1}, {Key: "b", N: 1}, {Key: "c", N: 1}}
	got := fight.Split([]item.Spoil{{Material: "x", Qty: 10}}, share)
	var n int64
	for _, ss := range got {
		n += ss[0].Qty
	}
	if n != 10 {
		t.Fatalf("split %v", got)
	}
}

// A landed exploit wins an earlier beat and leaves its state; on the
// final beat it lands but the beat must still be won.
func TestCastLandsAndAdvances(t *testing.T) {
	p := play(t)
	ex, err := p.Deriver.Derive(item.Recipe{Process: "compose", Method: "ordered", Inputs: []item.Input{{Kind: "ember-salt", Qty: 1}, {Kind: "reed-ash", Qty: 1}}}, 4)
	if err != nil {
		t.Fatal(err)
	}
	deckKind := p.Deriver.Reg.Freeze(&item.Kind{ID: "deck", KindProps: item.KindProps{Tier: 1, Slot: "focus", Vec: item.Vec{0, 0, 0, 0, 30, 0, 10, 30}, Durability: 50, Tags: []tags.Tag{"focus", "item"}}})
	for i := range 40 {
		c := char.New("caster", hex.Hex{})
		equip(p, c, char.Hand, blade(p, "b", 1, item.Vec{30, 10, 0, 0, 0, 0, 0, 0}), 1)
		deck := equip(p, c, char.OffHand, deckKind, 1)
		deck.Exploit = item.NewInstance("ex", ex, "")
		c.Practice = []char.Skill{{ID: "fight", Level: 20}}
		e := p.Fight.Assemble(fight.Site{ID: "cast-" + string(rune('a'+i)), Party: 1}, p.Fight.Spawn("flat-runner", nil, nil, nil))
		if e.Final() {
			continue
		}
		before := deck.Durability
		out, _, err := p.Fight.Press(e, []*fight.Member{{Ch: c, Kit: p.Fight.KitOf(c), Pick: "cast"}}, 0)
		if err != nil {
			t.Fatal(err)
		}
		if deck.Durability >= before {
			t.Fatal("a cast spent no charge")
		}
		if out[0].Outcome.Success {
			if e.At != 1 || !slices.ContainsFunc(e.States, func(s fight.State) bool { return s.Tag == "burning" && s.On == fight.OnCreature }) {
				t.Fatalf("a landed cast: at %d, states %v", e.At, e.States)
			}
			return
		}
	}
	t.Fatal("no cast landed in 40 tries")
}
