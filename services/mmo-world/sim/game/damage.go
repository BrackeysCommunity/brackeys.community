package game

import (
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
)

// What wears a settlement between its troubles (GDD 4.16): a raid that
// reaches it takes raid-damage a world day, and the keepers of a place no
// guild runs mend it.

// structural: the gauge line a raid reaches a place by, and the part that
// keeps a raid's daily pick of a station apart from a lost trouble's.
const (
	lineRaid = "threat-raid"
	raidPart = "raid"
)

// raidDay wears each standing place whose region holds its raid line: its
// wall, or an open station drawn when no wall stands open.
func (g *Game) raidDay(t int64) error {
	li := slices.IndexFunc(g.r.Book.GaugeLines, func(l sheets.GaugeLine) bool { return l.ID == lineRaid })
	points := g.r.Settle.RaidDamage
	if li < 0 || points <= 0 {
		return nil
	}
	for _, p := range g.Places {
		r := g.World.RegionAt(p.Hex)
		if p.Ruined != 0 || r < 0 {
			continue
		}
		reg := &g.World.Regions[r]
		if li >= len(reg.Active) || !reg.Active[li] {
			continue
		}
		kind := g.raidTarget(p, t)
		if kind == "" {
			continue
		}
		var causes []fact.ID
		if reg.RaidFact > 0 {
			causes = []fact.ID{reg.RaidFact}
		}
		if err := g.damaged(p, kind, points, raidPart, causes); err != nil {
			return err
		}
	}
	return nil
}

// raidTarget is what a raid wears at a place: the wall while it stands
// open, else an open station drawn per place and day.
func (g *Game) raidTarget(p *Place, t int64) string {
	if p.Open(structureWall) {
		return structureWall
	}
	return g.openStation(p, t, draw.Str(raidPart))
}

// openStation is one of a place's open stations, drawn per place and day,
// or "" when none stands open.
func (g *Game) openStation(p *Place, t int64, parts ...draw.Part) string {
	var open []string
	for _, st := range p.Structures {
		if row := g.r.structures[st.Kind]; row != nil && row.Station && !st.Closed() {
			open = append(open, st.Kind)
		}
	}
	if len(open) == 0 {
		return ""
	}
	k := g.r.draw.Below(uint64(len(open)), structureDraw, append([]draw.Part{draw.Int(int64(p.N)), draw.Int(t / sheets.TicksPerDay)}, parts...)...)
	return open[k]
}

// damaged takes points off one structure of a place and says so; subjects
// come before the settlement.
func (g *Game) damaged(p *Place, kind string, points int64, by string, causes []fact.ID, subjects ...fact.Ref) error {
	closed := p.Damage(kind, points)
	st := p.Get(kind)
	if st == nil {
		return nil
	}
	_, err := g.worldFact(p.Hex, "structure.damaged", append(slices.Clip(subjects), arc.SettlementRef(p.N)), causes,
		append([]fact.Datum{fact.S("structure", kind), fact.N("points", points), fact.N("condition", st.Condition), fact.B("closed", closed),
			fact.S("by", by), fact.N("settlement", int64(p.N))}, fact.At(p.Hex)...)...)
	return err
}

// keeperRun reports whether a place is kept by its keepers: a starting
// settlement nobody runs, or a faction's city, which players never run.
func keeperRun(p *Place) bool { return p.Guild == "" && (p.Lattice >= 0 || p.Faction != nil) }

// keepersMend restores keeper-mend condition a day on every structure of
// each keeper-run place; one they reopen is a fact.
func (g *Game) keepersMend() error {
	points := g.r.Story.KeeperMend
	if points <= 0 {
		return nil
	}
	for _, p := range g.Places {
		if p.Ruined != 0 || !keeperRun(p) {
			continue
		}
		for i := range p.Structures {
			st := &p.Structures[i]
			if st.Condition >= g.r.Settle.ConditionMax {
				continue
			}
			closed := st.Closed()
			p.Mend(st.Kind, points, g.r.Settle)
			if !closed {
				continue
			}
			if _, err := g.worldFact(p.Hex, "structure.repaired", []fact.Ref{arc.SettlementRef(p.N)}, nil,
				append([]fact.Datum{fact.S("structure", st.Kind), fact.N("points", points), fact.S("by", byKeepers),
					fact.N("settlement", int64(p.N))}, fact.At(p.Hex)...)...); err != nil {
				return err
			}
		}
	}
	return nil
}

// structural: who mended a keeper-run place.
const byKeepers = "keepers"
