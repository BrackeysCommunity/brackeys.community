package sheets

import (
	"reflect"
	"slices"
	"strconv"
	"strings"
)

// Rows for the director: pacing, the season's day table, arc templates,
// settlement troubles and occasions, pattern puzzles, caches and faction
// cities (GDD 12, 4.8, 4.13).

// Pacing is one scope's limits (GDD 12.4).
type Pacing struct {
	ID         string `json:"id" unit:"enum" enum:"world|region|settlement|personal"`
	AtOnce     int64  `json:"atOnce" unit:"count" min:"1"`
	PerRegions int64  `json:"perRegions,omitempty" unit:"count" min:"0" doc:"region: AtOnce arcs per this many awake regions."`
	Stages     int64  `json:"stages,omitempty" unit:"count" min:"0" doc:"world: stages a world arc has."`
	RestDays   int64  `json:"restDays" unit:"days" min:"0"`
	Note       string `json:"note,omitempty" unit:"text"`
}

// SeasonDay is one band of the day table of a season of story.params
// season-days (GDD 12.6).
type SeasonDay struct {
	ID    string `json:"id" unit:"enum" enum:"opening|rising|last|finale"`
	From  int64  `json:"from" unit:"days" min:"1"`
	To    int64  `json:"to" unit:"days" min:"1"`
	Split int64  `json:"split,omitempty" unit:"days" min:"0" doc:"rising: the day world stage 1 ends; stage 2 ends at To."`
	Note  string `json:"note,omitempty" unit:"text"`
}

// ArcRow is an arc template (GDD 12.9).
type ArcRow struct {
	ID     string     `json:"id" unit:"id"`
	Scope  string     `json:"scope" unit:"enum" enum:"world|region|personal"`
	When   string     `json:"when" unit:"text" doc:"The predicate's id in sim/arc."`
	Finale bool       `json:"finale,omitempty" unit:"flag" doc:"Cast only as a season's finale."`
	Chance int64      `json:"chance" unit:"percent" min:"0" max:"100" doc:"Daily chance an eligible cast is taken."`
	Cast   []CastRow  `json:"cast" unit:"parts"`
	Stages []StageRow `json:"stages" unit:"parts"`
	// Syndicate rows take sides only from characters at the syndicate's
	// gate standing (GDD 4.5).
	Syndicate bool   `json:"syndicate,omitempty" unit:"flag" doc:"Sides refuse a character under factions.syndicate gate standing."`
	Note      string `json:"note,omitempty" unit:"text"`
}

// CastRow is one role an arc casts and how it is picked.
type CastRow struct {
	Role string `json:"role" unit:"text"`
	Kind string `json:"kind" unit:"enum" enum:"faction|region|holding|settlement|notable|npc|character|tile|caravan|legend"`
	Pick string `json:"pick" unit:"enum" enum:"given|leading|most-loyal|least-loyal|largest|smallest|weakest|nearest|owed|keyed"`
}

// StageRow is one stage of an arc: its sides and what its lapse does.
type StageRow struct {
	ID    string        `json:"id" unit:"id"`
	Days  int64         `json:"days,omitempty" unit:"days" min:"0" doc:"Deadline of a region or personal stage; a world stage ends on its band."`
	Sides []SideRow     `json:"sides" unit:"parts"`
	Lapse []StoryEffect `json:"lapse" unit:"parts"`
}

// SideRow is one side of a stage: a pooled goal with a mark to fill.
type SideRow struct {
	ID       string        `json:"id" unit:"id"`
	Wants    string        `json:"wants" unit:"enum" enum:"goods|beats|reach|sold|defence|word" doc:"word: choosing the side's id on a topic with the NPC cast at At."`
	Tag      string        `json:"tag,omitempty" unit:"tag" doc:"goods: the tag delivered, or provisions; empty is any goods."`
	Per      int64         `json:"per" unit:"count" min:"1" doc:"Units of the mark per active character."`
	At       string        `json:"at" unit:"text" doc:"The cast role where goods land, beats count or the tile is reached."`
	Sponsor  string        `json:"sponsor,omitempty" unit:"text" doc:"The cast role whose faction pays; empty: the holder of At, or the keepers."`
	Opponent string        `json:"opponent,omitempty" unit:"text"`
	Won      []StoryEffect `json:"won" unit:"parts"`
}

