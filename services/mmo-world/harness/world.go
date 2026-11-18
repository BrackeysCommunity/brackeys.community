package harness

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// The World run: worlds left alone for 90 world days against the MM1
// targets, then what a world day costs as the discovered world grows,
// and as undiscovered chunks are generated.
const (
	worldDays     = 90
	worldPin      = 7  // days a gauge may sit at 0 or its maximum
	worldMoving   = 60 // threat span over days 60 to 90 that counts as moving
	worldOverrun  = 3
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
		out = append(out, world.Action{Kind: world.ActVisit, Hex: h, By: e.Who, Dir: -1})
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
	k := keys.Throwaway(fmt.Sprintf("world-%d", seed))
	g, err := gen.New(b, k.Generation)
	if err != nil {
		return worldResult{}, err
	}
	s, err := world.New(b, g, k.Roll)
	if err != nil {
		return worldResult{}, err
	}
	log := &fact.Mem{}
	res := worldResult{seed: seed, regions: len(s.Regions), factions: len(s.Factions)}
	nG := len(b.Gauges)
	runs := make([][]int, len(s.Regions)*nG)
	threat := slices.IndexFunc(b.Gauges, func(x sheets.Gauge) bool { return x.ID == "threat" })
	var daily [][]int64
	for range worldDays {
		if err := s.AdvanceDay(log); err != nil {
			return res, err
		}
		var t []int64
		for ri, r := range s.Regions {
			t = append(t, r.Gauge[threat])
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
		daily = append(daily, t)
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
	overrun := slices.IndexFunc(b.GaugeLines, func(l sheets.GaugeLine) bool { return l.Effect == "overrun" })
	for ri, r := range s.Regions {
		if r.Active[overrun] {
			res.overrunEnd++
		}
		lo, hi := daily[worldDays-31][ri], daily[worldDays-31][ri]
		for d := worldDays - 31; d < worldDays; d++ {
			lo, hi = min(lo, daily[d][ri]), max(hi, daily[d][ri])
		}
		if hi-lo >= worldMoving {
			res.moving++
		}
	}
	for _, f := range log.Since(0) {
		switch f.Kind {
		case "faction.fell":
			res.fallenFactions++
		case "holding.fell":
			if d, ok := f.Get("settlement"); ok && d.N == 1 {
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
	k := keys.Throwaway(fmt.Sprintf("world-cost-%d", seed))
	g, err := gen.New(b, k.Generation)
	if err != nil {
		return nil, err
	}
	s, err := world.New(b, g, k.Roll)
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
		return ds[len(ds)/2], nil
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
	errs := make([]error, n)
	var wg sync.WaitGroup
	next := make(chan int)
	for range runtime.NumCPU() {
		wg.Go(func() {
			for i := range next {
				results[i], errs[i] = runWorld(b, i)
			}
		})
	}
	for i := range n {
		next <- i
	}
	close(next)
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	var cost []costRow
	for seed := range worldCostRuns {
		rows, err := worldCost(b, seed)
		if err != nil {
			return nil, err
		}
		cost = append(cost, rows...)
	}

	var sb strings.Builder
	p := func(f string, a ...any) { fmt.Fprintf(&sb, f+"\n", a...) }
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
		if r.overrunEnd > worldOverrun {
			collapse++
		}
		if r.moving*2 < r.regions {
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
	yes := func(ok bool) string { return map[bool]string{true: "yes", false: "**NO**"}[ok] }
	p("| No gauge pinned at 0 or its maximum for more than %d world days | %d of %d | %d region gauges; longest run %d days | %s |", worldPin, pinnedWorlds, n, pinned, worst, yes(pinned == 0))
	p("| No faction loses its last holding | %d of %d | %d factions fell | %s |", fallenWorlds, n, fallen, yes(fallen == 0))
	p("| Every starting settlement stands on day %d | %d of %d | %d fell | %s |", worldDays, settleWorlds, n, settle, yes(settle == 0))
	p("| At most %d regions overrun on day %d | %d of %d | | %s |", worldOverrun, worldDays, collapse, n, yes(collapse == 0))
	p("| Half the regions' threat moves %d or more in days 60 to 90 | %d of %d | | %s |", worldMoving, stasis, n, yes(stasis == 0))
	p("")
	med := func(get func(worldResult) int) int {
		var xs []int
		for _, r := range results {
			xs = append(xs, get(r))
		}
		slices.Sort(xs)
		return xs[len(xs)/2]
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
		p("| %d | %d | %d | %d | %s | %s | %s |", c.seed, c.regions, c.tiles, c.chunks, c.perDay.Round(time.Microsecond), (c.perDay / 144).Round(time.Microsecond), per.Round(time.Microsecond))
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
	tickCost := slopes[len(slopes)/2]
	p("")
	p("Tick cost: a world day costs a median **%s per 1,000 stored tiles** (all clocks; %s a tick). Generating far chunks leaves the day's cost %s.", tickCost.Round(time.Microsecond), (tickCost / 144).Round(time.Microsecond), map[bool]string{true: "flat", false: "**not flat**"}[flat])
	readings := []Measured{
		{"settlements-stand", fmt.Sprintf("%d fell in %d worlds", settle, n), settle == 0},
		{"world-no-collapse", fmt.Sprintf("%d collapsed, %d still, of %d", collapse, stasis, n), collapse == 0 && stasis == 0},
		{"gauges-not-pinned", fmt.Sprintf("%d pinned; longest %d days", pinned, worst), pinned == 0},
		{"factions-keep-holdings", fmt.Sprintf("%d fell in %d worlds", fallen, n), fallen == 0},
		{"cost-follows-discovery", fmt.Sprintf("%s per 1,000 stored tiles a day; far chunks leave it %s", tickCost.Round(time.Microsecond), map[bool]string{true: "flat", false: "rising"}[flat]), flat},
	}
	if err := os.WriteFile(filepath.Join(out, "world.md"), []byte(sb.String()), 0o644); err != nil {
		return nil, err
	}
	return readings, nil
}
