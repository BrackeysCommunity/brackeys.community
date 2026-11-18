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
	Dir      int      `json:"dir,omitempty"`
}

// Action kinds.
const (
	ActOpenSettlement = "open-settlement"
	ActDiscover       = "discover"
	ActVisit          = "visit"    // arrive on Hex, having left the tile behind in direction Dir
	ActGather         = "gather"   // Units of Material taken on Hex
	ActWinBeat        = "win-beat" // a beat won on Hex against a creature carrying Tag
	ActSlay           = "slay"     // one of Species slain on Hex
	ActFall           = "fall"     // a character went down on Hex
)

// Advance runs the world to tick, which must be the next one: the
// actions first, then every clock that falls due (GDD 4.7). It returns
// the facts it wrote. The state is changed in place and returned.
func Advance(s *State, log fact.Log, actions []Action, tick int64) (*State, []fact.Fact, error) {
	if tick != s.Tick+1 {
		return s, nil, fmt.Errorf("world: advance to tick %d from %d", tick, s.Tick)
	}
	first := fact.ID(log.Len())
	s.Tick = tick
	for _, a := range actions {
		if err := s.apply(log, a); err != nil {
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
	return s, log.Since(first), nil
}

// AdvanceDay runs the world through to the end of the next world day,
// with no actions.
func (s *State) AdvanceDay(log fact.Log) error {
	for range ticksPerDay {
		if _, _, err := Advance(s, log, nil, s.Tick+1); err != nil {
			return err
		}
	}
	return nil
}

func (s *State) apply(log fact.Log, a Action) error {
	switch a.Kind {
	case ActOpenSettlement:
		s.OpenSettlement()
	case ActDiscover:
		return s.Discover(log, a.Hex, a.By)
	case ActVisit:
		t := s.touch(a.Hex)
		t.Visit(s.tp, a.By, s.Tick)
		if a.Dir >= 0 && a.Dir < hex.Directions {
			back := (a.Dir + hex.Directions/halves) % hex.Directions
			s.touch(a.Hex.Neighbour(back)).Leave(a.Dir)
		}
		return s.Discover(log, a.Hex, a.By)
	case ActGather:
		s.touch(a.Hex).Gather(a.Material, a.Units)
		if r := s.RegionAt(a.Hex); r >= 0 {
			sc := s.gaugeIndex("scarcity")
			s.Regions[r].Gauge[sc] = min(s.b.Gauges[sc].Max, s.Regions[r].Gauge[sc]+a.Units*s.wp("gather-scarcity"))
		}
	case ActWinBeat:
		s.touch(a.Hex).WonBeat(a.Tag)
		if r := s.RegionAt(a.Hex); r >= 0 {
			th := s.gaugeIndex("threat")
			s.Regions[r].Gauge[th] = max(0, s.Regions[r].Gauge[th]+s.wp("beat-won-threat"))
		}
	case ActSlay:
		s.slay(a.Hex, a.Species)
	case ActFall:
		t := s.touch(a.Hex)
		t.BattlesLost++
	default:
		return fmt.Errorf("world: unknown action %q", a.Kind)
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
	w, ok := d.s.weights[kind]
	if !ok {
		d.err = fmt.Errorf("world: no weight for fact kind %s", kind)
		return 0
	}
	f := fact.Fact{Tick: d.s.Tick, Kind: kind, Region: region, Subjects: subjects, Causes: causes, Data: data, Weight: w}
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
	var r int
	if _, err := fmt.Sscanf(f.Region, "r-%d", &r); err != nil || r < 0 || r >= len(d.s.Regions) {
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
		d.emit("land.calmer", regionRef(r), nil, nil, fact.N("settlement", int64(home.N)), fact.N("regions", calmer))
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