// StoryEffect is one thing the world does when a side wins or a stage, a
// trouble or an occasion ends.
type StoryEffect struct {
	Kind   string `json:"kind" unit:"enum" enum:"fortify|holding-falls|gauge|split|appoint|loyalty|defect|peace|grudge|trouble|spread|seal|keep-open|cache|mend|standing|disposition|withdraw|marked|damage|fees|orders-stop|prices|sick|toll|cut|patrol-road|caravan-on|salvage|caravan-lost|lay-legend|made|inform|den-moves|nothing"`
	Role   string `json:"role,omitempty" unit:"text" doc:"The cast role it acts on; regions: every region of the arc. A trouble's effects act on its place, or on source: the region that cast it."`
	Gauge  string `json:"gauge,omitempty" unit:"ref" ref:"world.gauges"`
	Amount int64  `json:"amount,omitempty" unit:"count" doc:"Points of defence, gauge, loyalty, standing, condition or disposition; days for grudge, spread, marked, fees, orders-stop, prices, sick; seasons for keep-open. holding-falls: defence lost instead when it is its faction's last; split: loyalty both claimants lose instead when the faction holds too few regions to split; damage: condition lost, 0 for settlements.params trouble-damage. toll, cut, patrol-road: days, 0 for emergence.params toll-days, cut-days, patrol-days."`
	Ref    string `json:"ref,omitempty" unit:"text" doc:"trouble: the story.troubles id; cache: the story.caches id."`
}

// StoryEffectKinds are the effect kinds a story.arcs row may name, as the
// Kind field's enum tag gives them.
func StoryEffectKinds() []string {
	f, _ := reflect.TypeFor[StoryEffect]().FieldByName("Kind")
	return strings.Split(f.Tag.Get("enum"), "|")
}

// StoryIDs are the ids a new story row may not take, each with the sheet that holds it.
func (b *Book) StoryIDs() map[string]string {
	taken := map[string]string{}
	for _, a := range b.Arcs {
		taken[a.ID] = "a story.arcs row"
	}
	for _, t := range b.Troubles {
		taken[t.ID] = "a story.troubles row"
	}
	for _, o := range b.Occasions {
		taken[o.ID] = "a story.occasions row"
	}
	return taken
}

// TroubleRow is a settlement trouble (GDD 12.5, 12.10).
type TroubleRow struct {
	ID      string        `json:"id" unit:"id"`
	When    string        `json:"when" unit:"text"`
	Chance  int64         `json:"chance" unit:"percent" min:"0" max:"100"`
	Wants   string        `json:"wants" unit:"enum" enum:"goods|beats|sold|defence"`
	Tag     string        `json:"tag,omitempty" unit:"tag"`
	Per     int64         `json:"per" unit:"count" min:"1"`
	Hunt    string        `json:"hunt,omitempty" unit:"ref" ref:"fights.hunts"`
	Damages []string      `json:"damages" unit:"refs" ref:"settlements.structures"`
	Lost    []StoryEffect `json:"lost" unit:"parts"`
	Held    []StoryEffect `json:"held" unit:"parts"`
	Banner  string        `json:"banner" unit:"text"`
	Note    string        `json:"note,omitempty" unit:"text"`
}

// OccasionRow is a settlement occasion (GDD 12.5).
type OccasionRow struct {
	ID     string `json:"id" unit:"id"`
	When   string `json:"when" unit:"text"`
	Chance int64  `json:"chance" unit:"percent" min:"0" max:"100"`
	Days   int64  `json:"days" unit:"days" min:"1"`
	Hunt   string `json:"hunt,omitempty" unit:"ref" ref:"fights.hunts"`
	Banner string `json:"banner" unit:"text"`
	Note   string `json:"note,omitempty" unit:"text"`
}

