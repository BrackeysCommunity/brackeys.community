package sheets

import (
	"slices"
	"strconv"
	"strings"
)

// Rows for content drawn from history and the pins that stage it
// (GDD 4.17, 14.4, 14.5).

// ContentWeight shifts one row of a content table by one condition of the
// history digest; gen.Weights applies it.
type ContentWeight struct {
	ID        string `json:"id" unit:"id"`
	Table     string `json:"table" unit:"enum" enum:"site|dungeon|lead|stock|trait|role"`
	Row       string `json:"row" unit:"id" doc:"A row of the table's sheet: map.site-kinds, map.dungeons, creatures.archetypes (or region: the region's own creature), map.stock-bands, npcs.traits, npcs.roles (road)."`
	Fact      string `json:"fact,omitempty" unit:"ref" ref:"story.fact-weights" doc:"Counts heavy facts of this kind within reach."`
	Gauge     string `json:"gauge,omitempty" unit:"ref" ref:"world.gauges"`
	Band      int64  `json:"band,omitempty" unit:"count" min:"0" doc:"With gauge: applies once when the tile's region is at or above this band."`
	Faction   string `json:"faction,omitempty" unit:"enum" enum:"war|starving"`
	Archetype string `json:"archetype,omitempty" unit:"ref" ref:"factions.archetypes"`
	Find      string `json:"find,omitempty" unit:"enum" enum:"far-material|edge-material|variant|edge-creature|biome-variant|pattern"`
	Pins      bool   `json:"pins,omitempty" unit:"flag" doc:"Counts the live pins in reach."`
	Shift     int64  `json:"shift" unit:"percent" doc:"Percent of the row's base weight added per count, or once for a band, flag or archetype."`
	Most      int64  `json:"most,omitempty" unit:"count" min:"0" doc:"Counts past this add nothing; 0 means history-kind-most."`
	Note      string `json:"note" unit:"text" doc:"Why the shift."`
}

// SiteKind is what a site slot holds once its tile is first reached.
type SiteKind struct {
	ID     string   `json:"id" unit:"id"`
	Places []string `json:"places" unit:"enum" enum:"site|edge-site" doc:"The slots it may stand on."`
	Weight int64    `json:"weight" unit:"weight" min:"1" doc:"Its base weight against the slot's other kinds, drawn under content.site-kind."`
	Tags   []string `json:"tags" unit:"tags" ref:"tags.vocabulary" doc:"Place tags an encounter at the tile gains."`
	Note   string   `json:"note" unit:"text"`
}

// StockBand is a share of node-stock a tile's material starts with.
type StockBand struct {
	ID      string `json:"id" unit:"id"`
	Percent int64  `json:"percent" unit:"percent" min:"1" doc:"Of node-stock."`
	Weight  int64  `json:"weight" unit:"weight" min:"1" doc:"Its base weight, drawn per material under content.stock."`
	Note    string `json:"note" unit:"text"`
}

// PinLimit is what one role may pin (GDD 14.5). Its id is its role.
type PinLimit struct {
	ID       string   `json:"id" unit:"id" doc:"The role's own name."`
	Role     string   `json:"role" unit:"enum" enum:"designer|admin|staff"`
	ReachMax int64    `json:"reachMax" unit:"tiles" min:"1"`
	PerDay   int64    `json:"perDay" unit:"count" min:"0" doc:"Pins an issuer may make in a world day; 0 means no cap."`
	Fields   []string `json:"fields" unit:"enum" enum:"site|landmark|site-kind|dungeon|floors|lead|stock"`
	Points   int64    `json:"points,omitempty" unit:"event-points" min:"0" doc:"Event points a staff pin costs, recorded on its label."`
	Note     string   `json:"note" unit:"text"`
}

// LeadRegion is the lead table's row for the region's own creature.
const LeadRegion = "region"

// PinRoleDesigner is the role whose reach bounds every other's.
const PinRoleDesigner = "designer"

