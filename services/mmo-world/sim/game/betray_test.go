package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
)

// TestBetrayal: a betrayal writes character.betrayed citing its cause,
// sets the standing to betrayal-standing at most, takes the betrayal act
// from alignment citing it, and leaves a grudge for grudge-days; other
// factions are untouched.
func TestBetrayal(t *testing.T) {
	g := guardGame(t)
	c := alChars(t, g, "knife", 1)[0]
	key, other := factionOwner(0), factionOwner(1)
	c.C.Standing.Bump(key, 30)
	c.C.Standing.Bump(other, 30)
	cause := fact.ID(1)
	if err := g.betray(c, key, ActTheft, cause, g.Tick()); err != nil {
		t.Fatal(err)
	}
	floor := sheets.IntParam(g.r.Book.TheftParams, "betrayal-standing")
	if c.C.Standing.Get(key) != floor || c.C.Standing.Get(other) != 30 {
		t.Fatalf("standing %d with the betrayed, %d with another", c.C.Standing.Get(key), c.C.Standing.Get(other))
	}
	fs := factsOf(g, factBetrayed)
	if len(fs) != 1 {
		t.Fatalf("%d betrayals written", len(fs))
	}
	b := fs[0]
	if !slices.Equal(b.Subjects, []fact.Ref{char.Ref(c.C.ID), arc.FactionRef(0)}) || !slices.Equal(b.Causes, []fact.ID{cause}) ||
		alDatum(b, "faction").S != key || alDatum(b, "act").S != ActTheft || alDatum(b, "standing").N != floor {
		t.Fatalf("betrayed %+v", b)
	}
	m := alCited(t, g, c, ActBetrayal, -25, "", factBetrayed)
	if m.Causes[0] != b.ID || AlignmentOf(c) != -25 || alDatum(m, "public").N != 1 {
		t.Fatalf("alignment %d, moved %+v", AlignmentOf(c), m)
	}
	day := g.Tick() / sheets.TicksPerDay
	days := sheets.IntParam(g.r.Book.TheftParams, "grudge-days")
	if gs := char.GrudgesOf(c.C); !slices.Equal(gs, []char.Grudge{{Faction: key, Ends: day + days}}) {
		t.Fatalf("grudges %+v", gs)
	}
	if !c.GrudgeWith(key, day) || !c.GrudgeWith(key, day+days-1) || c.GrudgeWith(key, day+days) || c.GrudgeWith(other, day) {
		t.Fatal("the grudge runs grudge-days, with the betrayed only")
	}

	// A standing already under the floor stays; a second betrayal runs the
	// grudge on from its day, still one per faction.
	c.C.Standing.Bump(key, -20)
	alDays(t, g, 2)
	if err := g.betray(c, key, ActTheft, cause, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if c.C.Standing.Get(key) != floor-20 {
		t.Fatalf("a lower standing rose to %d", c.C.Standing.Get(key))
	}
	later := g.Tick() / sheets.TicksPerDay
	if gs := char.GrudgesOf(c.C); len(gs) != 1 || gs[0].Ends != later+days {
		t.Fatalf("grudges after a second betrayal %+v", gs)
	}
	if AlignmentOf(c) != -50 {
		t.Fatalf("two betrayals leave %d", AlignmentOf(c))
	}
	if char.IsMade(c.C) || len(factsOf(g, factUnmade)) != 0 {
		t.Fatal("a faction's betrayal unmade someone")
	}
}

// TestBetrayingTheSyndicate unmakes a made character; one not made is only
// betrayed.
func TestBetrayingTheSyndicate(t *testing.T) {
	g := guardGame(t)
	cs := alChars(t, g, "knife", 2)
	made, plain := cs[0], cs[1]
	made.C.Align().Made = true
	made.C.Standing.Bump(syndicateKey, 40)
	if err := g.betray(made, syndicateKey, ActInformed, 1, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if char.IsMade(made.C) || made.C.Standing.Get(syndicateKey) != sheets.IntParam(g.r.Book.TheftParams, "betrayal-standing") {
		t.Fatalf("made %v, standing %d", char.IsMade(made.C), made.C.Standing.Get(syndicateKey))
	}
	un := factsOf(g, factUnmade)
	b := factsOf(g, factBetrayed)
	if len(un) != 1 || len(b) != 1 || !slices.Equal(un[0].Causes, []fact.ID{b[0].ID}) || !slices.Equal(un[0].Subjects, []fact.Ref{char.Ref(made.C.ID)}) {
		t.Fatalf("unmade %+v", un)
	}
	if !slices.Contains(b[0].Subjects, standingRef(syndicateKey)) || !made.GrudgeWith(syndicateKey, g.Tick()/sheets.TicksPerDay) {
		t.Fatal("the syndicate is betrayed and holds the grudge")
	}
	if err := g.betray(plain, syndicateKey, ActTheft, 1, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if len(factsOf(g, factUnmade)) != 1 || len(factsOf(g, factBetrayed)) != 2 {
		t.Fatal("one never made is unmade")
	}

	// The syndicate's facts: never the public's, the made's always, and a
	// character's own.
	f := un[0]
	other := alChars(t, g, "knife", 1)[0]
	if Visible("", f.Kind, f.Subjects) || !Visible(made.C.ID, f.Kind, f.Subjects) || Visible(other.C.ID, f.Kind, f.Subjects) ||
		!VisibleTo(other.C.ID, true, f.Kind, f.Subjects) || VisibleTo("", true, f.Kind, f.Subjects) {
		t.Fatal("syndicate.unmade is the made's and its own character's")
	}
	if Visible("", factDenMoved, nil) || !VisibleTo(other.C.ID, true, factDenMoved, nil) || Visible(other.C.ID, factDenMoved, nil) {
		t.Fatal("den.moved is the made's alone")
	}
	if !Visible("", factBetrayed, b[0].Subjects) || !Visible("", "goal.met", nil) {
		t.Fatal("other facts stay public")
	}
}

func TestStandingRef(t *testing.T) {
	if standingRef(factionOwner(3)) != arc.FactionRef(3) || standingRef(syndicateKey) != (fact.Ref{Kind: "faction", ID: syndicateKey}) {
		t.Fatal(standingRef(factionOwner(3)), standingRef(syndicateKey))
	}
}

// TestBetrayalUnseen: a private betrayal moves alignment without the
// public coming to know of it; a public one is known.
func TestBetrayalUnseen(t *testing.T) {
	g := guardGame(t)
	cs := alChars(t, g, "knife", 2)
	quiet, loud := cs[0], cs[1]
	for _, c := range cs {
		c.C.Align().Made = true
		c.C.Standing.Bump(syndicateKey, 40)
	}
	if err := g.betraySeen(quiet, syndicateKey, ActTheft, 1, false, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if err := g.betraySeen(loud, syndicateKey, ActTheft, 1, true, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if AlignmentOf(quiet) >= 0 || len(char.KnownOf(quiet.C)) != 0 {
		t.Fatalf("unseen betrayal: alignment %d, known %+v", AlignmentOf(quiet), char.KnownOf(quiet.C))
	}
	if len(char.KnownOf(loud.C)) != 1 {
		t.Fatalf("seen betrayal known %+v", char.KnownOf(loud.C))
	}
}
