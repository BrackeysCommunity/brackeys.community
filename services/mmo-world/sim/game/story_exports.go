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
// subjects: a pin's never (GDD 14.5), a thread's only by its own
// character (GDD 12.8); viewer "" is the public.
func Visible(viewer, kind string, subjects []fact.Ref) bool {
	if sheets.PinFact(kind) {
		return false
	}
	if ThreadFact(kind) {
		return viewer != "" && slices.Contains(subjects, char.Ref(viewer))
	}
	return true
}

// ArcVisible reports whether a viewer may see an arc: a personal thread
// is its own character's alone.
func ArcVisible(a *Arc, viewer string) bool {
	return a.Scope != arc.Personal || viewer != "" && a.Char == viewer
}
