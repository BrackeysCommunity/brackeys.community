package game

import (
	"fmt"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
)

// mastered is a character's title in a family, as the game writes it.
func mastered(t *testing.T, g *Game, c *Char, family string) {
	t.Helper()
	noted(t, g, factPuzzleMastered, c.C.At, []fact.Ref{char.Ref(c.C.ID)}, fact.S("family", family), fact.N("settlement", int64(g.HomeOf(c))))
}

// Three distinct masters of a family homed at a settlement ease its bench
// in that family by a level, once; a repeat, a master homed nowhere and
// another family do not count toward it.
func TestMastersLine(t *testing.T) {
	g := feedGame(t)
	families := g.Puzzles().All()
	if len(families) < 2 {
		t.Fatal("fewer than two puzzle families")
	}
	fam, other := families[0], families[1]
	need := int(g.r.Emerge.P.MastersLine)
	var masters []*Char
	for i := range need {
		masters = append(masters, mustCreate(t, g, fmt.Sprintf("master-%d", i), "knife"))
	}
	homeless := mustCreate(t, g, "master-homeless", "knife")
	homeless.C.Home = ""
	for _, c := range masters[:need-1] {
		mastered(t, g, c, fam)
	}
	mastered(t, g, masters[0], fam)
	mastered(t, g, homeless, fam)
	mastered(t, g, masters[need-1], other)
	if n := len(promotionsOf(g, emerge.Masters)); n != 0 || g.benchEase(0, fam) != 0 {
		t.Fatalf("%d masters promotions one master short", n)
	}
	spec := func(family string, level int64) int64 {
		return g.benchSpec(masters[0], 0, family, level, false).Level
	}
	before := spec(fam, 3)
	mastered(t, g, masters[need-1], fam)
	ps := promotionsOf(g, emerge.Masters)
	if len(ps) != 1 || ps[0].Of != fam || len(ps[0].Places) != 1 || ps[0].Places[0] != 0 {
		t.Fatalf("the masters promotions are %+v", ps)
	}
	ease := g.r.Emerge.P.MastersEase
	if g.benchEase(0, fam) != ease || spec(fam, 3) != before-ease || spec(fam, 1) != 1 || spec(other, 3) != 3 {
		t.Fatalf("the bench sets %s at %d (was %d), %s at %d", fam, spec(fam, 3), before, other, spec(other, 3))
	}
	mastered(t, g, mustCreate(t, g, "master-late", "knife"), fam)
	if len(promotionsOf(g, emerge.Masters)) != 1 {
		t.Fatal("the masters line promoted twice")
	}
}
