package sheets

import (
	"reflect"
	"slices"
	"strconv"
)

// Rows for alignment, theft and the leanings NPCs read them by (GDD 5.10,
// 6.5, 4.5, 4.18).

// AlignBand is one band of a character's alignment, From to To inclusive.
type AlignBand struct {
	ID   string `json:"id" unit:"id"`
	From int64  `json:"from" unit:"count" min:"-100" max:"100" doc:"Alignment, inclusive."`
	To   int64  `json:"to" unit:"count" min:"-100" max:"100" doc:"Alignment, inclusive."`
	Note string `json:"note,omitempty" unit:"text"`
}

// AlignAct is one act that moves alignment (GDD 5.10).
type AlignAct struct {
	ID      string `json:"id" unit:"id"`
	Move    int64  `json:"move" unit:"count" doc:"Points the act asks to move; with perCoin, the sign of a move priced on worth."`
	PerCoin int64  `json:"perCoin,omitempty" unit:"coin" min:"0" doc:"Worth per point moved; 0 moves by move alone."`
	Least   int64  `json:"least,omitempty" unit:"count" min:"0" doc:"With perCoin: the least the act moves."`
	Partner string `json:"partner,omitempty" unit:"enum" enum:"rescued|poster|named" doc:"Whom the act was done for."`
	Paired  bool   `json:"paired,omitempty" unit:"flag" doc:"Held to alignment.params pair-day per partner a world day."`
	Note    string `json:"note,omitempty" unit:"text"`
}

// TheftKind is one way to steal, or to run from the watch (GDD 6.5): its
// beats in order and the cells its haul and witness read.
type TheftKind struct {
	ID             string      `json:"id" unit:"id"`
	Beats          []TheftBeat `json:"beats" unit:"parts" doc:"The beats in order, a beat as often as it comes; none is drawn."`
	Witness        int64       `json:"witness" unit:"percent" min:"0" max:"100" doc:"The witness formula's base in a settlement."`
	WitnessOut     int64       `json:"witnessOut,omitempty" unit:"percent" min:"0" max:"100" doc:"The base away from a settlement."`
	Coin           int64       `json:"coin,omitempty" unit:"coin" min:"0" doc:"lift: the haul's cap, in coin of worth, at Sleight 0."`
	CoinPerSleight int64       `json:"coinPerSleight,omitempty" unit:"coin" min:"0" doc:"lift: added to the cap per Sleight level."`
	Goods          int64       `json:"goods,omitempty" unit:"goods" min:"0" doc:"burgle: the most faction stock a haul draws on."`
	GoodsPerUnit   int64       `json:"goodsPerUnit,omitempty" unit:"goods" min:"0" doc:"burgle: faction stock per unit of material taken."`
	Share          int64       `json:"share,omitempty" unit:"percent" min:"0" max:"100" doc:"waylay: the share of each of the caravan's goods taken."`
	Always         bool        `json:"always,omitempty" unit:"flag" doc:"Always witnessed; the formula is not rolled."`
	Watch          bool        `json:"watch,omitempty" unit:"flag" doc:"A flight from the watch: no haul and no witness."`
	Tags           []string    `json:"tags" unit:"tags" ref:"tags.vocabulary" doc:"The stand-in opponent's tags, which rules read."`
	Note           string      `json:"note,omitempty" unit:"text"`
}

// TheftBeat is one beat of a theft, in its place.
type TheftBeat struct {
	Beat string `json:"beat" unit:"ref" ref:"fights.beats"`
}

// BeatIDs are the kind's beats in order, for an encounter's fixed beats.
func (k TheftKind) BeatIDs() []string {
	out := make([]string, len(k.Beats))
	for i, b := range k.Beats {
		out[i] = b.Beat
	}
	return out
}

// Leaning is the odds an NPC draws its leaning by, for the faction that
// holds its home, a role's own leaning, or none.
type Leaning struct {
	ID      string `json:"id" unit:"id" doc:"A factions.archetypes id, a role's leaning, or none."`
	Upright int64  `json:"upright" unit:"percent" min:"0" max:"100"`
	Crooked int64  `json:"crooked" unit:"percent" min:"0" max:"100"`
	Note    string `json:"note,omitempty" unit:"text"`
}

// BandShift is what a character's alignment band adds to an NPC's
// disposition toward it, by the NPC's leaning (GDD 4.18). Its columns are
// the alignment.bands rows, in order.
type BandShift struct {
	ID         string `json:"id" unit:"enum" enum:"upright|none|crooked" doc:"The NPC's leaning."`
	Notorious  int64  `json:"notorious" unit:"count" min:"-100" max:"100"`
	Crooked    int64  `json:"crooked" unit:"count" min:"-100" max:"100"`
	Unremarked int64  `json:"unremarked" unit:"count" min:"-100" max:"100"`
	Decent     int64  `json:"decent" unit:"count" min:"-100" max:"100"`
	Upright    int64  `json:"upright" unit:"count" min:"-100" max:"100"`
	Note       string `json:"note,omitempty" unit:"text"`
}

