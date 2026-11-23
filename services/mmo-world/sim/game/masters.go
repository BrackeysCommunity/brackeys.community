package game

import (
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/sheets"
)

// The masters trace (GDD 7.11): distinct characters holding a puzzle
// family's title whose home is a settlement. At the line the settlement's
// bench offers that family one level easier.

func init() {
	registerEmerge(emergeHook{Name: "masters", Order: mastersOrder, Kinds: []string{factPuzzleMastered}, Fact: mastersFact})
}

// structural: the masters trace reads nothing the other hooks write.
const mastersOrder = customsOrder + 1

const factPuzzleMastered = "puzzle.mastered"

// structural: titles never fade, so the masters trace keeps no season.
const mastersSeason = 0

// mastersFact counts a newly titled master on its home settlement's
// family, and promotes the settlement's masters at the line.
func mastersFact(g *Game, f fact.Fact) error {
	who := subjectID(f, renownCharacter)
	c := g.Char(who)
	if c == nil {
		return nil
	}
	n, ok := goal.SettlementOf(c.C.Home)
	if !ok || n < 0 || n >= len(g.Places) {
		return nil
	}
	family, _ := f.Get("family")
	e, need := g.Emergence, g.r.Emerge.P.MastersLine
	k := emerge.MastersKey{Place: n, Family: family.S}
	r := e.Masters[k]
	if r == nil {
		r = &emerge.Recent{}
		e.Masters[k] = r
	}
	r.See(who, f.Tick/sheets.TicksPerDay, mastersSeason, need)
	if e.Eased[k] || int64(len(r.IDs)) < need {
		return nil
	}
	e.Eased[k] = true
	at := g.SettlementHex(n)
	_, err := g.promoteTrace(Promoting{Type: emerge.Masters, Region: -1, At: &at, Places: []int{n}, Of: family.S, Cause: f.ID})
	return err
}

// benchEase is how many levels easier a settlement's bench offers a
// family its masters eased.
func (g *Game) benchEase(settlement int, family string) int64 {
	if g.Emergence == nil || !g.Emergence.Eased[emerge.MastersKey{Place: settlement, Family: family}] {
		return 0
	}
	return g.r.Emerge.P.MastersEase
}