// PatternPuzzle is what a pattern's puzzle is and what solving it opens
// (GDD 4.13).
type PatternPuzzle struct {
	ID        string        `json:"id" unit:"id"`
	Pattern   string        `json:"pattern,omitempty" unit:"ref" ref:"map.patterns" doc:"A scaffold pattern; empty for a placed one."`
	Kind      string        `json:"kind" unit:"enum" enum:"order|state|alignment|connection|completion|constellation"`
	Values    int64         `json:"values" unit:"count" min:"1" doc:"Settings or facings a point takes; 1 for a kind with none."`
	Need      int64         `json:"need,omitempty" unit:"count" min:"0" doc:"connection: live runs; constellation: points found before the hidden one shows."`
	Clues     int64         `json:"clues" unit:"count" min:"0"`
	ClueReach int64         `json:"clueReach" unit:"tiles" min:"0"`
	Servers   int64         `json:"servers,omitempty" unit:"count" min:"0" doc:"Distinct servers whose characters must set its points."`
	LapseDays int64         `json:"lapseDays" unit:"days" min:"1"`
	Family    []PointFamily `json:"family" unit:"parts"`
	Opens     []PatternOpen `json:"opens" unit:"parts"`
	// Shape, Size, Points and Place lay a chained pattern; a scaffold one
	// has none.
	Shape  string `json:"shape,omitempty" unit:"ref" ref:"map.shapes"`
	Size   int64  `json:"size,omitempty" unit:"tiles" min:"0"`
	Points string `json:"points,omitempty" unit:"enum" enum:"corners|every|spaced"`
	Place  string `json:"place,omitempty" unit:"enum" enum:"relay|pylon|beacon|landmark"`
	Note   string `json:"note,omitempty" unit:"text"`
}

// PointFamily is the hand puzzle a kind of point is set with.
type PointFamily struct {
	Place  string `json:"place" unit:"enum" enum:"relay|pylon|beacon|landmark|vault"`
	Family string `json:"family,omitempty" unit:"ref" ref:"puzzles.families" doc:"Empty: the point is set by a delivery of beacon-cost."`
}

// PatternOpen is one thing a solved pattern opens.
type PatternOpen struct {
	Kind  string `json:"kind" unit:"enum" enum:"arc|pattern|cache|fact|sight|seam|dungeon|road"`
	Ref   string `json:"ref,omitempty" unit:"text" doc:"arc: story.arcs id; pattern: story.pattern-puzzles id; cache: story.caches id."`
	N     int64  `json:"n,omitempty" unit:"count" doc:"sight: tiles; seam: stock."`
	Waits string `json:"waits,omitempty" unit:"text"`
}

// Cache is goods a solved pattern or a won side opens.
type Cache struct {
	ID    string      `json:"id" unit:"id"`
	Goods []CacheLine `json:"goods" unit:"parts"`
	Note  string      `json:"note,omitempty" unit:"text"`
}

// CacheLine is one material of a cache.
type CacheLine struct {
	Material string `json:"material" unit:"ref" ref:"items.materials"`
	Quantity int64  `json:"quantity" unit:"goods" min:"1"`
}

// FactionCityRow is each archetype's city station (GDD 4.8): a
// structure kind under the faction's own name, and what it does there.
type FactionCityRow struct {
	ID      string `json:"id" unit:"ref" ref:"factions.archetypes"`
	Station string `json:"station" unit:"ref" ref:"settlements.structures"`
	Name    string `json:"name" unit:"text"`
	Effect  string `json:"effect" unit:"enum" enum:"fee-half|mount-discount|salvage-share|plate-tier|cleanse"`
	Amount  int64  `json:"amount,omitempty" unit:"percent" min:"0"`
	Waits   string `json:"waits,omitempty" unit:"text"`
	Note    string `json:"note,omitempty" unit:"text"`
}

