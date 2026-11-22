// Package world runs a world with nobody in it, and with whatever its
// players do, on four clocks (GDD 4.7): weather moves every tick; gauges,
// factions, notables, creatures and new weather run every world day; a
// ledger report every week; a season turns. Only regions inside the
// horizon carry state (GDD 4.2), and only tiles that differ from their
// baseline are stored, so a world day costs what the discovered world
// costs. Everything that happens is a fact.
package world

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/weather"
)

// structural: the day comes from sheets; none marks no index.
const (
	ticksPerDay = sheets.TicksPerDay
	none        = -1
)

// Region is a region inside the horizon.
type Region struct {
	ID         int           `json:"id"` // its index in State.Regions
	Lattice    gen.LatticeID `json:"lattice"`
	Gauge      []int64       `json:"gauge"`
	Base       []int64       `json:"base"`
	Active     []bool        `json:"active"` // per gauge line
	Holder     int           `json:"holder"` // faction, or none
	Defence    int64         `json:"defence"`
	Settlement bool          `json:"settlement"` // an open starting settlement nobody holds
	Patrolled  bool          `json:"patrolled"`
	RaidFact   fact.ID       `json:"raidFact"` // the fact that opened the raid line, while it holds
	// SurgeFact is the surge behind the region's threat, until threat falls
	// back under the ambush line; line facts name it as their cause.
	SurgeFact  fact.ID `json:"surgeFact"`
	Neighbours []int   `json:"neighbours"` // awake neighbours
	Tiles      int     `json:"tiles"`
	Tier       int64   `json:"tier"` // from the nearest open starting settlement
	Discovered bool    `json:"discovered"`
	// Weather is today's share of the region's tiles under each weather
	// kind, in world.weather order, in percent.
	Weather []int64 `json:"weather"`
}

// State is a world. Its exported fields are the whole of it: a snapshot
// is its JSON, and Attach makes a decoded snapshot runnable again.
type State struct {
	Tick        int64           `json:"tick"`
	Day         int64           `json:"day"`
	Regions     []Region        `json:"regions"`
	Factions    []Faction       `json:"factions"`
	NextNotable int             `json:"nextNotable"`
	Tiles       []*tile.State   `json:"tiles"`
	Sky         weather.Sky     `json:"sky"`
	Bands       []Band          `json:"bands"`
	NextBand    int             `json:"nextBand"`
	Finds       []Find          `json:"finds"`
	Novelty     []NoveltyBand   `json:"novelty"`
	Landfalls   []Landfall      `json:"landfalls"`
	Dormant     []gen.LatticeID `json:"dormant"` // the fringe: dormant regions next to the horizon
	// Opened counts the starting settlements open, nearest the origin
	// first; Opening counts those asked for, which open at the next day.
	Opened  int `json:"opened"`
	Opening int `json:"opening"`
	// ContentVersion is ContentNative or ContentDrawn (GDD 4.17).
	ContentVersion int64         `json:"contentVersion,omitempty"`
	History        []HistoryCell `json:"history,omitempty"`
	Pins           []Pin         `json:"pins,omitempty"`
	NextPin        int64         `json:"nextPin,omitempty"`

	g         *gen.Gen
	b         *sheets.Book
	d         *draw.Drawer
	sky       *weather.Rules
	tp        tile.Params
	weights   fact.Weights
	factRows  map[string]*sheets.FactWeight
	creatures map[string]*sheets.Creature
	ecotones  map[string]*sheets.Ecotone
	moves     map[string]*sheets.MoveWeight
	region    map[gen.LatticeID]int
	tileAt    map[hex.Hex]int
	gauge     map[string]int
	// Never saved: edited is the tiles whose content changed since the last
	// Advance; pinCells and findsIn are indexes rebuilt on demand after Pins
	// or Finds change.
	edited    map[hex.Hex]bool
	pinCells  map[pinCell][]int
	findsIn   map[gen.LatticeID][]int
	findsSeen int
}

