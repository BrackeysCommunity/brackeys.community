// Package weather runs weather as systems that form, roll across the map
// tile by tile, change as they meet and die out (GDD 4.4). Everything is
// a function of the roll key, the tick and the ground, so a forecast is
// the same run carried forward.
package weather

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// structural: percentages are hundredths; a world day is 144 ticks.
const (
	percent     = 100
	ticksPerDay = 144
)

// System is one weather system.
type System struct {
	ID       int64   `json:"id"`
	Kind     string  `json:"kind"`
	Centre   hex.Hex `json:"centre"`
	Heading  int     `json:"heading"`
	Strength int64   `json:"strength"`
	Life     int64   `json:"life"` // ticks left
	Wait     int64   `json:"wait"` // ticks until it next moves
	Met      []int64 `json:"met,omitempty"`
}

// Sky is every live system.
type Sky struct {
	Systems []System `json:"systems"`
	NextID  int64    `json:"nextId"`
}

// Ground is what weather reads of the map.
type Ground interface {
	Terrain(h hex.Hex) string
	Elevation(h hex.Hex) int64
}

// Cell is a spine cell inside the horizon: where systems may form.
type Cell struct {
	I, J    int64
	Centre  hex.Hex
	Terrain string // the majority terrain of its regions
	Low     bool
}

// Event is something weather did worth a fact.
type Event struct {
	Kind   string // formed, died, left, ended
	System System
	Other  int64 // for left and ended: the system met
}

const (
	EventFormed = "formed"
	EventDied   = "died"
	EventLeft   = "left"
	EventEnded  = "ended"
)

// Rules are the weather sheets, indexed.
type Rules struct {
	kinds    map[string]*sheets.WeatherKind
	terrain  map[string]*sheets.Terrain
	forms    []sheets.WeatherForm
	meetings []sheets.WeatherMeeting
	seasons  []sheets.Season
	order    []string

	perRegions, strLo, strHi, cap, radiusPer, paceBase, pacePer int64
	lifeLo, lifeHi, weak, turn, forecast, seasonDays            int64
	formChance                                                  fixed.F
}

func NewRules(b *sheets.Book) *Rules {
	p := func(id string) int64 { return sheets.IntParam(b.WorldParams, id) }
	r := &Rules{
		kinds: sheets.Lookup(b.Weather), terrain: sheets.Lookup(b.Terrain),
		forms: b.WeatherForm, meetings: b.Meetings, seasons: b.Seasons,
		perRegions: p("weather-regions-per-system"), strLo: p("weather-strength-min"), strHi: p("weather-strength-max"),
		cap: p("weather-strength-cap"), radiusPer: p("weather-radius-per"), paceBase: p("weather-pace-base"),
		pacePer: p("weather-pace-per"), lifeLo: p("weather-life-min"), lifeHi: p("weather-life-max"),
		weak: p("weather-weak"), turn: p("weather-turn"), forecast: p("weather-forecast-ticks"), seasonDays: p("season-days"),
	}
	for _, w := range b.Weather {
		r.order = append(r.order, w.ID)
	}
	r.formChance = sheets.ParamOf(b.WorldParams, "weather-form-chance")
	return r
}

// Kind is a weather kind's row.
func (r *Rules) Kind(id string) *sheets.WeatherKind { return r.kinds[id] }

// Season is the season a world day falls in, from day 1.
func (r *Rules) Season(day int64) string {
	n := (max(day, 1) - 1) / r.seasonDays
	return r.seasons[n%int64(len(r.seasons))].ID
}

// SeasonIndex counts seasons from the first.
func (r *Rules) SeasonIndex(day int64) int64 { return (max(day, 1) - 1) / r.seasonDays }

// Wind is the prevailing heading of a season, keyed.
func (r *Rules) Wind(d *draw.Drawer, season int64) int {
	return int(d.Below(uint64(hex.Directions), "weather.wind", draw.Int(season)))
}

// Radius is a system's footprint radius.
func (r *Rules) Radius(s System) int64 { return 1 + s.Strength/r.radiusPer }

// Covers reports whether h lies under s.
func (r *Rules) Covers(s System, h hex.Hex) bool { return hex.Distance(s.Centre, h) <= r.Radius(s) }

