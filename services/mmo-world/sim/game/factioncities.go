package game

import (
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Faction cities (GDD 4.8): a faction's strong, old, prosperous holding
// opens a city it runs itself. Players trade there and never own it.

// What a faction city's station does there (story.faction-cities).
const (
	effFeeHalf       = "fee-half"
	effMountDiscount = "mount-discount"
	effSalvageShare  = "salvage-share"
)

// structural: a faction city's place is no lattice point and no guild's
// founding; the memory kinds that change a region's holder.
const (
	factionLattice    = -2
	memFactionExpands = "faction.expanded"
)

// factionCitiesDay closes as a ruin every faction city whose holding fell,
// then opens a city for each faction without one whose holding has held
// long, strongly and prosperously enough, with the faction's stock behind
// it.
func (g *Game) factionCitiesDay(day int64) error {
	if g.Story == nil {
		return nil
	}
	t := g.Tick()
	for _, fc := range slices.Clone(g.Story.Cities) {
		if fc.Place >= len(g.Places) || g.Places[fc.Place].Ruined != 0 || g.stillHolds(fc.Faction, fc.Region) {
			continue
		}
		if err := g.ruin(fc.Place, t); err != nil {
			return err
		}
	}
	for fi := range g.World.Factions {
		if g.factionCity(fi) >= 0 {
			continue
		}
		row := g.factionCityRow(g.World.Factions[fi].Archetype)
		r := g.factionCityRegion(fi, day)
		if row == nil || r < 0 {
			continue
		}
		h, ok := g.factionCityTile(r)
		if !ok {
			continue
		}
		if err := g.openFactionCity(fi, r, h, row, t); err != nil {
			return err
		}
	}
	return nil
}

// stillHolds reports whether a living faction still holds a region.
func (g *Game) stillHolds(fi, r int) bool {
	w := g.World
	return fi >= 0 && fi < len(w.Factions) && !w.Factions[fi].Fallen && r >= 0 && r < len(w.Regions) && w.Regions[r].Holder == fi
}

// factionCity is the standing city of a faction, by place, or -1.
func (g *Game) factionCity(fi int) int {
	if g.Story == nil {
		return -1
	}
	for _, fc := range g.Story.Cities {
		if fc.Faction == fi && fc.Place < len(g.Places) && g.Places[fc.Place].Ruined == 0 {
			return fc.Place
		}
	}
	return -1
}

// factionCityRow is an archetype's story.faction-cities row, or nil.
func (g *Game) factionCityRow(archetype string) *sheets.FactionCityRow {
	for i := range g.r.Book.FactionCities {
		if g.r.Book.FactionCities[i].ID == archetype {
			return &g.r.Book.FactionCities[i]
		}
	}
	return nil
}

// factionCityRegion is the faction's holding that may become its city:
// defended, prosperous for long enough, held long enough, with the
// faction's stock behind it; the best defended, then the first. -1 when
// none may.
func (g *Game) factionCityRegion(fi int, day int64) int {
	f := g.World.Factions[fi]
	if f.Fallen || f.Stock < g.fcp("faction-city-stock") {
		return -1
	}
	best := -1
	for r := range g.World.Regions {
		reg := &g.World.Regions[r]
		if reg.Holder != fi || reg.Defence < g.fcp("faction-city-defence") {
			continue
		}
		if st := g.streakOf(r); st == nil || st.Prosper < g.sp("city-prosperity-days") {
			continue
		}
		if g.heldDays(fi, r, day) < g.fcp("faction-city-days") {
			continue
		}
		if best < 0 || reg.Defence > g.World.Regions[best].Defence {
			best = r
		}
	}
	return best
}

// heldDays is how long a faction has held a region as the story's memory
// tells it: since it took the region or split off with it. A holding the
// memory has no change for has been held at least as long as the memory
// reaches, and no longer than the world is old.
func (g *Game) heldDays(fi, r int, day int64) int64 {
	since := int64(-1)
	for _, m := range g.Story.Memory {
		switch {
		case m.Kind == memFactionExpands && m.Region == r:
		case m.Kind == world.FactSplit && len(m.Subjects) > 1 && m.Subjects[1] == arc.FactionRef(fi):
		default:
			continue
		}
		since = max(since, m.Tick/sheets.TicksPerDay)
	}
	if since < 0 {
		return min(g.r.Story.MemoryDays, day)
	}
	return day - since
}

// factionCityTile is the region's highest tile a city may stand on, the
// first in the region's order on a tie.
func (g *Game) factionCityTile(r int) (hex.Hex, bool) {
	var best hex.Hex
	var top int64
	found := false
	for _, h := range g.r.Gen.RegionTiles(g.World.Regions[r].Lattice) {
		if !g.claimable(h, -1) {
			continue
		}
		if e := g.r.Gen.Baseline(h).Elevation; !found || e > top {
			best, top, found = h, e, true
		}
	}
	return best, found
}

// openFactionCity opens a faction's city on a tile: a market and the
// archetype's station at the city's tier, in no guild's hands.
func (g *Game) openFactionCity(fi, r int, h hex.Hex, row *sheets.FactionCityRow, t int64) error {
	n := len(g.Places)
	faction := fi
	p := &Place{N: n, Hex: h, Lattice: factionLattice, Name: g.FactionName(fi), Founded: t, Faction: &faction}
	for _, kind := range []string{structureMarket, row.Station} {
		if p.Get(kind) != nil || g.r.structures[kind] == nil {
			continue
		}
		p.Structures = append(p.Structures, settle.Structure{Kind: kind, Tier: 1, Condition: g.r.Settle.ConditionMax, Built: t, Used: t})
	}
	if st := p.Get(row.Station); st != nil {
		st.Tier = settle.CapFor(g.r.structures[row.Station], g.r.Settle, true)
	}
	g.Places = append(g.Places, p)
	if g.Market != nil {
		g.Market.Trader = append(g.Market.Trader, 0)
	}
	g.Story.Cities = append(g.Story.Cities, FactionCity{Faction: fi, Region: r, Place: n, Since: t})
	_, err := g.worldFact(h, "faction.city", []fact.Ref{arc.FactionRef(fi), arc.SettlementRef(n)}, nil,
		append([]fact.Datum{fact.N("settlement", int64(n)), fact.S("station", row.Station), fact.S("effect", row.Effect),
			fact.S("region", world.RegionRef(r))}, fact.At(h)...)...)
	return err
}

// fcp is a factions sheet cell.
func (g *Game) fcp(id string) int64 { return sheets.IntParam(g.r.Book.FactionParams, id) }

// cityRow is the faction-city row whose effect runs at place n: its
// faction's, while the city stands, its station is open and the effect
// waits for nothing.
func (g *Game) cityRow(n int, effect string) *sheets.FactionCityRow {
	if n < 0 || n >= len(g.Places) {
		return nil
	}
	p := g.Places[n]
	if p.Faction == nil || p.Ruined != 0 || *p.Faction >= len(g.World.Factions) {
		return nil
	}
	row := g.factionCityRow(g.World.Factions[*p.Faction].Archetype)
	if row == nil || row.Effect != effect || row.Waits != "" || !p.Open(row.Station) {
		return nil
	}
	return row
}

// cityStation is the faction-city station at place n, or "".
func (g *Game) cityStation(n int) string {
	if n < 0 || n >= len(g.Places) || g.Places[n].Faction == nil || *g.Places[n].Faction >= len(g.World.Factions) {
		return ""
	}
	if row := g.factionCityRow(g.World.Factions[*g.Places[n].Faction].Archetype); row != nil {
		return row.Station
	}
	return ""
}

// StationName is what a structure at place n goes by when it is a faction
// city's own station, such as the guild's exchange; "" otherwise.
func (g *Game) StationName(n int, kind string) string {
	if kind == "" || g.cityStation(n) != kind {
		return ""
	}
	return g.factionCityRow(g.World.Factions[*g.Places[n].Faction].Archetype).Name
}

// cityFeeCut is the percent of the market fee charged at place n: a
// faction exchange halves it.
func (g *Game) cityFeeCut(n int) int64 {
	if row := g.cityRow(n, effFeeHalf); row != nil {
		return row.Amount
	}
	return fixed.Hundredths
}

// mountShare is the percent of a mount's price its stable at place n
// asks: a war-yard asks less.
func (g *Game) mountShare(n int) int64 {
	if row := g.cityRow(n, effMountDiscount); row != nil {
		return max(fixed.Hundredths-row.Amount, 0)
	}
	return fixed.Hundredths
}

// salvageShare is the percent of a failed craft's inputs a scrap yard at
// place n gives back; 0 where there is none.
func (g *Game) salvageShare(n int) int64 {
	if row := g.cityRow(n, effSalvageShare); row != nil {
		return row.Amount
	}
	return 0
}

// scrapYard gives a craft that failed at a faction's scrap yard the yard's
// larger share of its inputs back.
func (g *Game) scrapYard(c *Char, r item.Recipe, st Station, res *craft.Result) {
	n, ok := g.SettlementAt(c.C.At)
	if !ok || g.cityStation(n) != st.Kind {
		return
	}
	if share := g.salvageShare(n); share > sheets.IntParam(g.r.Book.ItemParams, "failed-salvage") {
		res.Salvage = g.r.Fight.D.Salvage(r.Inputs, share)
	}
}

// cityVendor refuses a character a faction city's vendors will not trade
// with: one without the standing the city asks with its faction.
func (g *Game) cityVendor(c *Char, n int) error {
	if n < 0 || n >= len(g.Places) || g.Places[n].Faction == nil {
		return nil
	}
	p := g.Places[n]
	fi := *p.Faction
	need := g.fcp("faction-city-standing")
	if c.C.Standing.Get(standingKey(fi, p.Hex)) < need {
		return refuse(NotHere, "%s trades only with those of %d standing with it", g.FactionName(fi), need)
	}
	return nil
}
