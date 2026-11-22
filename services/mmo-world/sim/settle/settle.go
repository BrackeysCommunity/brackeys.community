// Package settle is settlements as rules (GDD 4.8, 4.16): a place on a
// tile, the guild that runs it, and the structures it is made of, each
// with a tier and a condition that troubles, raids and neglect wear down
// and repairs restore.
package settle

import (
	"slices"

	"jams.team/mmo-world/sim/fixed"
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
	// City is set once the place is raised to a city (GDD 4.8).
	City *City `json:"city,omitempty"`
	// Ruined is the tick the place fell to ruin; it keeps its index.
	Ruined int64 `json:"ruined,omitempty"`
	// Faction is the faction whose city this is; players trade there and
	// never run it.
	Faction *int `json:"faction,omitempty"`
}

// City is what a city holds beyond a settlement: when it was raised, the
// outer tiles it claims, and the project that raised it.
type City struct {
	Raised  int64     `json:"raised"`
	Tiles   []hex.Hex `json:"tiles"`
	Project string    `json:"project,omitempty"`
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
	StationTier, FoundDistance, CityStationCap                                               int64
}

// ParamsOf reads them.
func ParamsOf(p []sheets.Param) Params {
	i := func(id string) int64 { return sheets.IntParam(p, id) }
	return Params{ConditionMax: i("condition-max"), TroubleDamage: i("trouble-damage"), RaidDamage: i("raid-damage"),
		Neglect: i("neglect"), NeglectTicks: i("neglect-days") * sheets.TicksPerDay, RepairShare: i("repair-share"),
		ReopenShare: i("reopen-share"), StationTier: i("station-tier"), FoundDistance: i("found-distance"),
		CityStationCap: i("city-station-cap")}
}

// Raise builds a structure at tier 1 or lifts it a tier, at full
// condition; false past its row's or the settlement's cap, a city's for a
// city.
func (s *Settlement) Raise(row *sheets.Structure, tick int64, p Params) bool {
	st := s.Get(row.ID)
	if st == nil {
		s.Structures = append(s.Structures, Structure{Kind: row.ID, Tier: 1, Condition: p.ConditionMax, Built: tick, Used: tick})
		return true
	}
	if st.Tier >= CapFor(row, p, s.City != nil) {
		return false
	}
	st.Tier++
	st.Condition, st.Used = p.ConditionMax, tick
	return true
}

// Cap is the highest tier a structure reaches outside a city: its row's,
// and for a station the settlement's station tier.
func Cap(row *sheets.Structure, p Params) int64 { return CapFor(row, p, false) }

// CapFor is Cap in a city or outside one: a city's stations reach the
// city's cap.
func CapFor(row *sheets.Structure, p Params, city bool) int64 {
	if !row.Station {
		return row.MaxTier
	}
	if city {
		return min(row.MaxTier, p.CityStationCap)
	}
	return min(row.MaxTier, p.StationTier)
}

// Next is the tier a raise lifts a structure to and what that costs: the
// first tier's lines where none stands (st nil), else a tier up's. ok is
// false past the cap, and for a structure with no lines, which goals do
// not raise.
func Next(row *sheets.Structure, st *Structure, p Params) (tier int64, lines []sheets.CostLine, ok bool) {
	return next(row, st, p, false)
}

func next(row *sheets.Structure, st *Structure, p Params, city bool) (tier int64, lines []sheets.CostLine, ok bool) {
	tier, lines = 1, row.First
	if st != nil {
		tier, lines = st.Tier+1, row.Each
	}
	return tier, lines, tier <= CapFor(row, p, city) && len(lines) > 0
}

// Next is Next for the settlement's own structure of the row, to a
// city's cap in a city.
func (s *Settlement) Next(row *sheets.Structure, p Params) (tier int64, lines []sheets.CostLine, ok bool) {
	return next(row, s.Get(row.ID), p, s.City != nil)
}

// Scaled is a cost at pct per cent, each line at least one unit.
func Scaled(lines []sheets.CostLine, pct int64) []sheets.CostLine {
	out := make([]sheets.CostLine, len(lines))
	for i, l := range lines {
		out[i] = sheets.CostLine{Tag: l.Tag, Quantity: max(1, fixed.PercentFloor(l.Quantity, pct))}
	}
	return out
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
	return Scaled(Worth(row, st.Tier), share)
}

// ReopenPoints is the condition the least repair of a closed structure
// restores: what ReopenShare buys at RepairShare a point.
func ReopenPoints(p Params) int64 { return p.ReopenShare / max(p.RepairShare, 1) }

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