// pace is how many ticks a system takes to cross a tile of terrain t.
func (r *Rules) pace(s System, t string) int64 {
	base := max(1, r.paceBase-s.Strength/r.pacePer)
	return max(1, base*r.terrain[t].WeatherPace/percent)
}

// At is the strongest system over h, if any; ties go to the lower id.
func (s *Sky) At(r *Rules, h hex.Hex) (System, bool) {
	best, found := System{}, false
	for _, sys := range s.Systems {
		if r.Covers(sys, h) && (!found || sys.Strength > best.Strength) {
			best, found = sys, true
		}
	}
	return best, found
}

// Tick moves every system one tick: it steps when its wait runs out,
// steering round high ground; strength changes with what it crosses;
// systems that meet change each other; spent ones die.
func (s *Sky) Tick(r *Rules, g Ground) []Event {
	var events []Event
	for i := range s.Systems {
		sys := &s.Systems[i]
		sys.Life--
		sys.Wait--
		if sys.Wait > 0 {
			continue
		}
		next, ok := r.steer(*sys, g)
		if !ok {
			sys.Strength -= r.kinds[sys.Kind].BlockedLoss
			sys.Wait = r.pace(*sys, g.Terrain(sys.Centre))
			continue
		}
		sys.Heading = sys.Centre.DirectionTo(next)
		sys.Centre = next
		t := g.Terrain(next)
		sys.Strength = min(r.cap, sys.Strength+r.terrain[t].WeatherGain)
		sys.Wait = r.pace(*sys, t)
	}
	events = append(events, s.meet(r)...)
	kept := s.Systems[:0]
	for _, sys := range s.Systems {
		if sys.Life <= 0 || sys.Strength <= 0 {
			events = append(events, Event{Kind: EventDied, System: sys})
			continue
		}
		kept = append(kept, sys)
	}
	s.Systems = kept
	return events
}

// steer is where a system's centre goes next: ahead, or failing that the
// side of the two beside ahead with lower ground; high ground blocks.
func (r *Rules) steer(sys System, g Ground) (hex.Hex, bool) {
	ok := func(h hex.Hex) bool { return !r.terrain[g.Terrain(h)].WeatherBlock }
	ahead := sys.Centre.Neighbour(sys.Heading)
	if ok(ahead) {
		return ahead, true
	}
	left := sys.Centre.Neighbour((sys.Heading + 1) % hex.Directions)
	right := sys.Centre.Neighbour((sys.Heading + hex.Directions - 1) % hex.Directions)
	switch {
	case ok(left) && ok(right):
		if g.Elevation(right) < g.Elevation(left) {
			return right, true
		}
		return left, true
	case ok(left):
		return left, true
	case ok(right):
		return right, true
	}
	return hex.Hex{}, false
}

// meet applies weather-meetings to every pair of systems whose
// footprints touch, once per pair.
func (s *Sky) meet(r *Rules) []Event {
	var events []Event
	var born []System
	for i := range s.Systems {
		for j := range s.Systems {
			a, b := &s.Systems[i], &s.Systems[j]
			if i == j || slices.Contains(a.Met, b.ID) || a.Life <= 0 || b.Life <= 0 {
				continue
			}
			if hex.Distance(a.Centre, b.Centre) > r.Radius(*a)+r.Radius(*b) {
				continue
			}
			for _, m := range r.meetings {
				if m.Kind != a.Kind || m.Meets != b.Kind {
					continue
				}
				a.Met = append(a.Met, b.ID)
				switch m.Effect {
				case "leave":
					at := hex.Line(a.Centre, b.Centre)
					n := System{
						ID: s.NextID, Kind: m.Leaves, Centre: at[len(at)/halves], Heading: a.Heading,
						Strength: max(1, a.Strength*m.Strength/percent), Life: b.Life, Wait: max(1, a.Wait),
						Met: []int64{a.ID, b.ID},
					}
					s.NextID++
					a.Met = append(a.Met, n.ID)
					b.Met = append(b.Met, n.ID)
					born = append(born, n)
					events = append(events, Event{Kind: EventLeft, System: n, Other: b.ID})
				case "end":
					b.Life = 0
					events = append(events, Event{Kind: EventEnded, System: *b, Other: a.ID})
				}
			}
		}
	}
	s.Systems = append(s.Systems, born...)
	return events
}

