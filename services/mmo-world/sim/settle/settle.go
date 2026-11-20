// Package settle is settlements as rules (GDD 4.8, 4.16): a place on a
// tile, the guild that runs it, and the structures it is made of, each
// with a tier and a condition that troubles, raids and neglect wear down
// and repairs restore.
package settle

import (
	"slices"

	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// Structure is one structure of a settlement.
type Structure struct {
	Kind      string `json:"kind"`
	Tier      int64  `json:"tier"`
	Condition int64  `json:"condition"`
	Built     int64  `json:"built"`
	// Used is the tick it was last used; neglect counts from it.
	Used int64 `json:"used"`
}

// Closed reports whether a structure is at 0 condition and shut until
// repaired.
func (s Structure) Closed() bool { return s.Condition <= 0 }

// Settlement is an open settlement: a starting one from the lattice or one
// a guild founded.
type Settlement struct {
	N   int     `json:"n"` // its index among open settlements
	Hex hex.Hex `json:"hex"`
	// Lattice is a starting settlement's lattice index; -1 for a founded
	// one.
	Lattice int    `json:"lattice"`
	Name    string `json:"name,omitempty"`
	// Guild runs it; "" for a starting settlement nobody has taken.
	Guild      string      `json:"guild,omitempty"`
	Founded    int64       `json:"founded"`
	Structures []Structure `json:"structures"`
}

// Chartered reports whether a guild founded it.
func (s *Settlement) Chartered() bool { return s.Lattice < 0 }

// Get is a structure of a kind, or nil.
func (s *Settlement) Get(kind string) *Structure {
	for i := range s.Structures {
		if s.Structures[i].Kind == kind {
			return &s.Structures[i]
		}
	}
	return nil
}

// Open reports whether a structure of a kind stands and is not closed.
func (s *Settlement) Open(kind string) bool {
	st := s.Get(kind)
	return st != nil && !st.Closed()
}

// Use marks a structure used at a tick.
func (s *Settlement) Use(kind string, tick int64) {
	if st := s.Get(kind); st != nil {
		st.Used = tick
	}
}

// Params are the settlements sheet's structure cells.
type Params struct {
	ConditionMax, TroubleDamage, RaidDamage, Neglect, NeglectTicks, RepairShare, ReopenShare int64
	StationTier, FoundDistance                                                               int64
}

// ParamsOf reads them.
func ParamsOf(p []sheets.Param) Params {
	i := func(id string) int64 { return sheets.IntParam(p, id) }
	return Params{ConditionMax: i("condition-max"), TroubleDamage: i("trouble-damage"), RaidDamage: i("raid-damage"),
		Neglect: i("neglect"), NeglectTicks: i("neglect-days") * sheets.TicksPerDay, RepairShare: i("repair-share"),
		ReopenShare: i("reopen-share"), StationTier: i("station-tier"), FoundDistance: i("found-distance")}
}

// Raise builds a structure at tier 1 or lifts it a tier, at full
// condition; false past its row's or the settlement's cap.
func (s *Settlement) Raise(row *sheets.Structure, tick int64, p Params) bool {
	st := s.Get(row.ID)
	if st == nil {
		s.Structures = append(s.Structures, Structure{Kind: row.ID, Tier: 1, Condition: p.ConditionMax, Built: tick, Used: tick})
		return true
	}
	if st.Tier >= Cap(row, p) {
		return false
	}
	st.Tier++
	st.Condition, st.Used = p.ConditionMax, tick
	return true
}

// Cap is the highest tier a structure reaches outside a city: its row's,
// and for a station the settlement's station tier.
func Cap(row *sheets.Structure, p Params) int64 {
	if row.Station {
		return min(row.MaxTier, p.StationTier)
	}
	return row.MaxTier
}

// Cost is what the next tier of a structure costs: its first tier's lines
// if it is not built, else a tier up's.
func (s *Settlement) Cost(row *sheets.Structure) []sheets.CostLine {
	if s.Get(row.ID) == nil {
		return row.First
	}
	return row.Each
}

// Worth is a structure's whole cost so far, line by line: its first tier
// and every tier up it has had. A tier the charter built is worth a tier
// up.
func Worth(row *sheets.Structure, tier int64) []sheets.CostLine {
	first := row.First
	if row.Charter {
		first = row.Each
	}
	out := slices.Clone(first)
	for range max(0, tier-1) {
		out = addLines(out, row.Each)
	}
	return out
}

func addLines(a, b []sheets.CostLine) []sheets.CostLine {
	for _, l := range b {
		i := slices.IndexFunc(a, func(x sheets.CostLine) bool { return x.Tag == l.Tag })
		if i < 0 {
			a = append(a, l)
			continue
		}
		a[i].Quantity += l.Quantity
	}
	return a
}

// Repair is what restoring points of condition costs: RepairShare per
// cent of the structure's worth per point, and for a closed structure at
// least ReopenShare per cent; each line at least one unit.
func Repair(row *sheets.Structure, st Structure, points int64, p Params) []sheets.CostLine {
	share := points * p.RepairShare
	if st.Closed() {
		share = max(share, p.ReopenShare)
	}
	var out []sheets.CostLine
	for _, l := range Worth(row, st.Tier) {
		out = append(out, sheets.CostLine{Tag: l.Tag, Quantity: max(1, l.Quantity*share/hundred)})
	}
	return out
}

// structural: shares are in per cent.
const hundred = 100

// Mend restores a structure's condition by points, to its maximum.
func (s *Settlement) Mend(kind string, points int64, p Params) {
	if st := s.Get(kind); st != nil {
		st.Condition = min(p.ConditionMax, st.Condition+points)
	}
}

// Damage takes points off a structure's condition, to 0; it reports
// whether the structure closed.
func (s *Settlement) Damage(kind string, points int64) bool {
	st := s.Get(kind)
	if st == nil || st.Closed() {
		return false
	}
	st.Condition = max(0, st.Condition-points)
	return st.Closed()
}

// Neglect wears every structure nobody has used for NeglectTicks by the
// day's neglect, and returns the kinds that closed.
func (s *Settlement) Neglect(tick int64, p Params) []string {
	var closed []string
	for i := range s.Structures {
		st := &s.Structures[i]
		if tick-st.Used < p.NeglectTicks || st.Closed() {
			continue
		}
		st.Condition = max(0, st.Condition-p.Neglect)
		if st.Closed() {
			closed = append(closed, st.Kind)
		}
	}
	return closed
}

// FarEnough reports whether a tile stands at least the founding distance
// from every other settlement's.
func FarEnough(h hex.Hex, others []hex.Hex, p Params) bool {
	for _, o := range others {
		if hex.Distance(h, o) < p.FoundDistance {
			return false
		}
	}
	return true
}

// Charter lists the structures a charter builds.
func Charter(rows []sheets.Structure) []*sheets.Structure {
	var out []*sheets.Structure
	for i := range rows {
		if rows[i].Charter {
			out = append(out, &rows[i])
		}
	}
	return out
}
