package arc

import (
	"slices"

	"jams.team/mmo-world/sim/fact"
)

func init() {
	Predicates["raid-near"] = raidNear
	Predicates["fire-risk"] = fireRisk
	Predicates["corruption-next-door"] = corruptionNextDoor
	Predicates["scarcity-high"] = scarcityHigh
	Predicates["wet-and-scarce"] = wetAndScarce
	Predicates["faction-collapsing"] = factionCollapsing
	Predicates["prospers-road"] = prospersRoad
	Predicates["season-turn"] = seasonTurn
	Predicates["scarcity-low"] = scarcityLow
}

// Roles a trouble or an occasion binds beside its place.
const (
	rolePlace   = "place"
	roleSource  = "source"
	roleFaction = "faction"
)

// atPlace starts a settlement candidate at pl, seated on its tile.
func atPlace(pl PlaceView, regions []int, pressure int64, causes []fact.ID, cast ...Binding) Candidate {
	cast = append(cast, bind(rolePlace, SettlementRef(pl.N)))
	return Candidate{Cast: cast, Regions: regions, Seat: pl.Hex, Causes: causes, Pressure: pressure, Place: pl.N}
}

// eachPlace runs f over every standing place and keeps what it finds,
// not busy, in casting order.
func eachPlace(w World, row Row, f func(PlaceView) (Candidate, bool)) []Candidate {
	var out []Candidate
	for _, pl := range w.Places() {
		if !standing(pl) {
			continue
		}
		if c, ok := f(pl); ok {
			out = append(out, c)
		}
	}
	return found(w, row, out)
}

// worst is the region among rs whose line is active with the highest
// gauge, the first listed on a tie.
func worst(w World, rs []int, line, gauge string) (int, bool) {
	best := -1
	for _, r := range rs {
		if w.Line(r, line) && (best < 0 || w.Gauge(r, gauge) > w.Gauge(best, gauge)) {
			best = r
		}
	}
	return best, best >= 0
}

// ownFirst is region r, then its awake neighbours: a trouble's neighbour.
func ownFirst(w World, r int) []int {
	return append([]int{r}, slices.DeleteFunc(slices.Clone(w.Neighbours(r)), func(n int) bool { return n == r })...)
}

// raidNear is the raid: threat's raid line on the place's region or an
// awake neighbour; the source is the most threatened of them.
func raidNear(w World, row Row, p Params) []Candidate {
	return eachPlace(w, row, func(pl PlaceView) (Candidate, bool) {
		src, ok := worst(w, ownFirst(w, pl.Region), lineRaid, gaugeThreat)
		if !ok {
			return Candidate{}, false
		}
		causes := recalled(w, p.MemoryDays, []string{memRaids}, inRegions([]int{src}))
		return atPlace(pl, []int{pl.Region}, w.Gauge(src, gaugeThreat), causes, bind(roleSource, RegionRef(src))), true
	})
}

// fireRisk is the fire: unrest's fire line on the place's region, or a
// raid that got in within a day. A fire after a raid ignores the place's
// rest.
func fireRisk(w World, row Row, p Params) []Candidate {
	x, _ := w.(Extra)
	var lined, followed []Candidate
	for _, pl := range w.Places() {
		if !standing(pl) {
			continue
		}
		after := x != nil && x.Followed(pl.N) > 0 && dayOf(x.Followed(pl.N))+1 >= w.Day()
		if !after && !w.Line(pl.Region, lineFire) {
			continue
		}
		causes := recalled(w, p.MemoryDays, []string{memUnrest}, inRegions([]int{pl.Region}))
		if after {
			causes = append(causes, recalled(w, 1, []string{memTroubleLost}, func(m Memory) bool {
				return m.At == pl.Hex || names(m, SettlementRef(pl.N))
			})...)
			slices.Sort(causes)
			causes = slices.Compact(causes)
		}
		c := atPlace(pl, []int{pl.Region}, w.Gauge(pl.Region, gaugeUnrest), causes)
		if after {
			c.Cast = Sorted(c.Cast)
			followed = append(followed, c)
		} else {
			lined = append(lined, c)
		}
	}
	return Ordered(append(found(w, row, lined), followed...))
}

// corruptionNextDoor is corruption: an awake neighbour, not the place's
// own region, with its corruption line active. Beats count there.
func corruptionNextDoor(w World, row Row, p Params) []Candidate {
	return eachPlace(w, row, func(pl PlaceView) (Candidate, bool) {
		next := slices.DeleteFunc(slices.Clone(w.Neighbours(pl.Region)), func(n int) bool { return n == pl.Region })
		src, ok := worst(w, next, lineCorruption, gaugeCorruption)
		if !ok {
			return Candidate{}, false
		}
		causes := recalled(w, p.MemoryDays, []string{memCorruption}, inRegions([]int{src}))
		return atPlace(pl, []int{src}, w.Gauge(src, gaugeCorruption), causes, bind(roleSource, RegionRef(src))), true
	})
}

