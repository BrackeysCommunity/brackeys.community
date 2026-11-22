package world

import (
	"fmt"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

// Action is something a player (or the harness acting as one) does to the
// world. Actions are applied at the start of the tick they are given for,
// in order, so a recorded list replays to the same world.
type Action struct {
	Kind     string   `json:"kind"`
	Hex      hex.Hex  `json:"hex"`
	By       fact.Ref `json:"by"`
	Material string   `json:"material,omitempty"`
	Species  string   `json:"species,omitempty"`
	Tag      string   `json:"tag,omitempty"`
	Units    int64    `json:"units,omitempty"`
	Dir      *int     `json:"dir,omitempty"` // nil: no direction
	// Quiet is a visit that lays no track.
	Quiet bool `json:"quiet,omitempty"`
	// Floor is a dungeon floor, from 1; Way the way taken down from it,
	// +1 (0: none).
	Floor int64 `json:"floor,omitempty"`
	Way   int64 `json:"way,omitempty"`
	// Cause is the fact a story action follows from, which the fact it
	// writes names.
	Cause fact.ID `json:"cause,omitempty"`
}

// Action kinds.
const (
	ActOpenSettlement = "open-settlement"
	ActDiscover       = "discover"
	ActVisit          = "visit"       // arrive on Hex, having left the tile behind in direction Dir
	ActGather         = "gather"      // Units of Material taken on Hex
	ActWinBeat        = "win-beat"    // a beat won on Hex against a creature carrying Tag
	ActSlay           = "slay"        // one of Species slain on Hex
	ActFall           = "fall"        // a character went down on Hex
	ActClearFloor     = "clear-floor" // floor Units of the dungeon on Hex cleared; kept for recorded actions
	ActEase           = "ease"        // Units of threat taken off the region holding Hex
	ActAlarm          = "alarm"       // Units of threat a machine's alarm adds to the region holding Hex
)

// actions is every action kind: what it needs to be applied, checked
// before anything changes, and what it does.
var actions = map[string]struct {
	check func(*State, Action) error
	apply func(*State, fact.Log, Action) error
}{
	ActOpenSettlement: {nil, func(s *State, _ fact.Log, _ Action) error {
		s.OpenSettlement()
		return nil
	}},
	ActDiscover: {needsBy, func(s *State, log fact.Log, a Action) error { return s.Discover(log, a.Hex, a.By) }},
	ActVisit: {needsBy, func(s *State, log fact.Log, a Action) error {
		t := s.touch(a.Hex)
		t.Visit(s.tp, a.By, s.Tick, a.Quiet)
		if a.Dir != nil && *a.Dir >= 0 && *a.Dir < hex.Directions {
			back := (*a.Dir + hex.Directions/halves) % hex.Directions
			s.touch(a.Hex.Neighbour(back)).Leave(*a.Dir)
		}
		return s.Discover(log, a.Hex, a.By)
	}},
	ActGather: {func(_ *State, a Action) error {
		if a.Material == "" || a.Units <= 0 {
			return fmt.Errorf("world: gather of %d %q", a.Units, a.Material)
		}
		return nil
	}, func(s *State, _ fact.Log, a Action) error {
		s.touch(a.Hex).Gather(a.Material, a.Units)
		if r := s.RegionAt(a.Hex); r >= 0 {
			s.addGauge(r, s.GaugeIndex("scarcity"), a.Units*s.wp("gather-scarcity"))
		}
		return nil
	}},
	ActWinBeat: {nil, func(s *State, _ fact.Log, a Action) error {
		s.touch(a.Hex).WonBeat(a.Tag)
		if r := s.RegionAt(a.Hex); r >= 0 {
			s.addGauge(r, s.GaugeIndex("threat"), s.wp("beat-won-threat"))
		}
		return nil
	}},
	ActSlay: {func(s *State, a Action) error {
		if s.creature(a.Species) == nil {
			return fmt.Errorf("world: slay of unknown species %q", a.Species)
		}
		return nil
	}, func(s *State, _ fact.Log, a Action) error {
		s.slay(a.Hex, a.Species)
		return nil
	}},
	ActEase: {func(_ *State, a Action) error {
		if a.Units <= 0 {
			return fmt.Errorf("world: ease of %d threat", a.Units)
		}
		return nil
	}, func(s *State, _ fact.Log, a Action) error {
		if r := s.RegionAt(a.Hex); r >= 0 {
			s.addGauge(r, s.GaugeIndex("threat"), -a.Units)
		}
		return nil
	}},
	ActAlarm: {func(_ *State, a Action) error {
		if a.Units <= 0 {
			return fmt.Errorf("world: alarm of %d threat", a.Units)
		}
		return nil
	}, func(s *State, _ fact.Log, a Action) error {
		if r := s.RegionAt(a.Hex); r >= 0 {
			s.addGauge(r, s.GaugeIndex("threat"), a.Units)
		}
		return nil
	}},
	ActFall: {nil, func(s *State, _ fact.Log, a Action) error {
		s.touch(a.Hex).BattlesLost++
		return nil
	}},
	ActClearFloor: {func(_ *State, a Action) error {
		if a.Units <= 0 {
			return fmt.Errorf("world: clear of floor %d", a.Units)
		}
		return nil
	}, func(s *State, log fact.Log, a Action) error {
		return floorCleared(s, log, Action{Kind: ActFloorCleared, Hex: a.Hex, By: a.By, Floor: a.Units})
	}},
}

func needsBy(_ *State, a Action) error {
	if a.By.ID == "" {
		return fmt.Errorf("world: %s with no one doing it", a.Kind)
	}
	return nil
}

// Advance runs the world to tick, which must be the next one: the
// actions, then every clock that falls due (GDD 4.7). It changes the
// state in place and returns it with the facts written. An error after
// the actions' checks leaves the state part-way; the caller restores
// from a snapshot.
func Advance(s *State, log fact.Log, acts []Action, tick int64) (*State, []fact.Fact, error) {
	if tick != s.Tick+1 {
		return s, nil, fmt.Errorf("world: advance to tick %d from %d", tick, s.Tick)
	}
	for _, a := range acts {
		act, ok := actions[a.Kind]
		if !ok {
			return s, nil, fmt.Errorf("world: unknown action %q", a.Kind)
		}
		if act.check != nil {
			if err := act.check(s, a); err != nil {
				return s, nil, err
			}
		}
	}
	first := fact.ID(log.Len())
	s.edited = nil
	s.Tick = tick
	s.arriving = &arrivals{regions: map[int]bool{}, factions: map[int]bool{}}
	defer func() { s.arriving = nil }()
	for _, a := range acts {
		if err := actions[a.Kind].apply(s, log, a); err != nil {
			return s, nil, err
		}
	}
	d := &day{s: s, log: log}
	d.ticked()
	if tick%ticksPerDay == 0 {
		d.daily()
	}
	if d.err != nil {
		return s, nil, d.err
	}
	fs := log.Since(first)
	s.Note(fs...)
	return s, fs, nil
}

// AdvanceDay runs the world through to the end of the next world day,
// with no actions.
func (s *State) AdvanceDay(log fact.Log) error { return s.AdvanceDayWith(log, nil) }

// AdvanceDayWith is AdvanceDay with actions on its first tick.
func (s *State) AdvanceDayWith(log fact.Log, first []Action) error {
	for i := range ticksPerDay {
		var acts []Action
		if i == 0 {
			acts = first
		}
		if _, _, err := Advance(s, log, acts, s.Tick+1); err != nil {
			return err
		}
	}
	return nil
}

// day is one clock's run: where its facts go, and the first error.
type day struct {
	s   *State
	log fact.Log
	err error
}

// emit writes a fact. With no log (a world being founded) nothing is
// written.
func (d *day) emit(kind, region string, subjects []fact.Ref, causes []fact.ID, data ...fact.Datum) fact.ID {
	if d.err != nil || d.log == nil {
		return 0
	}
	f, err := d.s.weights.New(d.s.Tick, kind, region, subjects, causes, data...)
	if err != nil {
		d.err = err
		return 0
	}
	id, err := d.log.Append(f)
	if err != nil {
		d.err = err
		return 0
	}
	f.ID = id
	d.remember(f)
	return id
}

// remember puts a heavy fact on the event ring of the tile it is about:
// a region's centre stands for the region.
func (d *day) remember(f fact.Fact) {
	if f.Weight < d.s.tp.HeavyFact {
		return
	}
	r, ok := ParseRegionRef(f.Region)
	if !ok || r < 0 || r >= len(d.s.Regions) {
		return
	}
	d.s.touch(d.s.centre(r)).Remember(d.s.tp, f)
}

// ticked runs the every-tick clock: weather systems move.
func (d *day) ticked() {
	d.weatherTick()
}

// daily runs the world-day clock, and the week's and season's when they
// fall due.
func (d *day) daily() {
	s := d.s
	s.Day++
	d.open()
	for i := range s.Factions {
		for j, g := range s.Factions[i].Grudge {
			s.Factions[i].Grudge[j] = max(0, g-1)
		}
	}
	d.weatherShares()
	d.surge()
	d.gauges()
	for i := range s.Factions {
		if !s.Factions[i].Fallen {
			d.faction(i)
		}
	}
	d.weatherDay()
	d.creatures()
	for _, t := range s.Tiles {
		t.Decay(s.tp, s.Tick)
	}
	if s.Day%s.wp("week-days") == 0 {
		d.week()
	}
	if s.Day%s.wp("season-days") == 0 {
		d.season()
	}
	s.prune()
	s.pruneHistory()
	s.prunePins(s.Tick)
}

// open opens the settlements asked for. The regions a new settlement
// brings nearer re-tier, its region is discovered, and a fact records the
// land round it growing calmer.
func (d *day) open() {
	s := d.s
	for ; s.Opening > 0; s.Opening-- {
		home := s.g.Settlement(s.Opened)
		s.Opened++
		if err := s.discoverRegion(d.log, s.g.RegionOf(home.Hex)); err != nil {
			d.err = err
			return
		}
		s.furnish(home.Hex)
		r := s.RegionAt(home.Hex)
		if s.Regions[r].Holder == none && !s.Regions[r].Settlement {
			s.Regions[r].Settlement = true
			s.Regions[r].Defence = s.wp("settlement-defence")
		}
		calmer := int64(0)
		for i := range s.Regions {
			if t := s.g.TierAt(s.centre(i), s.Opened); t < s.Regions[i].Tier {
				s.Regions[i].Tier = t
				calmer++
			}
		}
		d.emit("land.calmer", RegionRef(r), nil, nil, fact.N("settlement", int64(home.N)), fact.N("regions", calmer))
	}
}

// week writes the ledger report: a fact with the world's counts.
func (d *day) week() {
	s := d.s
	living := 0
	for _, f := range s.Factions {
		if !f.Fallen {
			living++
		}
	}
	d.emit("world.week", "", nil, nil, fact.N("day", s.Day), fact.N("regions", int64(len(s.Regions))),
		fact.N("factions", int64(living)), fact.N("tiles", int64(len(s.Tiles))), fact.N("systems", int64(len(s.Sky.Systems))))
}

// season turns the season: per-season tallies clear, and the wind turns
// with the next season's draw.
func (d *day) season() {
	s := d.s
	for _, t := range s.Tiles {
		t.NewSeason()
	}
	d.emit("season.turned", "", nil, nil, fact.S("season", s.sky.Season(s.Day+1)), fact.N("wind", int64(s.sky.Wind(s.d, s.sky.SeasonIndex(s.Day+1)))))
}