// Names the story sheets share with the game: scopes, the roles every arc
// may name without casting them, the rising band and the provisions tag.
const (
	ScopeWorld    = "world"
	ScopeRegion   = "region"
	ScopePersonal = "personal"
	// RoleRegions is every region of the arc.
	RoleRegions = "regions"
	// RoleSource is the region a trouble was cast from.
	RoleSource = "source"
	// BandRising is the band holding a world arc's first two stages.
	BandRising = "rising"
	// TagProvisions is the goods a side or trouble may want besides a tag.
	TagProvisions = "provisions"
)

// structural: the effect kinds whose Ref names a row, and the shape of a
// contest: two sides to back, two values to choose between.
const (
	leastSides  = 2
	leastValues = 2

	effectTrouble  = "trouble"
	effectCache    = "cache"
	effectGauge    = "gauge"
	effectMade     = "made"
	effectInform   = "inform"
	effectDenMoves = "den-moves"
	wantWord       = "word"
)

// storyProblems checks the story sheets against each other and the
// sheets they name.
func (b *Book) storyProblems() []string {
	var p []string
	param := func(id string) (int64, bool) {
		for _, r := range b.StoryParams {
			if r.ID == id {
				return r.Value.Floor(), true
			}
		}
		p = append(p, "story.params: no "+id)
		return 0, false
	}
	least, okLeast := param("stage-days-least")
	most, okMost := param("stage-days-most")
	seasonDays, okSeason := param("season-days")
	if okLeast && okMost && (least < 1 || most < least) {
		p = append(p, "story.params stage-days-least: a stage lasts at least a day, and no longer than stage-days-most")
	}
	if zero, ok := param("season-zero-days"); ok && okSeason && (zero < int64(len(seasonBands())) || zero > seasonDays) {
		p = append(p, "story.params season-zero-days: a season zero holds every band and is no longer than season-days")
	}

	pacing := map[string]*Pacing{}
	for i := range b.Pacing {
		r := &b.Pacing[i]
		if pacing[r.ID] != nil {
			p = append(p, "story.pacing: two rows for "+r.ID)
		}
		pacing[r.ID] = r
	}
	for _, scope := range enumOf[Pacing]("ID") {
		if pacing[scope] == nil {
			p = append(p, "story.pacing: no row for "+scope)
		}
	}
	worldStages := int64(0)
	if w := pacing[ScopeWorld]; w != nil {
		worldStages = w.Stages
		if w.Stages < 1 {
			p = append(p, "story.pacing world: a world arc has at least one stage")
		}
	}
	if r := pacing[ScopeRegion]; r != nil && r.PerRegions < 1 {
		p = append(p, "story.pacing region: perRegions is at least 1")
	}

	p = append(p, b.seasonDayProblems(seasonDays, okSeason)...)

	vocab := holds(b.Vocabulary)
	tagOK := func(tag string) bool { return tag == "" || tag == TagProvisions || vocab(tag) }
	troubles, caches := holds(b.Troubles), holds(b.Caches)
	effects := func(at string, es []StoryEffect, role func(string) bool) {
		for i, e := range es {
			where := at + "[" + strconv.Itoa(i) + "]"
			if e.Role != "" && !role(e.Role) {
				p = append(p, where+": role "+e.Role+" is not in the cast")
			}
			switch e.Kind {
			case effectTrouble:
				if !troubles(e.Ref) {
					p = append(p, where+": trouble "+e.Ref+" is not a story.troubles id")
				}
			case effectCache:
				if !caches(e.Ref) {
					p = append(p, where+": cache "+e.Ref+" is not a story.caches id")
				}
			case effectGauge:
				if e.Gauge == "" || e.Amount == 0 {
					p = append(p, where+": a gauge effect names its gauge and moves it")
				}
			default:
				if e.Ref != "" {
					p = append(p, where+": only a trouble or a cache names a row")
				}
			}
		}
	}

	for _, a := range b.Arcs {
		at := "story.arcs " + a.ID
		cast, kinds := map[string]bool{}, map[string]string{}
		for _, c := range a.Cast {
			if cast[c.Role] || c.Role == RoleRegions || c.Role == "" {
				p = append(p, at+": role "+strconv.Quote(c.Role)+" is cast twice, empty or reserved")
			}
			cast[c.Role], kinds[c.Role] = true, c.Kind
		}
		crime := func(where string, es []StoryEffect) {
			for i, e := range es {
				ew := where + "[" + strconv.Itoa(i) + "]"
				switch e.Kind {
				case effectMade:
					if !a.Syndicate || kinds[e.Role] != "character" {
						p = append(p, ew+": made acts on a character, in a syndicate row")
					}
				case effectInform, effectDenMoves:
					if kinds[e.Role] != "settlement" {
						p = append(p, ew+": "+e.Kind+" acts on the den's settlement")
					}
				}
			}
		}
		inCast := func(role string) bool { return cast[role] }
		effectRole := func(role string) bool { return role == RoleRegions || cast[role] }
		if a.Finale && (a.Scope != ScopeWorld || len(a.Stages) != 1) {
			p = append(p, at+": a finale is a world arc of one stage")
		}
		if a.Scope == ScopeWorld && !a.Finale && int64(len(a.Stages)) != worldStages {
			p = append(p, at+": a world arc has "+strconv.FormatInt(worldStages, base10)+" stages, not "+strconv.Itoa(len(a.Stages)))
		}
		if a.Scope != ScopeWorld && len(a.Stages) != 1 {
			p = append(p, at+": a region or personal arc has one stage")
		}
		stageIDs := map[string]bool{}
		for _, s := range a.Stages {
			sat := at + " " + s.ID
			if stageIDs[s.ID] {
				p = append(p, sat+": two stages share this id")
			}
			stageIDs[s.ID] = true
			switch {
			case a.Scope == ScopeWorld && s.Days != 0:
				p = append(p, sat+": a world stage ends on its band, so it carries no days")
			case a.Scope != ScopeWorld && okLeast && okMost && (s.Days < least || s.Days > most):
				p = append(p, sat+": "+strconv.FormatInt(s.Days, base10)+" days is outside stage-days-least..stage-days-most")
			}
			if len(s.Sides) < leastSides {
				p = append(p, sat+": a stage has at least two sides worth backing")
			}
			if len(s.Lapse) == 0 {
				p = append(p, sat+": a stage's lapse does something")
			}
			sides := map[string]bool{}
			for _, sd := range s.Sides {
				sdat := sat + " " + sd.ID
				if sides[sd.ID] {
					p = append(p, sdat+": two sides share this id")
				}
				sides[sd.ID] = true
				for _, r := range []string{sd.At, sd.Sponsor, sd.Opponent} {
					if r != "" && !inCast(r) {
						p = append(p, sdat+": role "+r+" is not in the cast")
					}
				}
				if sd.At == "" {
					p = append(p, sdat+": a side names where it counts")
				}
				if sd.Wants == "goods" && !tagOK(sd.Tag) || sd.Wants != "goods" && sd.Tag != "" {
					p = append(p, sdat+": tag "+strconv.Quote(sd.Tag)+" is not a goods tag in tags.vocabulary or provisions")
				}
				if len(sd.Won) == 0 {
					p = append(p, sdat+": a side's win does something")
				}
				if sd.Wants == wantWord && kinds[sd.At] != "npc" {
					p = append(p, sdat+": a word is said to the NPC cast at at")
				}
				effects(sdat+" won", sd.Won, effectRole)
				crime(sdat+" won", sd.Won)
			}
			effects(sat+" lapse", s.Lapse, effectRole)
			crime(sat+" lapse", s.Lapse)
		}
	}

	troubleRole := func(role string) bool { return role == RoleSource }
	for _, t := range b.Troubles {
		at := "story.troubles " + t.ID
		if t.Wants == "goods" && (t.Tag == "" || !tagOK(t.Tag)) || t.Wants != "goods" && t.Tag != "" {
			p = append(p, at+": tag "+strconv.Quote(t.Tag)+" is not a goods tag in tags.vocabulary or provisions")
		}
		if len(t.Damages) == 0 {
			p = append(p, at+": a lost trouble damages a structure of its type")
		}
		effects(at+" lost", t.Lost, troubleRole)
		effects(at+" held", t.Held, troubleRole)
		for _, e := range slices.Concat(t.Lost, t.Held) {
			if e.Kind == effectMade || e.Kind == effectInform || e.Kind == effectDenMoves {
				p = append(p, at+": "+e.Kind+" belongs to an arc's cast, not a trouble")
			}
		}
	}

	puzzles, arcs := holds(b.PatternPuzzles), holds(b.Arcs)
	for _, pz := range b.PatternPuzzles {
		at := "story.pattern-puzzles " + pz.ID
		placed := pz.Shape != "" || pz.Size != 0 || pz.Points != "" || pz.Place != ""
		if (pz.Pattern == "") == !placed || placed && (pz.Shape == "" || pz.Size < 1 || pz.Points == "" || pz.Place == "") {
			p = append(p, at+": a puzzle names a scaffold pattern, or lays one with shape, size, points and place")
		}
		if (pz.Kind == "connection" || pz.Kind == "constellation") && pz.Need < 1 {
			p = append(p, at+": a "+pz.Kind+" needs need")
		}
		if (pz.Kind == "state" || pz.Kind == "alignment") && pz.Values < leastValues {
			p = append(p, at+": a "+pz.Kind+" point takes at least two values")
		}
		places := map[string]bool{}
		for _, f := range pz.Family {
			if places[f.Place] {
				p = append(p, at+": two families for "+f.Place)
			}
			places[f.Place] = true
		}
		if len(pz.Opens) == 0 {
			p = append(p, at+": solving it opens something")
		}
		for _, o := range pz.Opens {
			var ok bool
			switch o.Kind {
			case "arc":
				ok = arcs(o.Ref)
			case "pattern":
				ok = puzzles(o.Ref) && o.Ref != pz.ID
			case effectCache:
				ok = caches(o.Ref)
			default:
				ok = o.Ref == ""
			}
			if !ok {
				p = append(p, at+": opens "+o.Kind+" "+strconv.Quote(o.Ref)+" does not resolve")
			}
			if (o.Kind == "sight" || o.Kind == "seam") && o.N < 1 {
				p = append(p, at+": opens "+o.Kind+" needs n")
			}
		}
	}

	cities := map[string]int{}
	for _, c := range b.FactionCities {
		cities[c.ID]++
	}
	for _, a := range b.Archetypes {
		switch {
		case a.Seatless && cities[a.ID] != 0:
			p = append(p, "story.faction-cities: seatless archetype "+a.ID+" holds no city")
		case !a.Seatless && cities[a.ID] != 1:
			p = append(p, "story.faction-cities: archetype "+a.ID+" needs exactly one row")
		}
	}
	return p
}