// Day runs a world day's weather: systems turn toward the wind, weak
// ones lose a day of life, and new ones form in the cells, up to the cap
// the horizon's regions allow.
func (s *Sky) Day(r *Rules, d *draw.Drawer, g Ground, day int64, cells []Cell, regions int) []Event {
	wind := r.Wind(d, r.SeasonIndex(day))
	season := r.Season(day)
	for i := range s.Systems {
		sys := &s.Systems[i]
		sys.Heading = turnToward(sys.Heading, wind, int(r.turn))
		if sys.Strength < r.weak {
			sys.Life -= ticksPerDay
		}
	}
	var events []Event
	limit := int64(regions) / r.perRegions
	for _, c := range cells {
		if int64(len(s.Systems)) >= limit {
			break
		}
		who := []draw.Part{draw.Int(day), draw.Int(c.I), draw.Int(c.J)}
		if !d.Roll(r.formChance, "weather.form", who...) {
			continue
		}
		weights := make([]int64, len(r.order))
		for k, kind := range r.order {
			weights[k] = r.weightOf(kind, c, season)
		}
		if slices.Max(weights) == 0 {
			continue
		}
		kind := r.order[d.Pick(weights, "weather.kind", who...)]
		sys := System{
			ID: s.NextID, Kind: kind, Centre: c.Centre, Heading: wind,
			Strength: r.strLo + int64(d.Below(uint64(r.strHi-r.strLo+1), "weather.strength", who...)),
			Life:     (r.lifeLo + int64(d.Below(uint64(r.lifeHi-r.lifeLo+1), "weather.life", who...))) * ticksPerDay,
		}
		sys.Wait = r.pace(sys, g.Terrain(c.Centre))
		s.NextID++
		s.Systems = append(s.Systems, sys)
		events = append(events, Event{Kind: EventFormed, System: sys})
	}
	return events
}

// weightOf is a kind's first matching row's weight in a cell, or 0.
func (r *Rules) weightOf(kind string, c Cell, season string) int64 {
	for _, f := range r.forms {
		if f.Kind != kind {
			continue
		}
		if len(f.Terrains) > 0 && !slices.Contains(f.Terrains, c.Terrain) {
			continue
		}
		if f.Season != "" && f.Season != season {
			continue
		}
		if f.Low && !c.Low {
			continue
		}
		return f.Weight
	}
	return 0
}

// turnToward turns a heading at most steps toward want, the short way.
func turnToward(h, want, steps int) int {
	for range steps {
		if h == want {
			break
		}
		left := (want - h + hex.Directions) % hex.Directions
		if left <= hex.Directions/halves {
			h = (h + 1) % hex.Directions
		} else {
			h = (h + hex.Directions - 1) % hex.Directions
		}
	}
	return h
}

// structural: half of the six headings.
const halves = 2

// Clone copies the sky, so a forecast can run it forward.
func (s *Sky) Clone() *Sky {
	c := &Sky{NextID: s.NextID, Systems: make([]System, len(s.Systems))}
	for i, sys := range s.Systems {
		sys.Met = slices.Clone(sys.Met)
		c.Systems[i] = sys
	}
	return c
}

// Forecast is where every system will be after each of the next ticks;
// the first weather-forecast-ticks are exact, and later ones are shown
// as a widening cone by the reader.
func (s *Sky) Forecast(r *Rules, g Ground, ticks int64) [][]System {
	c := s.Clone()
	out := make([][]System, 0, ticks)
	for range ticks {
		c.Tick(r, g)
		out = append(out, slices.Clone(c.Systems))
	}
	return out
}

// Exact is how many ticks ahead the forecast is exact.
func (r *Rules) Exact() int64 { return r.forecast }

// Effects is what a kind of weather does on a tile under a system of
// the given strength: tags for the tile and its creatures, ticks added to
// entering, and the sight it leaves (or 0 to leave sight alone).
type Effects struct {
	TileTags, CreatureTags []string
	EnterTicks, CrossTicks int64
	Sight, HighSight       int64
}

func (r *Rules) Effects(kind string, strength int64) Effects {
	k := r.kinds[kind]
	e := Effects{TileTags: append([]string{k.Tag}, k.TileTags...), CreatureTags: k.CreatureTags, CrossTicks: k.CrossTicks, Sight: k.Sight, HighSight: k.HighSight}
	if k.EnterTicks > 0 && strength >= k.EnterAt {
		e.EnterTicks = k.EnterTicks
	}
	return e
}
