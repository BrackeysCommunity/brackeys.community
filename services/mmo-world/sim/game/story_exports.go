package game

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// SideRow is the sheet side an arc's stage runs.
func (g *Game) SideRow(a *Arc, stage int, side string) (sheets.SideRow, bool) {
	row, ok := g.stageRow(a, stage)
	if !ok {
		return sheets.SideRow{}, false
	}
	return sideRow(row, side)
}

// TroubleRow is the trouble row an arc runs, or nil for an arc row.
func (g *Game) TroubleRow(a *Arc) *sheets.TroubleRow { return g.troubleOf(a) }

// ArcByID is an arc the story still holds, or nil.
func (g *Game) ArcByID(id string) *Arc {
	if g.Story == nil {
		return nil
	}
	return g.arcByID(id)
}

// TroubleAt is the trouble open at place n with a stage running, or nil.
func (g *Game) TroubleAt(n int) *Arc {
	ref := goal.SettlementRef(n)
	for _, a := range g.openArcs(arc.Settlement) {
		if a.Place == ref && a.Stage >= 0 && a.Stage < len(a.Stages) {
			return a
		}
	}
	return nil
}

// RefHex is the tile a settlement or tile ref names.
func (g *Game) RefHex(ref string) (hex.Hex, bool) { return g.refHex(ref) }

// NotableName is a notable's given and family name by its story id, or "".
func (g *Game) NotableName(id string) string {
	for _, f := range g.World.Factions {
		for _, n := range f.Notables {
			if notableID(n.ID) == id {
				return strings.TrimSpace(n.Given + " " + n.Family)
			}
		}
	}
	return ""
}

// Visible reports whether a viewer may read a fact of a kind about the
// subjects: a pin's never (GDD 14.5), a thread's and an alignment move's
// only by its own character (GDD 12.8, 5.10), the syndicate's only by a
// character it names; viewer "" is the public. VisibleTo also lets the
// made read the syndicate's.
func Visible(viewer, kind string, subjects []fact.Ref) bool {
	return VisibleTo(viewer, false, kind, subjects)
}

// VisibleTo is Visible for a viewer the syndicate may have made, who
// reads every syndicate and den fact (GDD 4.5).
func VisibleTo(viewer string, made bool, kind string, subjects []fact.Ref) bool {
	own := viewer != "" && slices.Contains(subjects, char.Ref(viewer))
	switch {
	case sheets.PinFact(kind):
		return false
	case ThreadFact(kind), kind == factAlignment:
		return own
	case SyndicateFact(kind):
		return viewer != "" && (made || own)
	}
	return true
}

// SyndicateFact reports whether a fact kind is the syndicate's or a
// den's, hidden from all but the made.
func SyndicateFact(kind string) bool {
	return strings.HasPrefix(kind, syndicateKinds) || strings.HasPrefix(kind, denKinds)
}

// structural: the prefixes of the syndicate's and the dens' fact kinds.
const (
	syndicateKinds = "syndicate."
	denKinds       = "den."
)

// ArcVisible reports whether a viewer may see an arc: a personal thread
// is its own character's alone.
func ArcVisible(a *Arc, viewer string) bool {
	return a.Scope != arc.Personal || viewer != "" && a.Char == viewer
}
