package fight_test

import (
	"reflect"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/tags"
)

// GDD 13.3: a marsh adapted against keen takes a band off every option
// that carries keen, as a worse margin would, and leaves the rest alone.
func TestResistMovesOnlyItsTag(t *testing.T) {
	p := play(t)
	k := blade(p, "copperline", 2, item.Vec{34, 18, 0, 48, 0, 0, 0, 0}, "metal", "conductive", "keen")
	ossa := char.New("ossa", hex.Hex{})
	equip(p, ossa, char.Hand, k, 9)
	ossa.Practice = []char.Skill{{ID: "fight", Level: 6}}
	place := []tags.Tag{"storm", "marsh"}
	eel := p.Fight.Spawn("mire-stalker", nil, place, nil)
	kit := p.Fight.KitOf(ossa)
	options := func(rs []fight.Resist) []fight.Option {
		return p.Fight.Options(fight.Situation{Encounter: "e", Kind: "clash", Creature: &eel, Place: place, Party: 1, Resist: rs}, kit)
	}
	base := options(nil)
	for _, rs := range [][]fight.Resist{{}, {{Tag: "plated", Bands: 2}}, {{Tag: "keen", Bands: 0}}} {
		if got := options(rs); !reflect.DeepEqual(got, base) {
			t.Fatalf("resist %v moved an option", rs)
		}
	}
	floor, ceiling := p.Fight.Param("band-floor"), p.Fight.Param("band-ceiling")
	for _, bands := range []int64{1, 2} {
		got := options([]fight.Resist{{Tag: "keen", Bands: bands}})
		if len(got) != len(base) {
			t.Fatalf("resist changed the options offered: %d, want %d", len(got), len(base))
		}
		moved := 0
		for i, o := range got {
			was := base[i]
			if !slices.Contains(was.Tags, "keen") || was.Kind == fight.WayOut {
				if !reflect.DeepEqual(o, was) {
					t.Fatalf("%s carries no keen and moved", o.ID)
				}
				continue
			}
			moved++
			want := min(ceiling, max(floor, was.Band-bands))
			if o.Band != want || o.Why.BandTo != want || o.Why.BandFrom != was.Why.BandFrom || o.Margin != was.Margin {
				t.Fatalf("%s band %d (from %d), want %d from %d", o.ID, o.Band, o.Why.BandFrom, want, was.Why.BandFrom)
			}
			if !slices.Equal(o.Why.Parts, append(slices.Clone(was.Why.Parts), fight.Part{Label: fight.WhyAdapted, Value: -bands})) {
				t.Fatalf("%s why %v", o.ID, o.Why.Parts)
			}
		}
		if moved == 0 {
			t.Fatal("no option carried keen")
		}
	}
	strike := slices.IndexFunc(base, func(o fight.Option) bool { return o.ID == "strike" })
	got := options([]fight.Resist{{Tag: "keen", Bands: 1}})[strike]
	if p.Fight.BandName(base[strike].Band) != "likely" || p.Fight.BandName(got.Band) != "even" {
		t.Fatalf("strike %s then %s; want likely then even", p.Fight.BandName(base[strike].Band), p.Fight.BandName(got.Band))
	}
}

// An encounter keeps the resistance it began with on every beat.
func TestEncounterCarriesResist(t *testing.T) {
	p := play(t)
	eel := p.Fight.Spawn("mire-stalker", nil, nil, nil)
	rs := []fight.Resist{{Tag: "keen", Bands: 1}}
	e := p.Fight.Assemble(fight.Site{ID: "e-1", Party: 1, Resist: rs}, eel)
	rs[0].Bands = 2
	if s := p.Fight.Situation(e, "c"); len(s.Resist) != 1 || s.Resist[0].Bands != 1 {
		t.Fatalf("situation resist %v", s.Resist)
	}
	if plain := p.Fight.Assemble(fight.Site{ID: "e-1", Party: 1}, eel); plain.Resist != nil || !slices.Equal(plain.Beats, e.Beats) {
		t.Fatal("resist moved the encounter's draws")
	}
}

func TestWithDrop(t *testing.T) {
	p := play(t)
	eel := p.Fight.Spawn("mire-stalker", nil, nil, nil)
	if len(eel.Drops) == 0 {
		t.Fatal("the eel drops nothing")
	}
	rest := slices.Clone(eel.Drops[1:])
	spawned := p.Fight.Spawn("mire-stalker", nil, nil, nil)
	v := spawned
	v.WithDrop("found.plated.stalker-hide")
	if v.Drops[0] != "found.plated.stalker-hide" || !slices.Equal(v.Drops[1:], rest) {
		t.Fatalf("drops %v", v.Drops)
	}
	if !reflect.DeepEqual(spawned.Drops, eel.Drops) {
		t.Fatal("WithDrop changed the creature it was copied from")
	}
	var none fight.Creature
	none.WithDrop("x")
	if len(none.Drops) != 0 {
		t.Fatal("a creature with no drops gained one")
	}
}