// BandLines are a gauge's distinct line values, rising. A region's band in
// that gauge is how many of them its value is at or above.
func BandLines(lines []GaugeLine, gauge string) []int64 {
	var out []int64
	for _, l := range lines {
		if l.Gauge == gauge {
			out = append(out, l.AtLeast)
		}
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// stagedOnly are the fields a staged pin may never set: each would put
// goods or a delve in play (GDD 14.5).
var stagedOnly = []string{"stock", "dungeon", "floors"}

// contentProblems checks the content and pin sheets against each other
// and against the sheets they name.
func (b *Book) contentProblems() []string {
	var p []string
	cell := func(id string) (int64, bool) {
		for _, r := range b.MapParams {
			if r.ID == id {
				return r.Value.Floor(), true
			}
		}
		p = append(p, "map.params: no "+id)
		return 0, false
	}
	floor, hasFloor := cell("history-weight")
	if radius, ok := cell("history-radius"); ok && radius <= 0 {
		p = append(p, "map.params history-radius: a digest reads at least one tile")
	}
	if kept, ok := cell("history-cell-kept"); ok && kept < 1 {
		p = append(p, "map.params history-cell-kept: a history cell keeps at least one fact")
	}
	if days, ok := cell("pin-days"); ok && days < 1 {
		p = append(p, "map.params pin-days: a pin counts for at least a day")
	}
	if walk, ok := cell("pin-path-tiles"); ok && walk < 1 {
		p = append(p, "map.params pin-path-tiles: a pin's walk to known ground is bounded")
	}
	perCell, okCell := cell("pins-per-cell")
	if okCell && perCell < 1 {
		p = append(p, "map.params pins-per-cell: a pin cell holds at least one pin")
	}
	inReach, okReach := cell("pins-in-reach-max")
	if okCell && okReach && perCell < inReach {
		p = append(p, "map.params pins-per-cell: under pins-in-reach-max")
	}
	if okReach && inReach < 1 {
		p = append(p, "map.params pins-in-reach-max: a digest reads at least one pin")
	}

	facts := Lookup(b.FactWeights)
	creature := holds(b.Creatures)
	rows := map[string]func(string) bool{
		"site":    holds(b.SiteKinds),
		"dungeon": holds(b.Dungeons),
		"lead":    func(id string) bool { return id == LeadRegion || creature(id) },
		"stock":   holds(b.StockBands),
		"trait":   holds(TraitPool(b.NPCTraits)),
		"role": func(id string) bool {
			i := slices.IndexFunc(b.NPCRoles, func(r NPCRole) bool { return r.ID == id })
			return i >= 0 && b.NPCRoles[i].Place == "road"
		},
	}
	for _, w := range b.ContentWeights {
		at := "map.content-weights " + w.ID
		conds := 0
		for _, set := range []bool{w.Fact != "", w.Gauge != "", w.Faction != "", w.Archetype != "", w.Find != "", w.Pins} {
			if set {
				conds++
			}
		}
		if conds != 1 {
			p = append(p, at+": a row holds exactly one condition")
		}
		if ok := rows[w.Table]; ok != nil && !ok(w.Row) {
			p = append(p, at+": "+w.Row+" is not a row of the "+w.Table+" table")
		}
		if f, ok := facts[w.Fact]; ok {
			if PinFact(f.Kind) {
				p = append(p, at+": "+f.Kind+" is never indexed")
			} else if hasFloor && f.Weight < floor {
				p = append(p, at+": "+f.Kind+" weighs under history-weight, so it is never indexed")
			}
		}
		if w.Band != 0 && w.Gauge == "" {
			p = append(p, at+": a band needs a gauge")
		}
		if w.Gauge != "" {
			if n := int64(len(BandLines(b.GaugeLines, w.Gauge))); w.Band < 1 || w.Band > n {
				p = append(p, at+": band "+strconv.FormatInt(w.Band, base10)+" is outside "+w.Gauge+"'s "+strconv.FormatInt(n, base10)+" lines")
			}
		}
	}

	for _, place := range []string{"site", "edge-site"} {
		if !slices.ContainsFunc(b.SiteKinds, func(k SiteKind) bool { return slices.Contains(k.Places, place) }) {
			p = append(p, "map.site-kinds: no kind stands on "+place+" slots")
		}
	}

	var sum, weights int64
	for _, s := range b.StockBands {
		sum += s.Percent * s.Weight
		weights += s.Weight
	}
	if len(b.StockBands) > 0 && sum != percent*weights {
		p = append(p, "map.stock-bands: the weighted mean percent is not 100")
	}

	roles := map[string]int{}
	var designer int64
	for _, l := range b.PinLimits {
		roles[l.Role]++
		if l.ID != l.Role {
			p = append(p, "map.pin-limits "+l.ID+": a limit's id is its role")
		}
		if l.Role == PinRoleDesigner {
			designer = l.ReachMax
		}
	}
	def, _ := DefByName("map.pin-limits")
	f, _ := def.Row.FieldByName("Role")
	for _, role := range EnumValues(f) {
		if roles[role] != 1 {
			p = append(p, "map.pin-limits: role "+role+" needs exactly one row")
		}
	}
	for _, l := range b.PinLimits {
		if l.ReachMax > designer {
			p = append(p, "map.pin-limits "+l.ID+": reaches past the designer's")
		}
		if l.Role != PinRoleDesigner && slices.ContainsFunc(l.Fields, func(s string) bool { return slices.Contains(stagedOnly, s) }) {
			p = append(p, "map.pin-limits "+l.ID+": a staged pin sets no stock, dungeon or floors")
		}
		if l.Points > 0 && l.Role != "staff" {
			p = append(p, "map.pin-limits "+l.ID+": only staff pins cost points")
		}
	}
	return p
}

// holds reports whether a sheet holds an id.
func holds[T any](rows []T) func(string) bool {
	ids := Lookup(rows)
	return func(id string) bool { _, ok := ids[id]; return ok }
}

// PinKinds is the prefix of the pin facts, which the history index never holds.
const PinKinds = "pin."

// PinFact reports whether a fact kind is a pin's: no history index or player read holds one.
func PinFact(kind string) bool { return strings.HasPrefix(kind, PinKinds) }

// Indexed reports whether a fact of this kind and weight enters the history
// index: heavy enough, and not a pin's.
func Indexed(kind string, weight, floor int64) bool {
	return weight >= floor && !PinFact(kind)
}

// FindKindIDs are the find kinds a content weight may count (world
// Find.Kind).
func FindKindIDs() []string {
	def, _ := DefByName("map.content-weights")
	f, _ := def.Row.FieldByName("Find")
	return EnumValues(f)
}
