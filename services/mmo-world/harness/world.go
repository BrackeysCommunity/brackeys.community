package harness

import (
	"fmt"
	"runtime"
	"slices"
	"time"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// The World run: worlds left alone for worldDays against the world
// targets, then what a world day costs as the discovered world grows and
// as undiscovered chunks are generated.
const (
	worldDays     = 90
	worldPin      = 7  // days a gauge may sit at 0 or its maximum
	worldMoving   = 60 // threat span over the last worldLate days that counts as moving
	worldLate     = 30
	worldOverrun  = 3 // regions overrun on the last day that still count as no collapse
	worldCostRuns = 3
	worldCostDays = 5
	worldFarChunk = 40 // chunks per ring of the far generation test
)

// Explorer is the scripted player the World run and the replay fixtures
// use: each world day it walks out from the first settlement along a
// keyed spiral, discovering, gathering, winning a beat and slaying where
// it goes.
type Explorer struct {
	Who   fact.Ref
	steps []hex.Hex
	at    int
}

// NewExplorer walks a spiral of the given radius round a centre.
func NewExplorer(centre hex.Hex, radius int64) *Explorer {
	e := &Explorer{Who: fact.Ref{Kind: "character", ID: "c-explorer"}}
	for r := int64(1); r <= radius; r++ {
		e.steps = append(e.steps, hex.Ring(centre, r)...)
	}
	return e
}

// Day is the explorer's actions for one world day, at its first tick.
func (e *Explorer) Day(s *world.State, perDay int) []world.Action {
	var out []world.Action
	for range perDay {
		if e.at >= len(e.steps) {
			break
		}
		h := e.steps[e.at]
		e.at++
		t := s.Gen().Baseline(h)
		if !s.Gen().Passable(t.Terrain) {
			continue
		}
		out = append(out, world.Action{Kind: world.ActVisit, Hex: h, By: e.Who})
		if r := s.Gen().Region(t.Region); len(r.Materials) > 0 && e.at%3 == 0 {
			out = append(out, world.Action{Kind: world.ActGather, Hex: h, By: e.Who, Material: r.Materials[0], Units: 4})
		}
		if r := s.Gen().Region(t.Region); r.Creature != "" && e.at%5 == 0 {
			out = append(out, world.Action{Kind: world.ActWinBeat, Hex: h, By: e.Who, Tag: "creature"},
				world.Action{Kind: world.ActSlay, Hex: h, By: e.Who, Species: r.Creature})
		}
	}
	return out
}

// threatTrace is every region's threat, one row per day from day 0.
type threatTrace [][]int64

func (t *threatTrace) snap(s *world.State) {
	threat := s.GaugeIndex("threat")
	var row []int64
	for _, r := range s.Regions {
		row = append(row, r.Gauge[threat])
	}
	*t = append(*t, row)
}

// moving counts the regions whose threat spans at least span over the
// last late days.
func (t threatTrace) moving(late int, span int64) int {
	end := len(t) - 1
	n := 0
	for ri := range t[end] {
		lo, hi := t[end-late][ri], t[end-late][ri]
		for d := end - late; d <= end; d++ {
			lo, hi = min(lo, t[d][ri]), max(hi, t[d][ri])
		}
		if hi-lo >= span {
			n++
		}
	}
	return n
}

// collapsed is a world with too many regions overrun on its last day.
func collapsed(overrunEnd int) bool { return overrunEnd > worldOverrun }

// stagnant is a world where under half the regions' threat moved late on.
func stagnant(moving, regions int) bool { return moving*2 < regions }

// settlementFell is a holding.fell fact for a starting settlement.
func settlementFell(f fact.Fact) bool {
	d, ok := f.Get("settlement")
	return ok && d.N == 1
}

// overrunAtEnd counts the regions overrun now.
func overrunAtEnd(b *sheets.Book, s *world.State) int {
	overrun := slices.IndexFunc(b.GaugeLines, func(l sheets.GaugeLine) bool { return l.Effect == "overrun" })
	n := 0
	for _, r := range s.Regions {
		if r.Active[overrun] {
			n++
		}
	}
	return n
}

type worldResult struct {
	seed                   int
	regions, factions      int
	pinnedWorst            int
	pinned                 int // region gauges pinned past the limit
	fallenFactions         int
	settlementsFell        int
	overrunEnd, moving     int
	facts                  int
	systems, landfalls     int
	herdsMoved, defections int
}

func runWorld(b *sheets.Book, seed int) (worldResult, error) {
	_, s, err := newWorld(b, fmt.Sprintf("world-%d", seed))
	if err != nil {
		return worldResult{}, err
	}
	log := &fact.Mem{}
	res := worldResult{seed: seed, regions: len(s.Regions), factions: len(s.Factions)}
	nG := len(b.Gauges)
	runs := make([][]int, len(s.Regions)*nG)
	var trace threatTrace
	trace.snap(s)
	for range worldDays {
		if err := s.AdvanceDay(log); err != nil {
			return res, err
		}
		trace.snap(s)
		for ri, r := range s.Regions {
			for gi, v := range r.Gauge {
				k := ri*nG + gi
				if v == 0 || v == b.Gauges[gi].Max {
					if len(runs[k]) == 0 {
						runs[k] = []int{0}
					}
					runs[k][len(runs[k])-1]++
				} else if len(runs[k]) > 0 && runs[k][len(runs[k])-1] > 0 {
					runs[k] = append(runs[k], 0)
				}
			}
		}
	}
	for _, rs := range runs {
		worst := 0
		for _, n := range rs {
			worst = max(worst, n)
		}
		res.pinnedWorst = max(res.pinnedWorst, worst)
		if worst > worldPin {
			res.pinned++
		}
	}
	res.overrunEnd = overrunAtEnd(b, s)
	res.moving = trace.moving(worldLate, worldMoving)
	for _, f := range log.Since(0) {
		switch f.Kind {
		case "faction.fell":
			res.fallenFactions++
		case "holding.fell":
			if settlementFell(f) {
				res.settlementsFell++
			}
		case "weather.formed":
			res.systems++
		case "weather.landfall":
			res.landfalls++
		case "herd.arrived":
			res.herdsMoved++
		case "notable.defected":
			res.defections++
		}
	}
	res.facts = log.Len()
	return res, nil
}

type costRow struct {
	seed, regions, tiles, chunks int
	perDay                       time.Duration
}

// worldCost grows one world's discovered area in steps, diverging every
// awake tile, and times its days; then generates far chunks nobody has
// discovered and times its days again.
func worldCost(b *sheets.Book, seed int) ([]costRow, error) {
	g, s, err := newWorld(b, fmt.Sprintf("world-cost-%d", seed))
	if err != nil {
		return nil, err
	}
	log := &fact.Mem{}
	home := g.Settlement(0).Hex
	who := fact.Ref{Kind: "character", ID: "c-surveyor"}
	timeDays := func() (time.Duration, error) {
		var ds []time.Duration
		for range worldCostDays {
			start := time.Now()
			if err := s.AdvanceDay(log); err != nil {
				return 0, err
			}
			ds = append(ds, time.Since(start))
		}
		slices.Sort(ds)
		return percentile(ds, 50), nil
	}
	var out []costRow
	chunks := 0
	for _, radius := range []int64{0, 20, 40, 60, 80} {
		for _, h := range hex.DiscAt(home, radius) {
			if radius > 0 && hex.Distance(h, home)%10 != 0 {
				continue
			}
			if err := s.Discover(log, h, who); err != nil {
				return nil, err
			}
		}
		var acts []world.Action
		for _, r := range s.Regions {
			if !r.Discovered {
				continue
			}
			for _, h := range g.RegionTiles(r.Lattice) {
				if t := s.Tile(h); t == nil || t.Discovered == nil {
					acts = append(acts, world.Action{Kind: world.ActDiscover, Hex: h, By: who})
				}
			}
		}
		if _, _, err := world.Advance(s, log, acts, s.Tick+1); err != nil {
			return nil, err
		}
		d, err := timeDays()
		if err != nil {
			return nil, err
		}
		out = append(out, costRow{seed, len(s.Regions), len(s.Tiles), chunks, d})
	}
	// Generate far chunks nobody has discovered; the day should not care.
	for ring := int64(1); ring <= 3; ring++ {
		for k := int64(0); k < worldFarChunk; k++ {
			g.Chunk(gen.ChunkCoord{A: 40*ring + k, B: -20 * ring})
			chunks++
		}
	}
	d, err := timeDays()
	if err != nil {
		return nil, err
	}
	out = append(out, costRow{seed, len(s.Regions), len(s.Tiles), chunks, d})
	return out, nil
}

// WorldRun runs the World run and writes world.md under out.
func WorldRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	if n == 0 {
		n = 50
	}
	results := make([]worldResult, n)
	if err := runParallel(n, func(i int) error {
		var err error
		results[i], err = runWorld(b, i)
		return err
	}); err != nil {
		return nil, err
	}
	var cost []costRow
	for seed := range worldCostRuns {
		rows, err := worldCost(b, seed)
		if err != nil {
			return nil, err
		}
		cost = append(cost, rows...)
	}

	var doc lineDoc
	p := doc.p
	sum := func(get func(worldResult) int) (total, worlds int) {
		for _, r := range results {
			v := get(r)
			total += v
			if v > 0 {
				worlds++
			}
		}
		return
	}
	pinned, pinnedWorlds := sum(func(r worldResult) int { return r.pinned })
	fallen, fallenWorlds := sum(func(r worldResult) int { return r.fallenFactions })
	settle, settleWorlds := sum(func(r worldResult) int { return r.settlementsFell })
	collapse, stasis := 0, 0
	for _, r := range results {
		if collapsed(r.overrunEnd) {
			collapse++
		}
		if stagnant(r.moving, r.regions) {
			stasis++
		}
	}
	worst := 0
	for _, r := range results {
		worst = max(worst, r.pinnedWorst)
	}
	p("# World run")
	p("")
	p("%d worlds, each left alone for %d world days from its founding: the first starting settlement open, its region discovered, and the horizon of regions round it awake. Throwaway keys `world-<n>`. Weather, creatures, factions and notables all run.", n, worldDays)
	p("")
	p("| Target | Worlds failing | Reading | Holds |")
	p("| --- | --- | --- | --- |")
	p("| No gauge pinned at 0 or its maximum for more than %d world days | %d of %d | %d region gauges; longest run %d days | %s |", worldPin, pinnedWorlds, n, pinned, worst, holds(pinned == 0))
	p("| No faction loses its last holding | %d of %d | %d factions fell | %s |", fallenWorlds, n, fallen, holds(fallen == 0))
	p("| Every starting settlement stands on day %d | %d of %d | %d fell | %s |", worldDays, settleWorlds, n, settle, holds(settle == 0))
	p("| At most %d regions overrun on day %d | %d of %d | | %s |", worldOverrun, worldDays, collapse, n, holds(collapse == 0))
	p("| Half the regions' threat moves %d or more in days %d to %d | %d of %d | | %s |", worldMoving, worldDays-worldLate, worldDays, stasis, n, holds(stasis == 0))
	p("")
	med := func(get func(worldResult) int) int {
		var xs []int
		for _, r := range results {
			xs = append(xs, get(r))
		}
		slices.Sort(xs)
		return percentile(xs, 50)
	}
	p("| Per world (median) | Value |")
	p("| --- | --- |")
	p("| Regions awake | %d |", med(func(r worldResult) int { return r.regions }))
	p("| Factions | %d |", med(func(r worldResult) int { return r.factions }))
	p("| Facts in %d days | %d |", worldDays, med(func(r worldResult) int { return r.facts }))
	p("| Weather systems formed | %d |", med(func(r worldResult) int { return r.systems }))
	p("| Landfalls on a settlement | %d |", med(func(r worldResult) int { return r.landfalls }))
	p("| Herd arrivals in a new region | %d |", med(func(r worldResult) int { return r.herdsMoved }))
	p("| Notables defected | %d |", med(func(r worldResult) int { return r.defections }))
	p("")
	p("## What a world day costs")
	p("")
	p("For %d worlds, a surveyor discovers tiles every 10 tiles out to a radius, which wakes the horizon round them, then every tile of every discovered region, so each is stored. Each step times %d world days (median, one core, %s). The last row of each world then generates %d chunks far beyond the horizon, which nobody has discovered.", worldCostRuns, worldCostDays, runtime.GOARCH, 3*worldFarChunk)
	p("")
	p("| World | Regions awake | Stored tiles | Far chunks generated | Per world day | Per tick | Per 1,000 stored tiles a day |")
	p("| --- | --- | --- | --- | --- | --- | --- |")
	var slopes []time.Duration
	flat := true
	for i, c := range cost {
		per := time.Duration(0)
		if c.tiles > 0 {
			per = c.perDay * 1000 / time.Duration(c.tiles)
		}
		p("| %d | %d | %d | %d | %s | %s | %s |", c.seed, c.regions, c.tiles, c.chunks, c.perDay.Round(time.Microsecond), (c.perDay / sheets.TicksPerDay).Round(time.Microsecond), per.Round(time.Microsecond))
		if c.chunks > 0 && i > 0 {
			before := cost[i-1].perDay
			// Flat: within half again of the day before the far chunks.
			if c.perDay > before*3/2 {
				flat = false
			}
		} else if c.tiles > 0 {
			slopes = append(slopes, per)
		}
	}
	slices.Sort(slopes)
	tickCost := percentile(slopes, 50)
	p("")
	p("Tick cost: a world day costs a median **%s per 1,000 stored tiles** (all clocks; %s a tick). Generating far chunks leaves the day's cost %s.", tickCost.Round(time.Microsecond), (tickCost / sheets.TicksPerDay).Round(time.Microsecond), either(flat, "flat", "**not flat**"))
	mount, mounts, err := MountJourneys(b, 0)
	if err != nil {
		return nil, err
	}
	p("")
	p("## Mounts on their terrain")
	p("")
	p("On %d worlds, journeys that set out from a terrain a mount suits and that costs more than %d tick on foot, to a passable tile %d tiles away: the quickest way ridden against the quickest way on foot. A mount with no such terrain buys load, not speed (GDD 6.2).", journeyWorlds, sheets.IntParam(b.MountParams, "min-enter-ticks"), journeyTiles)
	p("")
	p("| Mount | Buys speed | Journeys | Saving (median) | 10th to 90th percentile |")
	p("| --- | --- | --- | --- | --- |")
	for _, r := range mounts {
		p("| %s | %s | %d | %d%% | %d%% to %d%% |", r.Kind, either(r.Speed, "yes", "no, load"), r.Journeys, r.Median, r.Lo, r.Hi)
	}
	readings := []Measured{
		mount,
		{"settlements-stand", fmt.Sprintf("%d fell in %d worlds", settle, n), settle == 0},
		{"world-no-collapse", fmt.Sprintf("%d collapsed, %d still, of %d", collapse, stasis, n), collapse == 0 && stasis == 0},
		{"gauges-not-pinned", fmt.Sprintf("%d pinned; longest %d days", pinned, worst), pinned == 0},
		{"factions-keep-holdings", fmt.Sprintf("%d fell in %d worlds", fallen, n), fallen == 0},
		{"cost-follows-discovery", fmt.Sprintf("%s per 1,000 stored tiles a day; far chunks leave it %s", tickCost.Round(time.Microsecond), either(flat, "flat", "rising")), flat},
	}
	dungeons, err := dungeonSections(b, p)
	if err != nil {
		return nil, err
	}
	readings = append(readings, dungeons...)
	story, err := worldStory(b, n, p)
	if err != nil {
		return nil, err
	}
	readings = append(readings, story...)
	if err := doc.save(out, "world.md"); err != nil {
		return nil, err
	}
	return readings, nil
}
