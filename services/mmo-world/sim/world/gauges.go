package world

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

// gauges runs a world day's gauges (GDD 4.3): the daily rise, the keyed
// wobble, spill from neighbours over a line, faction patrols, a
// settlement's watch, an overrun spending itself, unrest under raids,
// scarcity under weather that brings it, and the pull back to baseline.
// Crossing a line records a fact.
func (d *day) gauges() {
	s := d.s
	threat, unrest, scarcity := s.GaugeIndex("threat"), s.GaugeIndex("unrest"), s.GaugeIndex("scarcity")
	before := make([][]int64, len(s.Regions))
	for i, r := range s.Regions {
		before[i] = slices.Clone(r.Gauge)
	}
	raid, overrun := lineIndex(s.b, "raid"), lineIndex(s.b, "overrun")
	for i := range s.Regions {
		r := &s.Regions[i]
		for gi, g := range s.b.Gauges {
			// Falls stop at the baseline; rises do not.
			rise, fall := max(g.DailyRise, 0), max(-g.DailyRise, 0)
			var spill int64
			for _, l := range s.b.GaugeLines {
				if l.Gauge != g.ID || (l.Effect != "neighbour-pressure" && l.Effect != "spread") {
					continue
				}
				for _, n := range r.Neighbours {
					if over := before[n][gi] - l.AtLeast; over > 0 {
						spill += l.Magnitude * over / max(1, g.Max-l.AtLeast)
					}
				}
			}
			rise += min(spill, s.wp("spill-cap"))
			switch gi {
			case threat:
				if r.Patrolled {
					fall -= s.wp("patrol-threat")
				}
				if r.Settlement {
					fall -= s.wp("settlement-watch")
				}
				if r.Active[overrun] {
					fall -= s.wp("overrun-ebb")
				}
			case unrest:
				if r.Active[raid] {
					rise += s.wp("raid-unrest")
				}
			case scarcity:
				for k, w := range s.b.Weather {
					rise += fixed.PercentOf(w.Scarcity, r.Weather[k])
				}
			}
			v := r.Gauge[gi] + rise
			v = max(v-fall, min(v, r.Base[gi]))
			v += d.wobble(r, gi, g.Wobble)
			v -= fixed.PercentOf(v-r.Base[gi], g.PullPercent)
			r.Gauge[gi] = min(max(v, 0), g.Max)
		}
		if r.Settlement {
			r.Defence = min(s.wp("settlement-defence"), r.Defence+s.wp("watch-repair"))
		}
		r.Patrolled = false
		if r.Gauge[threat] < LineAt(s.b, "ambush") {
			r.SurgeFact = 0
		}
	}
	for i := range s.Regions {
		d.lines(i)
	}
}

// addGauge moves one region's gauge, held to [0, the gauge's max].
func (s *State) addGauge(r, gi int, by int64) {
	g := &s.Regions[r].Gauge[gi]
	*g = min(max(*g+by, 0), s.b.Gauges[gi].Max)
}

// wobble is the day's keyed move of one gauge in one region: up to w
// either way.
func (d *day) wobble(r *Region, gauge int, w int64) int64 {
	if w == 0 {
		return 0
	}
	return int64(d.s.d.Below(uint64(w+w+1), "world.wobble", draw.Int(d.s.Day), draw.Int(r.Lattice.I), draw.Int(r.Lattice.J), draw.Int(int64(gauge)))) - w
}

// surge: on some days something comes out of the wild (a pack moving, a
// machine waking), raising threat in one region and its neighbours. It
// can come from a dormant region just past the horizon, which stays
// dormant and spills into its awake neighbours: a threat from off the
// map. The surge is a fact, and the lines it pushes regions over name it.
func (d *day) surge() {
	s := d.s
	if !s.d.Roll(sheets.ParamOf(s.b.WorldParams, "surge-chance"), "world.surge", draw.Int(s.Day)) {
		return
	}
	lo, hi := s.wp("surge-min"), s.wp("surge-max")
	size := s.d.Between(lo, hi, "world.surge.size", draw.Int(s.Day))
	threat := s.GaugeIndex("threat")
	share := s.wp("surge-neighbour-share")
	raise := func(j int, by int64, id fact.ID) {
		s.addGauge(j, threat, by)
		s.Regions[j].SurgeFact = id
	}
	if len(s.Dormant) > 0 && s.d.Percent(s.wp("surge-beyond-share"), "world.surge.beyond", draw.Int(s.Day)) {
		from := s.Dormant[s.d.Below(uint64(len(s.Dormant)), "world.surge.where", draw.Int(s.Day))]
		var hit []int
		for _, n := range s.g.RegionNeighbours(from) {
			if j := s.RegionIndex(n); j >= 0 {
				hit = append(hit, j)
			}
		}
		id := d.emit("region.surge", latticeRef(from), nil, nil, fact.N("threat", size), fact.N("beyond", 1))
		for _, j := range hit {
			raise(j, fixed.PercentFloor(size, share), id)
		}
		return
	}
	at := int(s.d.Below(uint64(len(s.Regions)), "world.surge.where", draw.Int(s.Day)))
	s.addGauge(at, threat, size)
	id := d.emit("region.surge", RegionRef(at), nil, nil, fact.N("threat", size))
	s.Regions[at].SurgeFact = id
	for _, n := range s.Regions[at].Neighbours {
		raise(n, fixed.PercentFloor(size, share), id)
	}
}

// lines writes a fact when a region crosses a line, and when an overrun
// lifts; a raid line holding hurts what stands there.
func (d *day) lines(i int) {
	s := d.s
	r := &s.Regions[i]
	for li, l := range s.b.GaugeLines {
		v := r.Gauge[s.GaugeIndex(l.Gauge)]
		clears := l.AtLeast
		if l.ClearsAt > 0 {
			clears = l.ClearsAt
		}
		switch {
		case !r.Active[li] && v >= l.AtLeast:
			r.Active[li] = true
			if l.FactKind != "" {
				var causes []fact.ID
				if r.SurgeFact != 0 && l.Gauge == "threat" {
					causes = append(causes, r.SurgeFact)
				}
				id := d.emit(d.kindOf(l.FactKind), RegionRef(i), nil, causes, fact.N(l.Gauge, v), fact.S("line", l.ID))
				if l.Effect == "raid" {
					r.RaidFact = id
				}
			}
		case r.Active[li] && v < clears:
			r.Active[li] = false
			if l.Effect == "overrun" {
				d.emit("region.overrun-ended", RegionRef(i), nil, nil, fact.N(l.Gauge, v))
			}
		}
		if r.Active[li] && l.Effect == "raid" && (r.Holder != none || r.Settlement) {
			d.hit(i, s.p("raid-damage"), "region.raids", none, r.RaidFact)
		}
	}
}

func (d *day) kindOf(sheetID string) string {
	if fw, ok := d.s.factRows[sheetID]; ok {
		return fw.Kind
	}
	return sheetID
}