// scarcityHigh is the shortage: scarcity's yields line on the place's
// region.
func scarcityHigh(w World, row Row, _ Params) []Candidate {
	return eachPlace(w, row, func(pl PlaceView) (Candidate, bool) {
		if !w.Line(pl.Region, lineYields) {
			return Candidate{}, false
		}
		return atPlace(pl, []int{pl.Region}, w.Gauge(pl.Region, gaugeScarcity), nil), true
	})
}

// wetAndScarce is the sickness: a wet streak of wet-days and scarcity over
// wet-scarcity on the place's region.
func wetAndScarce(w World, row Row, p Params) []Candidate {
	return eachPlace(w, row, func(pl PlaceView) (Candidate, bool) {
		wet := w.Streak(pl.Region, StreakWet)
		if wet < p.WetDays || w.Gauge(pl.Region, gaugeScarcity) <= p.WetScarcity {
			return Candidate{}, false
		}
		return atPlace(pl, []int{pl.Region}, wet, nil), true
	})
}

// factionCollapsing is the panic: the holder of the place's region, or of
// an awake neighbour, is down to one region after losing one, or has
// starved panic-starving-days running. The weakest such faction is bound.
func factionCollapsing(w World, row Row, p Params) []Candidate {
	fs := w.Factions()
	return eachPlace(w, row, func(pl PlaceView) (Candidate, bool) {
		var hit FactionView
		got := false
		for _, r := range ownFirst(w, pl.Region) {
			f, ok := faction(fs, w.Holder(r))
			if !ok || f.StarvingDays < p.PanicStarvingDays && (len(f.Holdings) > 1 || !lostHolding(w, p, FactionRef(f.ID))) {
				continue
			}
			if !got || larger(hit, f) {
				hit, got = f, true
			}
		}
		if !got {
			return Candidate{}, false
		}
		ref := FactionRef(hit.ID)
		causes := recalled(w, p.MemoryDays, []string{memStarving, memHoldingFell}, func(m Memory) bool { return names(m, ref) })
		return atPlace(pl, []int{pl.Region}, hit.StarvingDays, causes, bind(roleFaction, ref)), true
	})
}

// lostHolding reports whether the ring recalls a holding of a faction's
// falling: one holding is collapsing only once it was more, since every
// faction starts on one. A fall names its holder last.
func lostHolding(w World, p Params, ref fact.Ref) bool {
	return len(recalled(w, p.MemoryDays, []string{memHoldingFell}, func(m Memory) bool {
		return len(m.Subjects) > 0 && m.Subjects[len(m.Subjects)-1] == ref
	})) > 0
}

// prospersRoad is the caravan: prosperity's caravan line on the place's
// region, and a road in: a city, or caravan-passages on its tile this
// season.
func prospersRoad(w World, row Row, p Params) []Candidate {
	x, _ := w.(Extra)
	return eachPlace(w, row, func(pl PlaceView) (Candidate, bool) {
		road := pl.City || (x != nil && x.Passages(pl.N) >= p.CaravanPassages)
		if !road || !w.Line(pl.Region, lineCaravans) {
			return Candidate{}, false
		}
		return atPlace(pl, []int{pl.Region}, w.Gauge(pl.Region, gaugeProsperity), nil), true
	})
}

// seasonTurn is the migration: on the day a season began, the place in
// the awake region, among those with a standing place, where the
// occasion's hunt finds most of its creature.
func seasonTurn(w World, row Row, p Params) []Candidate {
	x, ok := w.(Extra)
	if !ok || row.Occasion == nil || row.Occasion.Hunt == "" {
		return nil
	}
	var began []fact.ID
	for _, m := range w.Recall(memSeasonBegan, 1) {
		if dayOf(m.Tick) >= w.Day() {
			began = append(began, m.Fact)
		}
	}
	if len(began) == 0 {
		return nil
	}
	slices.Sort(began)
	ps := w.Places()
	best, most := -1, int64(0)
	for _, r := range w.Awake() {
		if !slices.ContainsFunc(ps, func(pl PlaceView) bool { return standing(pl) && pl.Region == r }) {
			continue
		}
		if n := x.Herd(r, row.Occasion.Hunt); n > most {
			best, most = r, n
		}
	}
	if best < 0 {
		return nil
	}
	pl, _ := nearestTo(ps, w.RegionHex(best), func(pl PlaceView) bool { return pl.Region == best })
	return found(w, row, []Candidate{atPlace(pl, []int{best}, most, slices.Compact(began))})
}

// scarcityLow is the seam: the place's region's scarcity crossed under
// seam-below today.
func scarcityLow(w World, row Row, p Params) []Candidate {
	return eachPlace(w, row, func(pl PlaceView) (Candidate, bool) {
		if w.Streak(pl.Region, StreakLow) != 1 {
			return Candidate{}, false
		}
		return atPlace(pl, []int{pl.Region}, p.SeamBelow-w.Gauge(pl.Region, gaugeScarcity), nil), true
	})
}