// New starts a world: the first starting settlement is open and its
// region discovered, and the horizon wakes round it.
func New(b *sheets.Book, g *gen.Gen, key draw.Key) (*State, error) {
	s := &State{Opened: 1, Sky: weather.Sky{Systems: []weather.System{}}, ContentVersion: ContentDrawn}
	s.Attach(b, g, key)
	home := g.Settlement(0)
	if err := s.discoverRegion(nil, g.RegionOf(home.Hex)); err != nil {
		return nil, err
	}
	s.furnish(home.Hex)
	if len(s.Factions) == 0 {
		return nil, fmt.Errorf("world: no room for a faction seat")
	}
	return s, nil
}

// Attach binds a state to its sheets, generator and roll key: after New,
// or after decoding a snapshot.
func (s *State) Attach(b *sheets.Book, g *gen.Gen, key draw.Key) {
	s.b, s.g, s.d = b, g, draw.NewDrawer(key)
	s.sky = weather.NewRules(b)
	s.tp = tile.NewParams(b)
	s.weights, s.moves = fact.NewWeights(b.FactWeights), map[string]*sheets.MoveWeight{}
	s.factRows, s.creatures, s.ecotones = sheets.Lookup(b.FactWeights), sheets.Lookup(b.Creatures), sheets.Lookup(b.Ecotones)
	for i := range b.MoveWeights {
		mw := &b.MoveWeights[i]
		s.moves[mw.Archetype+"/"+mw.Move] = mw
	}
	s.gauge = map[string]int{}
	for i, gg := range b.Gauges {
		s.gauge[gg.ID] = i
	}
	s.region = map[gen.LatticeID]int{}
	for i, r := range s.Regions {
		s.region[r.Lattice] = i
	}
	s.tileAt = map[hex.Hex]int{}
	for i, t := range s.Tiles {
		s.tileAt[t.Hex] = i
	}
}

// Gen is the generator the world reads its baseline from.
func (s *State) Gen() *gen.Gen { return s.g }

// Drawn reports whether the world draws content from history at first
// reach; a world from before that reads the seed's function.
func (s *State) Drawn() bool { return s.ContentVersion >= ContentDrawn }

// Edited are the tiles whose content changed since the last Advance, so a
// command's save writes them too.
func (s *State) Edited() []hex.Hex {
	return slices.SortedFunc(maps.Keys(s.edited), hex.Compare)
}

func (s *State) p(id string) int64  { return sheets.IntParam(s.b.FactionParams, id) }
func (s *State) wp(id string) int64 { return sheets.IntParam(s.b.WorldParams, id) }
func (s *State) cp(id string) int64 { return sheets.IntParam(s.b.CreatureParams, id) }

// RegionIndex is the index of an awake region, or -1.
func (s *State) RegionIndex(id gen.LatticeID) int {
	if i, ok := s.region[id]; ok {
		return i
	}
	return none
}

// RegionAt is the index of the awake region holding h, or -1.
func (s *State) RegionAt(h hex.Hex) int { return s.RegionIndex(s.g.RegionOf(h)) }

// Tile returns a tile's stored state, or nil while it is at its baseline.
func (s *State) Tile(h hex.Hex) *tile.State {
	if i, ok := s.tileAt[h]; ok {
		return s.Tiles[i]
	}
	return nil
}

// touch returns a tile's stored state, storing it if it was not.
func (s *State) touch(h hex.Hex) *tile.State {
	if t := s.Tile(h); t != nil {
		return t
	}
	t := &tile.State{Hex: h}
	s.tileAt[h] = len(s.Tiles)
	s.Tiles = append(s.Tiles, t)
	return t
}