// Shift is the row's disposition shift for a band; 0 for a band it does
// not name.
func (s BandShift) Shift(band string) int64 {
	v, t := reflect.ValueOf(s), reflect.TypeFor[BandShift]()
	for i := range t.NumField() {
		if f := t.Field(i); f.Type.Kind() == reflect.Int64 && jsonName(f) == band {
			return v.Field(i).Int()
		}
	}
	return 0
}

// bandShiftColumns are BandShift's band columns in field order.
func bandShiftColumns() []string {
	var out []string
	for f := range reflect.TypeFor[BandShift]().Fields() {
		if f.Type.Kind() == reflect.Int64 {
			out = append(out, jsonName(f))
		}
	}
	return out
}

// Leanings an NPC draws, and the npcs.leanings row for an NPC no faction
// holds the home of.
const (
	LeanUpright = "upright"
	LeanCrooked = "crooked"
	LeanNone    = "none"
)

// crimeProblems holds the alignment, theft and leaning sheets to each
// other and to the archetypes.
func (b *Book) crimeProblems() []string {
	var p []string
	cell := func(rows []Param, sheet, id string) (int64, bool) {
		for _, r := range rows {
			if r.ID == id {
				return r.Value.Floor(), true
			}
		}
		p = append(p, sheet+": no "+id)
		return 0, false
	}
	lo, okLo := cell(b.AlignParams, "alignment.params", "min")
	hi, okHi := cell(b.AlignParams, "alignment.params", "max")
	depth, okDepth := cell(b.AlignParams, "alignment.params", "depth")
	if okLo && okHi && lo >= hi {
		p = append(p, "alignment.params: min lies under max")
	}
	if okLo && okHi && okDepth && (depth <= hi || depth <= -lo) {
		p = append(p, "alignment.params depth: lies past min and max, so a move toward zero always moves")
	}

	if okLo && okHi {
		next := lo
		for _, bd := range b.AlignBands {
			if bd.From != next || bd.To < bd.From {
				p = append(p, "alignment.bands "+bd.ID+": bands run on from min without a gap")
			}
			next = bd.To + 1
		}
		if len(b.AlignBands) > 0 && next-1 != hi {
			p = append(p, "alignment.bands: the last band ends on max")
		}
	}
	var bands []string
	for _, bd := range b.AlignBands {
		bands = append(bands, bd.ID)
	}
	if !slices.Equal(bands, bandShiftColumns()) {
		p = append(p, "npcs.band-shifts: its columns are the alignment.bands rows, in order")
	}
	shifts := map[string]bool{}
	for _, s := range b.BandShifts {
		shifts[s.ID] = true
	}
	for _, l := range enumOf[BandShift]("ID") {
		if !shifts[l] {
			p = append(p, "npcs.band-shifts: no row for "+l)
		}
	}

	for _, a := range b.AlignActs {
		at := "alignment.acts " + a.ID
		if a.Move == 0 {
			p = append(p, at+": an act moves alignment")
		}
		if a.Paired && a.Partner == "" {
			p = append(p, at+": a paired act names its partner")
		}
		if a.Least != 0 && a.PerCoin == 0 {
			p = append(p, at+": least goes with perCoin")
		}
	}

	for _, k := range b.TheftKinds {
		at := "theft.kinds " + k.ID
		if len(k.Beats) == 0 {
			p = append(p, at+": a theft has at least one beat")
		}
		if k.Always && k.Witness != fullWitness {
			p = append(p, at+": always witnessed is a witness of "+strconv.Itoa(fullWitness))
		}
		if k.Watch && (k.Coin != 0 || k.Goods != 0 || k.Share != 0) {
			p = append(p, at+": a flight from the watch takes no haul")
		}
		if (k.Goods == 0) != (k.GoodsPerUnit == 0) {
			p = append(p, at+": goods and goodsPerUnit come together")
		}
	}

	leans := holds(b.Leanings)
	for _, l := range b.Leanings {
		if l.Upright+l.Crooked > fullWitness {
			p = append(p, "npcs.leanings "+l.ID+": upright and crooked together are at most 100")
		}
	}
	if !leans(LeanNone) {
		p = append(p, "npcs.leanings: no row for "+LeanNone)
	}
	seated := 0
	moved := map[string]bool{}
	for _, mw := range b.MoveWeights {
		moved[mw.Archetype] = true
	}
	for _, a := range b.Archetypes {
		if !leans(a.ID) {
			p = append(p, "npcs.leanings: no row for archetype "+a.ID)
		}
		if !a.Seatless {
			seated++
			continue
		}
		if moved[a.ID] {
			p = append(p, "factions.move-weights: seatless archetype "+a.ID+" makes no moves")
		}
		if len(a.Tends) > 0 {
			p = append(p, "factions.archetypes "+a.ID+": a seatless archetype tends to no move")
		}
	}
	if seated == 0 {
		p = append(p, "factions.archetypes: the horizon seats at least one archetype")
	}
	return p
}

// structural: a certain witness, in per cent.
const fullWitness = 100
