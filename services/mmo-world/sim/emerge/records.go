package emerge

import (
	"cmp"
	"encoding/json"
	"maps"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

func cmpHex(a, b hex.Hex) int { return cmp.Or(cmp.Compare(a.Q, b.Q), cmp.Compare(a.R, b.R)) }

// SortedHexes are a hex-keyed map's keys by (q, r).
func SortedHexes[V any](m map[hex.Hex]V) []hex.Hex {
	return slices.SortedFunc(maps.Keys(m), cmpHex)
}

// Spot is one tile's passage, clearing or loss.
type Spot struct {
	Hex    hex.Hex `json:"hex"`
	Count  Counter `json:"count"`
	Window Window  `json:"window"`
	Who    Recent  `json:"who"`            // passage only
	Done   string  `json:"done,omitempty"` // the promotion id once promoted
}

// Spots is a set of spots by tile; it marshals as a slice sorted by (q, r).
type Spots map[hex.Hex]*Spot

func (s Spots) MarshalJSON() ([]byte, error) {
	out := make([]*Spot, 0, len(s))
	for _, h := range SortedHexes(s) {
		if s[h] == nil {
			continue
		}
		sp := *s[h]
		sp.Hex = h
		out = append(out, &sp)
	}
	return json.Marshal(out)
}

func (s *Spots) UnmarshalJSON(b []byte) error {
	var in []*Spot
	if err := json.Unmarshal(b, &in); err != nil {
		return err
	}
	m := make(Spots, len(in))
	for _, sp := range in {
		if sp != nil {
			m[sp.Hex] = sp
		}
	}
	*s = m
	return nil
}

// PairKey is an unordered pair of place indexes, A < B.
type PairKey struct {
	A int `json:"a"`
	B int `json:"b"`
}

// PairOf orders a pair.
func PairOf(m, n int) PairKey {
	if n < m {
		m, n = n, m
	}
	return PairKey{A: m, B: n}
}

func cmpPair(x, y PairKey) int { return cmp.Or(cmp.Compare(x.A, y.A), cmp.Compare(x.B, y.B)) }

// Pair is the haulage trace between two places.
type Pair struct {
	Key    PairKey `json:"key"`
	Count  Counter `json:"count"`
	Window Window  `json:"window"`
	Done   string  `json:"done,omitempty"`
}

// RoadLoad is a region's load carried onto road tiles.
type RoadLoad struct {
	Region  int               `json:"region"`
	Window  Window            `json:"window"`
	Tiles   map[hex.Hex]int64 `json:"tiles"`          // recent load by road tile, for the busiest
	From    int64             `json:"from,omitempty"` // the day the tile tally began
	Busiest hex.Hex           `json:"busiest"`
}

type tileLoad struct {
	Hex  hex.Hex `json:"hex"`
	Load int64   `json:"load"`
}

type roadLoadWire struct {
	Region  int        `json:"region"`
	Window  Window     `json:"window"`
	Tiles   []tileLoad `json:"tiles"`
	From    int64      `json:"from,omitempty"`
	Busiest hex.Hex    `json:"busiest"`
}

func (r RoadLoad) wire() roadLoadWire {
	w := roadLoadWire{Region: r.Region, Window: r.Window, From: r.From, Busiest: r.Busiest, Tiles: make([]tileLoad, 0, len(r.Tiles))}
	for _, h := range SortedHexes(r.Tiles) {
		w.Tiles = append(w.Tiles, tileLoad{Hex: h, Load: r.Tiles[h]})
	}
	return w
}

func (r RoadLoad) MarshalJSON() ([]byte, error) { return json.Marshal(r.wire()) }

func (r *RoadLoad) UnmarshalJSON(b []byte) error {
	var w roadLoadWire
	if err := json.Unmarshal(b, &w); err != nil {
		return err
	}
	*r = RoadLoad{Region: w.Region, Window: w.Window, From: w.From, Busiest: w.Busiest, Tiles: make(map[hex.Hex]int64, len(w.Tiles))}
	for _, t := range w.Tiles {
		r.Tiles[t.Hex] = t.Load
	}
	return nil
}

// StyleKey is a style in a region.
type StyleKey struct {
	Region int    `json:"region"`
	Style  string `json:"style"`
}

func cmpStyle(x, y StyleKey) int {
	return cmp.Or(cmp.Compare(x.Region, y.Region), cmp.Compare(x.Style, y.Style))
}

// StyleTrace is reliance on one style in one region, then its adaptation.
type StyleTrace struct {
	Key      StyleKey         `json:"key"`
	Resisted string           `json:"resisted"`
	Lead     string           `json:"lead"`
	Count    Counter          `json:"count"` // the reliance trace
	Chars    map[string]Wins  `json:"chars,omitempty"`
	Qual     Recent           `json:"qual"`              // the newest qualifiers
	Done     string           `json:"done,omitempty"`    // the style's promotion id
	Beaten   map[string]int64 `json:"beaten,omitempty"`  // archetype: wins since named
	Adapt    int64            `json:"adapt"`             // percent 0..100
	Today    Daily            `json:"today"`             // wins with it today and the day before
	Variant  string           `json:"variant,omitempty"` // the variant's promotion id
}

// MostBeaten is the archetype beaten most since the style was named; ties
// go to the lowest id so the pick does not hang on map order.
func (s *StyleTrace) MostBeaten() (string, bool) {
	best, n := "", int64(0)
	for _, a := range slices.Sorted(maps.Keys(s.Beaten)) {
		if s.Beaten[a] > n {
			best, n = a, s.Beaten[a]
		}
	}
	return best, n > 0
}

// RegionTally is a region's won beats and downs.
type RegionTally struct {
	Region   int     `json:"region"`
	Reliance Counter `json:"reliance"` // all styles
	Today    Daily   `json:"today"`    // won beats today and the day before
	Downs    Counter `json:"downs"`
}

// Subject is renown on an item, a notable or a character.
type Subject struct {
	Ref    fact.Ref `json:"ref"`
	Count  Counter  `json:"count"`
	Heavy  int64    `json:"heavy"` // heavy facts this season
	Season int64    `json:"season"`
	Region int      `json:"region"`
	At     hex.Hex  `json:"at"`
	Done   string   `json:"done,omitempty"`
}

// HeavyIn is the subject's heavy facts in a season.
func (s *Subject) HeavyIn(season int64) int64 {
	if s.Season != season {
		return 0
	}
	return s.Heavy
}

// AddHeavy counts one heavy fact in a season.
func (s *Subject) AddHeavy(season int64) {
	if s.Season != season {
		s.Heavy, s.Season = 0, season
	}
	s.Heavy++
}

// MastersKey is a puzzle family at a settlement.
type MastersKey struct {
	Place  int    `json:"place"`
	Family string `json:"family"`
}

func cmpMasters(x, y MastersKey) int {
	return cmp.Or(cmp.Compare(x.Place, y.Place), cmp.Compare(x.Family, y.Family))
}

// Due lists the trace keys touched on one day, for expiry.
type Due struct {
	Day  int64    `json:"day"`
	Keys []DueKey `json:"keys"`
}

// DueKey names one trace entry: its trace and the key field that trace uses.
type DueKey struct {
	Trace  string    `json:"trace"`
	Hex    *hex.Hex  `json:"hex,omitempty"`
	Pair   *PairKey  `json:"pair,omitempty"`
	Style  *StyleKey `json:"style,omitempty"`
	Ref    string    `json:"ref,omitempty"`
	Region int       `json:"region,omitempty"`
}

// structural: separators of a due key's identity string.
const dueSep = "|"

func (k DueKey) id() string {
	s := k.Trace + dueSep
	if k.Hex != nil {
		s += k.Hex.Ref()
	}
	s += dueSep
	if k.Pair != nil {
		s += strconv.Itoa(k.Pair.A) + "," + strconv.Itoa(k.Pair.B)
	}
	s += dueSep
	if k.Style != nil {
		s += strconv.Itoa(k.Style.Region) + "," + k.Style.Style
	}
	return s + dueSep + k.Ref + dueSep + strconv.Itoa(k.Region)
}

// Promotion is one thing play made part of the world.
type Promotion struct {
	ID     string   `json:"id"` // "<type>:<n>"
	Type   Type     `json:"type"`
	Name   string   `json:"name"`
	Named  string   `json:"named,omitempty"` // the first's rename
	First  string   `json:"first,omitempty"` // character id
	Tick   int64    `json:"tick"`
	Season int64    `json:"season"`
	Region int      `json:"region"` // -1: none
	At     *hex.Hex `json:"at,omitempty"`
	Places []int    `json:"places,omitempty"`
	Of     string   `json:"of,omitempty"` // style id, archetype, material id, class id, family
	Fact   fact.ID  `json:"fact"`
}

// Shown is the first's rename, else the name it was given.
func (p Promotion) Shown() string {
	if p.Named != "" {
		return p.Named
	}
	return p.Name
}

// RoadRec is one named road.
type RoadRec struct {
	ID          string `json:"id"` // its promotion id
	Region      int    `json:"region"`
	Tiles       int64  `json:"tiles"`
	CutUntil    int64  `json:"cutUntil,omitempty"`    // world day
	TollUntil   int64  `json:"tollUntil,omitempty"`   // world day
	PatrolUntil int64  `json:"patrolUntil,omitempty"` // world day
}

// Cut, Tolled and Patrolled read the road on a world day.
func (r *RoadRec) Cut(day int64) bool       { return day < r.CutUntil }
func (r *RoadRec) Tolled(day int64) bool    { return day < r.TollUntil }
func (r *RoadRec) Patrolled(day int64) bool { return day < r.PatrolUntil }

// CampRec is a site's station.
type CampRec struct {
	ID      string `json:"id"`
	Station string `json:"station"`
}

// HauntRec is a haunted site and the creature that now leads there.
type HauntRec struct {
	ID   string `json:"id"`
	Lead string `json:"lead"`
}

// RouteRec is a named trade route.
type RouteRec struct {
	ID      string    `json:"id"`
	A       int       `json:"a"`
	B       int       `json:"b"`
	Path    []hex.Hex `json:"path"`
	Regions []int     `json:"regions"`
	Next    int64     `json:"next"` // the day its next caravan leaves
	FromA   bool      `json:"fromA"`
}

// Caravan is one caravan on a route; its tile follows from its path, its legs and its clock.
type Caravan struct {
	ID     string `json:"id"`
	Route  string `json:"route"`
	From   int    `json:"from"`
	To     int    `json:"to"`
	Depart int64  `json:"depart"`           // tick
	Arrive int64  `json:"arrive"`           // tick
	Halted int64  `json:"halted,omitempty"` // tick it stopped, 0 moving
	Arc    string `json:"arc,omitempty"`
	// Legs are the ticks from its path's first tile to each tile, read the
	// day it left; Material and Units are its manifest.
	Legs     []int64 `json:"legs,omitempty"`
	Material string  `json:"material,omitempty"`
	Units    int64   `json:"units,omitempty"`
}

// VariantRec is a region's adapted creature.
type VariantRec struct {
	ID        string `json:"id"` // promotion id
	Region    int    `json:"region"`
	Archetype string `json:"archetype"`
	Row       string `json:"row"` // emergence.adaptations id
	Style     string `json:"style"`
	Resisted  string `json:"resisted"`
	Material  string `json:"material"` // found material id
}

// LegendRec is a legend and where it lives.
type LegendRec struct {
	ID     string   `json:"id"`
	Trait  string   `json:"trait"`
	Of     fact.Ref `json:"of"` // a goal line's target archetype as creature:<id>, or item:<instance>
	Region int      `json:"region"`
	At     hex.Hex  `json:"at"`
	Cast   int64    `json:"cast,omitempty"` // last day cast
	Laid   int64    `json:"laid,omitempty"` // day laid to rest
}

// Line is a goal signature's season, toward a legend or a custom.
type Line struct {
	Sig       string  `json:"sig"`
	Goal      string  `json:"goal"` // newest goal of the line
	Standing  bool    `json:"standing"`
	Days      int64   `json:"days"` // season days it stood posted
	Met       bool    `json:"met"`
	Attempts  Recent  `json:"attempts"` // id "<char>@<day>", capped at the line's count
	Archetype string  `json:"archetype,omitempty"`
	Region    int     `json:"region"`
	At        hex.Hex `json:"at"`
	Place     int     `json:"place"`    // -1: not a settlement goal
	FirstDay  int64   `json:"firstDay"` // season day first posted
}

// Sig is a settlement goal signature's run of seasons.
type Sig struct {
	Sig    string `json:"sig"`
	Streak int64  `json:"streak"`
	Last   int64  `json:"last"` // season last counted
	Done   string `json:"done,omitempty"`
}

// Count counts the signature in a season: a run continues only from the
// season before.
func (s *Sig) Count(season int64) {
	switch {
	case s.Streak > 0 && s.Last == season:
		return
	case s.Streak > 0 && s.Last == season-1:
		s.Streak++
	default:
		s.Streak = 1
	}
	s.Last = season
}

// CustomRec is a goal the world posts by itself each season.
type CustomRec struct {
	ID    string `json:"id"`
	Place int    `json:"place"`
	Spec  []byte `json:"spec"` // the canonical goal spec it posts (game.GoalSpec, opaque here)
	Day   int64  `json:"day"`  // season day, of the season's length
	Held  int64  `json:"held"` // season last posted
}

// Contest is two First-mode goals racing for one thing.
type Contest struct {
	A      string `json:"a"`
	B      string `json:"b"`
	SeatA  int    `json:"seatA"`
	SeatB  int    `json:"seatB"`
	Region int    `json:"region"`
	Tag    string `json:"tag"`
	Cast   bool   `json:"cast,omitempty"`
}

// Week and SeasonCount are the measures' history.
type Week struct {
	From   int64 `json:"from"` // day
	Kinds  int64 `json:"kinds"`
	Active int64 `json:"active"`
}

type SeasonCount struct {
	Season      int64          `json:"season"`
	Active      int64          `json:"active"`
	Promotions  map[Type]int64 `json:"promotions"`
	Heavy       int64          `json:"heavy"`
	HeavyPlayer int64          `json:"heavyPlayer"`
}
