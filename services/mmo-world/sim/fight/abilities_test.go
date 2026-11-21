package fight_test

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/tags"
)

// holding is a member whose kit carries an ability's tag, as the game's
// class tags put it there.
func holding(p *harness.Play, c *char.Character, pick string, ts ...tags.Tag) *fight.Member {
	k := p.Fight.KitOf(c)
	k.Self = append(k.Self, ts...)
	return &fight.Member{Ch: c, Kit: k, Pick: pick}
}

// twigged is a character who loses most clashes against an old-growth.
func twigged(p *harness.Play, id string) *char.Character {
	c := char.New(id, hex.Hex{})
	equip(p, c, char.Hand, blade(p, id+"-twig", 1, item.Vec{2, 2, 0, 0, 0, 0, 0, 0}), 1)
	return c
}

// failing presses a clash opening on fresh encounters until the member at
// index who fails it, and returns that encounter and press.
func failing(t *testing.T, p *harness.Play, site fight.Site, ms func() []*fight.Member, who int) (*fight.Encounter, []fight.Pressed, []*fight.Member) {
	t.Helper()
	for i := range 400 {
		s := site
		s.ID = fmt.Sprintf("%s-%d", site.ID, i)
		e := p.Fight.Assemble(s, p.Fight.Spawn("old-growth", nil, nil, nil))
		if e.Beats[0] != "clash" || e.Final() {
			continue
		}
		m := ms()
		out, _, err := p.Fight.Press(e, m, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, o := range out {
			if o.Who == m[who].Ch.ID && !o.Outcome.Success {
				return e, out, m
			}
		}
	}
	t.Fatal("no failure in 400 encounters")
	return nil, nil, nil
}

func failed(out []fight.Pressed, who string) int64 {
	for _, o := range out {
		if o.Who == who && !o.Outcome.Success {
			return 1
		}
	}
	return 0
}

func bleeding(e *fight.Encounter, who string) bool {
	return slices.ContainsFunc(e.States, func(s fight.State) bool { return s.Tag == "bleeding" && s.Who == who })
}

// GDD 5.9, Warden tier 1: "Shield the line: a party member's failed beat
// lands on you instead".
func TestShieldTheLine(t *testing.T) {
	p := play(t)
	run := func(ts ...tags.Tag) (*fight.Encounter, []fight.Pressed) {
		e, out, _ := failing(t, p, fight.Site{ID: "shield", Party: 2}, func() []*fight.Member {
			return []*fight.Member{holding(p, twigged(p, "a"), "strike"), holding(p, twigged(p, "w"), "hold", ts...)}
		}, 0)
		return e, out
	}
	plain, _ := run("warden")
	if plain.Failures.Get("a") != 1 || !bleeding(plain, "a") {
		t.Fatalf("without the ability a's failure is not a's: %v", plain.Failures)
	}
	e, out := run("warden", "shield-the-line")
	if e.Failures.Get("a") != 0 || bleeding(e, "a") {
		t.Fatalf("a's failure stayed on a: %v %v", e.Failures, e.States)
	}
	if e.Failures.Get("w") != failed(out, "w")+1 || !bleeding(e, "w") || e.Shielded.Get("w") != 1 {
		t.Fatalf("the Warden did not take a's failure: %v %v shielded %v", e.Failures, e.States, e.Shielded)
	}
	if solo, _, _ := failing(t, p, fight.Site{ID: "shield-solo", Party: 1}, func() []*fight.Member {
		return []*fight.Member{holding(p, twigged(p, "w"), "strike", "warden", "shield-the-line")}
	}, 0); solo.Failures.Get("w") != 1 || len(solo.Shielded) != 0 {
		t.Fatalf("a lone Warden shielded someone: %v", solo.Shielded)
	}
}

// GDD 5.9, Warden tier 15: "Unmoved: you cannot be the second failure that
// downs a party"; a second failure in a party encounter is a wound.
func TestUnmoved(t *testing.T) {
	p := play(t)
	run := func(party int64, prior int64, ts ...tags.Tag) *fight.Encounter {
		for i := range 400 {
			w := twigged(p, "w")
			e := p.Fight.Assemble(fight.Site{ID: fmt.Sprintf("unmoved-%d-%d", party, i), Party: party}, p.Fight.Spawn("old-growth", nil, nil, nil))
			if e.Beats[0] != "clash" || e.Final() {
				continue
			}
			e.Failures.Bump("w", prior)
			out, _, err := p.Fight.Press(e, []*fight.Member{holding(p, w, "strike", ts...)}, 0)
			if err != nil {
				t.Fatal(err)
			}
			if failed(out, "w") == 1 {
				return e
			}
		}
		t.Fatal("never failed")
		return nil
	}
	wounded := func(e *fight.Encounter) bool { return !slices.Contains(e.Down, "w") }
	if e := run(2, 1, "warden"); wounded(e) {
		t.Fatal("a second failure did not down a Warden without Unmoved")
	}
	e := run(2, 1, "warden", "unmoved")
	if !wounded(e) {
		t.Fatalf("Unmoved went down at the second failure: %v", e.Down)
	}
	if e := run(2, 2, "warden", "unmoved"); wounded(e) {
		t.Fatal("Unmoved stood a third failure")
	}
	if e := run(1, 1, "warden", "unmoved"); wounded(e) {
		t.Fatal("Unmoved held alone, outside a party")
	}
}

// GDD 5.9, Delver tier 10: "Deep breath: a second failure below floor 3
// leaves you wounded, not down".
func TestDeepBreath(t *testing.T) {
	p := play(t)
	run := func(floor int64, ts ...tags.Tag) (*fight.Encounter, *char.Character) {
		for i := range 400 {
			c := twigged(p, "d")
			e := p.Fight.Assemble(fight.Site{ID: fmt.Sprintf("deep-%d-%d", floor, i), Party: 1, Floor: floor, Place: fmt.Sprintf("floor:0,0/%d", floor)}, p.Fight.Spawn("old-growth", nil, nil, nil))
			at := slices.Index(e.Beats, "clash")
			if at < 0 || at == len(e.Beats)-1 {
				continue
			}
			e.At = at
			e.Failures.Bump("d", 1)
			out, _, err := p.Fight.Press(e, []*fight.Member{holding(p, c, "strike", ts...)}, 0)
			if err != nil {
				t.Fatal(err)
			}
			if failed(out, "d") == 1 {
				return e, c
			}
		}
		t.Fatal("never failed")
		return nil, nil
	}
	deep := p.Fight.Param("deep-breath-floor")
	if e, _ := run(deep, "delver"); !slices.Contains(e.Down, "d") {
		t.Fatal("a second failure on a deep floor did not down a Delver without Deep breath")
	}
	e, c := run(deep, "delver", "deep-breath")
	if slices.Contains(e.Down, "d") || !c.Has(char.Wounded, 0) {
		t.Fatalf("Deep breath on floor %d: down %v, wounded %v", deep, e.Down, c.Has(char.Wounded, 0))
	}
	if e, _ := run(deep-1, "delver", "deep-breath"); !slices.Contains(e.Down, "d") {
		t.Fatalf("Deep breath held on floor %d, above the deep floors", deep-1)
	}
}

// GDD 5.9, Warden tier 10: "Rally: once per encounter, the whole party's
// next option is one band better".
func TestRally(t *testing.T) {
	p := play(t)
	a, w := twigged(p, "a"), twigged(p, "w")
	ms := func() []*fight.Member {
		return []*fight.Member{holding(p, a, "strike"), holding(p, w, "hold", "warden", "rally")}
	}
	e, _, _ := failing(t, p, fight.Site{ID: "rally", Party: 2}, ms, 0)
	if e.Over {
		t.Skip("the encounter ended on its first beat")
	}
	if e.Rallied != "w" || e.Rally <= 0 {
		t.Fatalf("no rally after the party's first failure: %d by %q", e.Rally, e.Rallied)
	}
	for _, c := range []*char.Character{a, w} {
		s, k, opts := p.Fight.Choices(e, c, p.Fight.KitOf(c), 0)
		s.Rally = 0
		flat := p.Fight.Options(s, k)
		better := false
		for i, o := range opts {
			if o.Band < flat[i].Band {
				t.Fatalf("%s's %s fell under the rally", c.ID, o.ID)
			}
			if o.Band > flat[i].Band {
				better = better || slices.Contains(o.Why.Notes, "ability-rally")
			}
		}
		if !better {
			t.Fatalf("no option of %s's was rallied", c.ID)
		}
	}
	next := ms()
	for _, m := range next {
		m.Pick = "hold"
	}
	if _, _, err := p.Fight.Press(e, next, 0); err != nil {
		t.Fatal(err)
	}
	if e.Rally != 0 || e.Rallied != "w" {
		t.Fatalf("the rally outlived its press, or came twice: %d by %q", e.Rally, e.Rallied)
	}
}

// GDD 5.9, Warden tier 5: "Stand over: a downed party member cannot lose
// their haul while you stand".
func TestStandOver(t *testing.T) {
	p := play(t)
	run := func(ts ...tags.Tag) *fight.Encounter {
		for i := range 200 {
			w := char.New("w", hex.Hex{})
			equip(p, w, char.Hand, blade(p, "w-blade", 1, item.Vec{60, 30, 0, 0, 0, 0, 0, 0}), 1)
			w.Practice = []char.Skill{{ID: "fight", Level: 20}}
			down := char.New("a", hex.Hex{})
			e := p.Fight.Assemble(fight.Site{ID: fmt.Sprintf("stand-%d", i), Party: 2}, p.Fight.Spawn("reed-rat", nil, nil, nil))
			e.Down = append(e.Down, "a")
			for !e.Over {
				pick := "hold"
				if b := e.Beats[e.At]; b == "clash" || b == "guardian" || b == "standoff" || b == "chase" {
					pick = "strike"
				}
				if _, _, err := p.Fight.Press(e, []*fight.Member{{Ch: down, Kit: p.Fight.KitOf(down), Pick: "hold"}, holding(p, w, pick, ts...)}, 0); err != nil {
					t.Fatal(err)
				}
			}
			if !slices.Contains(e.Down, "w") {
				return e
			}
		}
		t.Fatal("the Warden never stood to the end")
		return nil
	}
	if e := run("warden"); e.Keeps("a") {
		t.Fatal("a downed member kept their haul with no Warden standing over them")
	}
	if e := run("warden", "stand-over"); !e.Keeps("a") || e.Keeps("w") {
		t.Fatalf("Stand over kept %v", e.Kept)
	}
}

// GDD 5.9, Kindler tier 10: "Counter: remove one state tag from a
// creature or ally per encounter".
func TestCounter(t *testing.T) {
	p := play(t)
	run := func(ts ...tags.Tag) *fight.Encounter {
		e, _, _ := failing(t, p, fight.Site{ID: "counter", Party: 2}, func() []*fight.Member {
			return []*fight.Member{holding(p, twigged(p, "a"), "strike"), holding(p, twigged(p, "k"), "hold", ts...)}
		}, 0)
		return e
	}
	if e := run("kindler"); !bleeding(e, "a") {
		t.Fatal("a failed clash left no bleeding without Counter")
	}
	e := run("kindler", "counter")
	if bleeding(e, "a") || e.Countered.Get("k") != 1 {
		t.Fatalf("Counter did not lift a's bleeding: %v countered %v", e.States, e.Countered)
	}
	// One an encounter: once spent, the next state laid on a member lands.
	e.At = 0
	e.States = nil
	e.Over = false
	for i := range 400 {
		e.Press = int64(i + 1)
		out, _, err := p.Fight.Press(e, []*fight.Member{holding(p, twigged(p, "a"), "strike"), holding(p, twigged(p, "k"), "hold", "kindler", "counter")}, 0)
		if err != nil {
			t.Fatal(err)
		}
		if failed(out, "a") == 1 {
			if !bleeding(e, "a") || e.Countered.Get("k") != 1 {
				t.Fatalf("a second state was countered too: %v countered %v", e.States, e.Countered)
			}
			return
		}
		e.At, e.Over = 0, false
	}
	t.Fatal("a never failed again")
}

// caster is a character whose off-hand deck casts burning, and a fighter
// strong enough to land it.
func caster(t *testing.T, p *harness.Play) *char.Character {
	t.Helper()
	ex, err := p.Deriver.Derive(item.Recipe{Process: "compose", Method: "ordered", Inputs: []item.Input{{Kind: "ember-salt", Qty: 1}, {Kind: "reed-ash", Qty: 1}}}, 4)
	if err != nil {
		t.Fatal(err)
	}
	deckKind := p.Deriver.Reg.Freeze(&item.Kind{ID: "deck", KindProps: item.KindProps{Tier: 1, Slot: "focus", Vec: item.Vec{0, 0, 0, 0, 30, 0, 10, 30}, Durability: 50, Tags: []tags.Tag{"focus", "item"}}})
	c := char.New("caster", hex.Hex{})
	equip(p, c, char.Hand, blade(p, "b", 1, item.Vec{30, 10, 0, 0, 0, 0, 0, 0}), 1)
	deck := equip(p, c, char.OffHand, deckKind, 1)
	deck.Exploit = item.NewInstance("ex", ex, "")
	c.Practice = []char.Skill{{ID: "fight", Level: 20}}
	return c
}

// landed casts on the opening beat of fresh encounters until a cast lands.
func landed(t *testing.T, p *harness.Play, site fight.Site, arch string, ts ...tags.Tag) *fight.Encounter {
	t.Helper()
	threat := []tags.Measure{{ID: "threat", Value: 900}}
	for i := range 80 {
		s := site
		s.ID, s.Measures = fmt.Sprintf("%s-%d", site.ID, i), threat
		e := p.Fight.Assemble(s, p.Fight.Spawn(arch, nil, nil, threat))
		if e.Final() || (e.Joined != nil && e.Joined.From == 0) {
			continue
		}
		c := caster(t, p)
		out, _, err := p.Fight.Press(e, []*fight.Member{holding(p, c, "cast", ts...)}, 0)
		if err != nil {
			t.Fatal(err)
		}
		if out[0].Outcome.Success {
			return e
		}
	}
	t.Fatal("no cast landed")
	return nil
}

func holdsState(sts []fight.State, tag tags.Tag) bool {
	return slices.ContainsFunc(sts, func(s fight.State) bool { return s.Tag == tag })
}

// GDD 5.9, Kindler tier 5: "Wide cast: an exploit's state reaches one
// more creature". A joined creature's own beats face its own states.
func TestWideCast(t *testing.T) {
	p := play(t)
	plain := landed(t, p, fight.Site{ID: "wide", Party: 1}, "reed-rat", "kindler")
	if plain.Joined == nil {
		t.Skip("no reed-rat joined")
	}
	if holdsState(plain.Joined.States, "burning") || !holdsState(plain.States, "burning") {
		t.Fatalf("a plain cast reached the joined creature: %v / %v", plain.States, plain.Joined.States)
	}
	plain.At = plain.Joined.From
	if slices.Contains(p.Fight.Situation(plain, "caster").Other, "burning") {
		t.Fatal("the joined creature's beat faced the first creature's burning")
	}
	e := landed(t, p, fight.Site{ID: "wide", Party: 1}, "reed-rat", "kindler", "wide-cast")
	if !holdsState(e.Joined.States, "burning") || !holdsState(e.States, "burning") {
		t.Fatalf("Wide cast did not reach both creatures: %v / %v", e.States, e.Joined.States)
	}
	e.At = e.Joined.From
	if !slices.Contains(p.Fight.Situation(e, "caster").Other, "burning") {
		t.Fatal("the joined creature's beat did not face its own burning")
	}
}

// GDD 5.9, Kindler tier 15: "Chain: a state you add triggers its rule
// twice".
func TestChain(t *testing.T) {
	p := play(t)
	e := landed(t, p, fight.Site{ID: "chain", Party: 1}, "flat-runner", "kindler", "chain")
	i := slices.IndexFunc(e.States, func(s fight.State) bool { return s.Tag == "burning" && s.On == fight.OnCreature })
	if i < 0 || e.States[i].Repeats != 1 {
		t.Fatalf("a chained cast: %v", e.States)
	}
	c := caster(t, p)
	s, k, opts := p.Fight.Choices(e, c, p.Fight.KitOf(c), 0)
	if s.Repeats["burning"] != 1 {
		t.Fatalf("the beat does not see burning chained: %v", s.Repeats)
	}
	s.Repeats = nil
	once := p.Fight.Options(s, k)
	fired := func(o fight.Option) (n int) {
		for _, pt := range o.Why.Parts {
			if pt.Label == "burning-falters" {
				n++
			}
		}
		return n
	}
	for j, o := range opts {
		if fired(once[j]) == 1 && (fired(o) != 2 || o.Score <= once[j].Score) {
			t.Fatalf("%s: burning's rule fired %d times chained (score %d, %d once)", o.ID, fired(o), o.Score, once[j].Score)
		}
	}
	if !slices.ContainsFunc(opts, func(o fight.Option) bool { return fired(o) == 2 }) {
		t.Fatal("no option met burning's rule twice")
	}
	plain := landed(t, p, fight.Site{ID: "chain", Party: 1}, "flat-runner", "kindler")
	if j := slices.IndexFunc(plain.States, func(s fight.State) bool { return s.Tag == "burning" }); j < 0 || plain.States[j].Repeats != 0 {
		t.Fatalf("a cast without Chain repeats: %v", plain.States)
	}
}