// prune drops tiles back at their baseline, keeping the others' order.
func (s *State) prune() {
	kept := s.Tiles[:0]
	for _, t := range s.Tiles {
		t.Tidy()
		if !t.Empty() {
			kept = append(kept, t)
		}
	}
	clear(s.Tiles[len(kept):])
	s.Tiles = kept
	s.tileAt = make(map[hex.Hex]int, len(kept))
	for i, t := range kept {
		s.tileAt[t.Hex] = i
	}
}

// RegionRef is how a fact names region r.
func RegionRef(r int) string { return fmt.Sprintf("r-%d", r) }

// ParseRegionRef reads a RegionRef back.
func ParseRegionRef(ref string) (int, bool) {
	var r int
	_, err := fmt.Sscanf(ref, "r-%d", &r)
	return r, err == nil
}

// RefIndex is the index a faction or notable ref carries.
func RefIndex(r fact.Ref) (int, bool) {
	_, n, ok := strings.Cut(r.ID, "-")
	if !ok {
		return 0, false
	}
	var i int
	_, err := fmt.Sscanf(n, "%d", &i)
	return i, err == nil
}

// FactionRef names a faction by its index.
func FactionRef(f int) string { return fmt.Sprintf("f-%d", f) }

func factionRef(f int) fact.Ref { return fact.Ref{Kind: "faction", ID: FactionRef(f)} }
func notableRef(n Notable) fact.Ref {
	return fact.Ref{Kind: "notable", ID: fmt.Sprintf("n-%d", n.ID)}
}
func latticeRef(id gen.LatticeID) string { return fmt.Sprintf("l-%d.%d", id.I, id.J) }

// refAt names the awake region holding h, or its lattice cell when the
// region is dormant.
func (s *State) refAt(h hex.Hex) string {
	if r := s.RegionAt(h); r >= 0 {
		return RegionRef(r)
	}
	return latticeRef(s.g.RegionOf(h))
}

// OpenSettlement asks for the next starting settlement to open. It opens
// at the start of the next world day.
func (s *State) OpenSettlement() { s.Opening++ }

// GaugeOf is a world.gauges row's index in every region's Gauge, if the
// sheets hold the gauge.
func (s *State) GaugeOf(id string) (int, bool) {
	i, ok := s.gauge[id]
	return i, ok
}

// GaugeIndex is a gauge's index for a caller that names one the sheets
// must hold.
func (s *State) GaugeIndex(id string) int {
	i, ok := s.GaugeOf(id)
	if !ok {
		panic("world: no gauge " + id)
	}
	return i
}

// Overrun reports whether a region's overrun line is active.
func (s *State) Overrun(r int) bool { return s.Regions[r].Active[lineIndex(s.b, "overrun")] }

// GaugeAt is a gauge of the region holding a tile, if a region holds it.
func (s *State) GaugeAt(h hex.Hex, id string) (int64, bool) {
	r := s.RegionAt(h)
	if r < 0 {
		return 0, false
	}
	return s.Regions[r].Gauge[s.GaugeIndex(id)], true
}

func (s *State) parts(list string) []string {
	var out []string
	for _, p := range s.b.NameParts {
		if p.List == list {
			out = append(out, p.Text)
		}
	}
	return out
}

func passable(g *gen.Gen, id gen.LatticeID) bool {
	return slices.ContainsFunc(g.RegionTiles(id), func(h hex.Hex) bool { return g.Passable(g.Baseline(h).Terrain) })
}

// furnish stands a starting settlement's opening structures on its tile:
// unowned, at full condition (GDD 4.8).
func (s *State) furnish(h hex.Hex) {
	t := s.touch(h)
	if len(t.Structures) > 0 {
		return
	}
	for _, st := range s.b.Starting {
		t.Structures = append(t.Structures, tile.Structure{Kind: st.Structure, Tier: st.Tier, Condition: s.wp("structure-condition")})
	}
}

// Digest is the state's and its ledger's identity, as replays compare it.
func Digest(s *State, log fact.Log) (canon.Sum, error) {
	return canon.Digest([]any{s, log.Since(0)})
}