// seasonDayProblems holds the day table to its bands, in order, covering
// a season from day 1 to season-days.
func (b *Book) seasonDayProblems(days int64, ok bool) []string {
	var p []string
	bands := seasonBands()
	if len(b.SeasonDays) != len(bands) {
		return []string{"story.days: one row per band, in order"}
	}
	next := int64(1)
	for i, r := range b.SeasonDays {
		if r.ID != bands[i] {
			p = append(p, "story.days: one row per band, in order")
			break
		}
		if r.From != next || r.To < r.From {
			p = append(p, "story.days "+r.ID+": bands run on from day 1 without a gap")
		}
		if r.ID == BandRising && r.Split == 0 {
			p = append(p, "story.days rising: split names the day world stage 1 ends")
		}
		if r.Split != 0 && (r.Split < r.From || r.Split >= r.To) {
			p = append(p, "story.days "+r.ID+": split lies inside the band, before its end")
		}
		next = r.To + 1
	}
	if ok && next-1 != days {
		p = append(p, "story.days: the last band ends on story.params season-days")
	}
	return p
}

func seasonBands() []string { return enumOf[SeasonDay]("ID") }

// enumOf is a row column's enum values.
func enumOf[T any](field string) []string {
	f, _ := reflect.TypeFor[T]().FieldByName(field)
	return slices.Clone(EnumValues(f))
}
