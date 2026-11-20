// Package tile is what the world remembers about one tile once it differs
// from its generated baseline (GDD 4.10). Every field of the stored state
// is here from the start, even where nothing writes it yet. A tile whose
// state is Empty is dropped: it is back to its baseline.
package tile

import (
	"maps"
	"slices"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// State is a tile's stored state (GDD 4.10).
type State struct {
	Hex hex.Hex `json:"hex"`

	Discovered *Discovery `json:"discovered,omitempty"` // who first entered, and when
	Visits     int64      `json:"visits,omitempty"`     // arrivals, decaying
	// Passage counts crossings out of the tile by direction, decaying;
	// roads form from it.
	Passage     [hex.Directions]int64 `json:"passage"`
	BattlesWon  map[string]int64      `json:"battlesWon,omitempty"` // beats won here, by creature tag
	BattlesLost int64                 `json:"battlesLost,omitempty"`
	Population  map[string]int64      `json:"population,omitempty"` // per species, where it differs from capacity
	Slain       map[string]int64      `json:"slain,omitempty"`      // per species, this season
	Residents   []string              `json:"residents,omitempty"`  // NPCs living or camped here
	Stock       map[string]int64      `json:"stock,omitempty"`      // per material, where it differs from capacity
	Gathered    map[string]int64      `json:"gathered,omitempty"`   // units taken, by material, decaying
	Corruption  int64                 `json:"corruption,omitempty"` // 0 to 1,000
	Fire        Fire                  `json:"fire"`
	WeatherTags []string              `json:"weatherTags,omitempty"` // local weather: flooded, snowbound
	Road        int64                 `json:"road,omitempty"`        // 0 none, then track, road, paved
	Structures  []Structure           `json:"structures,omitempty"`
	Owner       *fact.Ref             `json:"owner,omitempty"` // a guild or a faction
	Tracks      []Track               `json:"tracks,omitempty"`
	Graves      []Grave               `json:"graves,omitempty"`
	Events      []fact.ID             `json:"events,omitempty"` // the last heavy facts here, oldest first
	Rumours     []Rumour              `json:"rumours,omitempty"`
	Goals       []string              `json:"goals,omitempty"`
	Dungeon     *Dungeon              `json:"dungeon,omitempty"`
	Season      map[string]int64      `json:"season,omitempty"` // this season's totals of the counters
}

type Discovery struct {
	By   fact.Ref `json:"by"`
	Tick int64    `json:"tick"`
}

// Fire is none, burning with ticks left, or burnt with ticks to regrow.
type Fire struct {
	State string `json:"state,omitempty"` // "", burning, burnt
	Ticks int64  `json:"ticks,omitempty"`
}

const (
	FireBurning = "burning"
	FireBurnt   = "burnt"
)

type Structure struct {
	Kind      string `json:"kind"`
	Tier      int64  `json:"tier,omitempty"`
	Condition int64  `json:"condition"`
}

type Track struct {
	Who  fact.Ref `json:"who"`
	Tick int64    `json:"tick"`
}

type Grave struct {
	Who  fact.Ref `json:"who"`
	Tick int64    `json:"tick"`
}

type Rumour struct {
	Fact    fact.ID `json:"fact"`
	Expires int64   `json:"expires"` // tick
}

type Dungeon struct {
	FloorsCleared  int64      `json:"floorsCleared"`
	ClearedAt      int64      `json:"clearedAt,omitempty"` // tick the deepest cleared floor was cleared
	Fell           []fact.Ref `json:"fell,omitempty"`
	GuardianHealth int64      `json:"guardianHealth"`
}

// Counter names, as rows of tiles.counters.
const (
	CounterVisits      = "visits"
	CounterPassage     = "passage"
	CounterBattlesWon  = "battles-won"
	CounterBattlesLost = "battles-lost"
	CounterGathered    = "gathered"
)

// Params are the tile cells the sim reads.
type Params struct {
	EventRing, TracksKept, HeavyFact int64
	decay                            map[string]int64
}

// NewParams reads tiles.counters and tiles.params.
func NewParams(b *sheets.Book) Params {
	p := Params{
		EventRing:  sheets.IntParam(b.TileParams, "event-ring"),
		TracksKept: sheets.IntParam(b.TileParams, "tracks-kept"),
		HeavyFact:  sheets.IntParam(b.TileParams, "heavy-fact-weight"),
		decay:      map[string]int64{},
	}
	for _, c := range b.TileCounters {
		p.decay[c.ID] = c.DecayPercent
	}
	return p
}

// decay takes a percentage off a counter, rounding the loss up so a
// counter nobody feeds reaches zero.
func decay(v, pct int64) int64 {
	if v <= 0 || pct == 0 {
		return v
	}
	return max(0, fixed.PercentFloor(v, fixed.Hundredths-pct))
}

func decayMap(m map[string]int64, pct int64) {
	for _, k := range slices.Sorted(maps.Keys(m)) {
		if m[k] = decay(m[k], pct); m[k] == 0 {
			delete(m, k)
		}
	}
}

// Decay runs a world day's forgetting over the counters and drops
// expired rumours. Tracks are left alone: Visit caps them.
func (s *State) Decay(p Params, tick int64) {
	s.Visits = decay(s.Visits, p.decay[CounterVisits])
	for d := range s.Passage {
		s.Passage[d] = decay(s.Passage[d], p.decay[CounterPassage])
	}
	decayMap(s.BattlesWon, p.decay[CounterBattlesWon])
	s.BattlesLost = decay(s.BattlesLost, p.decay[CounterBattlesLost])
	decayMap(s.Gathered, p.decay[CounterGathered])
	s.Rumours = slices.DeleteFunc(s.Rumours, func(r Rumour) bool { return r.Expires <= tick })
}

// Visit records an arrival by someone; a quiet one lays no track.
func (s *State) Visit(p Params, who fact.Ref, tick int64, quiet bool) {
	s.Visits++
	s.bump(CounterVisits, 1)
	if quiet {
		return
	}
	s.Tracks = append(s.Tracks, Track{Who: who, Tick: tick})
	if over := int64(len(s.Tracks)) - p.TracksKept; over > 0 {
		s.Tracks = s.Tracks[over:]
	}
}

// Leave records a crossing out of the tile in direction d.
func (s *State) Leave(d int) {
	s.Passage[d]++
	s.bump(CounterPassage, 1)
}

// Remember adds a heavy fact to the tile's event ring.
func (s *State) Remember(p Params, f fact.Fact) {
	if f.Weight < p.HeavyFact {
		return
	}
	s.Events = append(s.Events, f.ID)
	if over := int64(len(s.Events)) - p.EventRing; over > 0 {
		s.Events = s.Events[over:]
	}
}

// WonBeat records a beat won here against a creature carrying tag.
func (s *State) WonBeat(tag string) {
	if s.BattlesWon == nil {
		s.BattlesWon = map[string]int64{}
	}
	s.BattlesWon[tag]++
	s.bump(CounterBattlesWon, 1)
}

// Slay records one of a species slain here.
func (s *State) Slay(species string) {
	if s.Slain == nil {
		s.Slain = map[string]int64{}
	}
	s.Slain[species]++
}

// Gather records units of a material taken here.
func (s *State) Gather(material string, units int64) {
	if s.Gathered == nil {
		s.Gathered = map[string]int64{}
	}
	s.Gathered[material] += units
	s.bump(CounterGathered, units)
}

func (s *State) bump(counter string, by int64) {
	if s.Season == nil {
		s.Season = map[string]int64{}
	}
	s.Season[counter] += by
}

// NewSeason clears what is kept per season.
func (s *State) NewSeason() {
	s.Slain, s.Season = nil, nil
}

// Tidy drops maps left empty, so a tile reads the same before and after
// a snapshot round trip.
func (s *State) Tidy() {
	for _, m := range []*map[string]int64{&s.BattlesWon, &s.Population, &s.Slain, &s.Stock, &s.Gathered, &s.Season} {
		if len(*m) == 0 {
			*m = nil
		}
	}
}

// Empty reports whether nothing differs from the baseline, so the tile
// need not be stored.
func (s *State) Empty() bool {
	return s.Discovered == nil && s.Visits == 0 && s.Passage == [hex.Directions]int64{} &&
		len(s.BattlesWon) == 0 && s.BattlesLost == 0 && len(s.Population) == 0 &&
		len(s.Slain) == 0 && len(s.Residents) == 0 && len(s.Stock) == 0 && len(s.Gathered) == 0 &&
		s.Corruption == 0 && s.Fire == (Fire{}) && len(s.WeatherTags) == 0 && s.Road == 0 &&
		len(s.Structures) == 0 && s.Owner == nil && len(s.Tracks) == 0 &&
		len(s.Graves) == 0 && len(s.Events) == 0 && len(s.Rumours) == 0 && len(s.Goals) == 0 &&
		s.Dungeon == nil && len(s.Season) == 0
}
