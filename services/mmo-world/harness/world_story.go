package harness

import (
	"cmp"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

// The World run with the director on (GDD 18.4, 12.4): unplayed worlds left for worldDays, so every arc and trouble goes unbacked.
//
// structural: measurements. The director's day is timed per storyWeek of day turns, each the least of storyReps copies after a warm-up; the last week is compared with the first week the memory ring is full.
const (
	storyWeek = 7
	storyReps = 5
	storyFlat = 110 // percent of the filled week the last one may cost
)

// storyKey groups casts and stage ends by template.
type storyKey struct{ scope, template string }

type storyResult struct {
	seed            int
	cast            map[storyKey]int
	lapsed, won     map[storyKey]int
	held, lost      int // troubles
	settlementsFell int
	ruined          int
	fallen          int // faction.fell facts
	bare            int // factions seen with no holding
	overrunEnd      int
	cost            []time.Duration // the director's day over each week of storyTimed
}

func (r storyResult) lapses() int { return sumCounts(r.lapsed) }
func (r storyResult) wins() int   { return sumCounts(r.won) }

func sumCounts(m map[storyKey]int) int {
	n := 0
	for _, v := range m {
		n += v
	}
	return n
}

// storyTimed are the last days of the weeks the director's day is timed
// over: the first, the one after the memory ring has filled, and the last.
func storyTimed(b *sheets.Book) []int64 {
	full := min(sheets.IntParam(b.StoryParams, "memory-days")*3/2, worldDays-storyWeek)
	return []int64{storyWeek, full, worldDays}
}

// storyWindow is the week of storyTimed day d falls in, or -1.
func storyWindow(days []int64, d int64) int {
	return slices.IndexFunc(days, func(last int64) bool { return d > last-storyWeek && d <= last })
}

// runWorldStory plays one World run seed as a characterless game.
func runWorldStory(b *sheets.Book, seed int) (storyResult, error) {
	label := fmt.Sprintf("world-%d", seed)
	days := storyTimed(b)
	res := storyResult{seed: seed, cast: map[storyKey]int{}, lapsed: map[storyKey]int{}, won: map[storyKey]int{}, cost: make([]time.Duration, len(days))}
	r, err := game.NewRules(b, keys.Throwaway(label))
	if err != nil {
		return res, err
	}
	g, err := game.New(r)
	if err != nil {
		return res, err
	}
	// Copies are timed on rules of their own: attaching a copy rebinds
	// its rules to it.
	var copies *game.Rules
	bare := map[int]bool{}
	for g.Tick() < worldDays*sheets.TicksPerDay {
		t := g.Tick() + 1
		if i := storyWindow(days, t/sheets.TicksPerDay); i >= 0 && t%sheets.TicksPerDay == 0 {
			if copies == nil {
				if copies, err = game.NewRules(b, keys.Throwaway(label)); err != nil {
					return res, err
				}
			}
			c, err := storyDayCost(copies, g)
			if err != nil {
				return res, err
			}
			res.cost[i] += c / storyWeek
		}
		if _, err := g.Advance(); err != nil {
			return res, err
		}
		facts, _ := g.Flush()
		res.note(facts)
		for f := range g.World.Factions {
			if holdingsOf(g, f) == 0 {
				bare[f] = true
			}
		}
	}
	res.bare = len(bare)
	res.overrunEnd = overrunAtEnd(b, g.World)
	return res, nil
}

// holdingsOf counts the regions faction f holds.
func holdingsOf(g *game.Game, f int) int {
	n := 0
	for _, r := range g.World.Regions {
		if r.Holder == f {
			n++
		}
	}
	return n
}

// note reads the director's casts and stage ends, and the falls, off a
// tick's facts.
func (r *storyResult) note(facts []fact.Fact) {
	for _, f := range facts {
		key := func() storyKey {
			k := storyKey{}
			if d, ok := f.Get("scope"); ok {
				k.scope = d.S
			}
			if d, ok := f.Get("template"); ok {
				k.template = d.S
			}
			return k
		}
		switch f.Kind {
		case "arc.cast", "trouble.started", "thread.cast":
			r.cast[key()]++
		case "arc.stage-ended", "trouble.held", "trouble.lost", "thread.ended":
			if d, ok := f.Get("lapsed"); ok && d.N == 1 {
				r.lapsed[key()]++
			} else {
				r.won[key()]++
			}
			switch f.Kind {
			case "trouble.held":
				r.held++
			case "trouble.lost":
				r.lost++
			}
		case "holding.fell":
			if settlementFell(f) {
				r.settlementsFell++
			}
		case "settlement.ruined":
			r.ruined++
		case "faction.fell":
			r.fallen++
		}
	}
}

// storyDayCost times the next tick, a day turn, on copies of g with and
// without the director; the difference is what the director's day costs.
func storyDayCost(r *game.Rules, g *game.Game) (time.Duration, error) {
	snap, err := json.Marshal(g)
	if err != nil {
		return 0, err
	}
	one := func(story bool) (time.Duration, error) {
		var c game.Game
		if err := json.Unmarshal(snap, &c); err != nil {
			return 0, err
		}
		c.Attach(r)
		if !story {
			c.Story = nil
		}
		start := time.Now()
		_, err := c.Advance()
		return time.Since(start), err
	}
	least := func(d, best time.Duration, first bool) time.Duration {
		if first {
			return d
		}
		return min(d, best)
	}
	var on, off time.Duration
	for i := range storyReps + 1 {
		a, err := one(true)
		if err != nil {
			return 0, err
		}
		z, err := one(false)
		if err != nil {
			return 0, err
		}
		if i == 0 {
			continue
		}
		on, off = least(a, on, i == 1), least(z, off, i == 1)
	}
	return max(0, on-off), nil
}

// worldStory runs the World run's seeds with the director on, writes its
// section and returns its four rows.
func worldStory(b *sheets.Book, n int, p func(string, ...any)) ([]Measured, error) {
	results := make([]storyResult, n)
	if err := runParallel(n, func(i int) error {
		var err error
		results[i], err = runWorldStory(b, i)
		return err
	}); err != nil {
		return nil, err
	}
	type total struct{ cast, lapsed, won, seeds int }
	byTemplate := map[storyKey]*total{}
	at := func(k storyKey) *total {
		if byTemplate[k] == nil {
			byTemplate[k] = &total{}
		}
		return byTemplate[k]
	}
	var fell, ruined, fallen, bare, held, lost, noLapse, wonSeeds, standFail, bareFail int
	var overrun []int
	days := storyTimed(b)
	cost := make([]time.Duration, len(days))
	for _, r := range results {
		for k, v := range r.cast {
			at(k).cast += v
			at(k).seeds++
		}
		for k, v := range r.lapsed {
			at(k).lapsed += v
		}
		for k, v := range r.won {
			at(k).won += v
		}
		fell += r.settlementsFell
		ruined += r.ruined
		fallen += r.fallen
		bare += r.bare
		held += r.held
		lost += r.lost
		noLapse += btoi(r.lapses() == 0)
		wonSeeds += btoi(r.wins() > 0)
		standFail += btoi(r.settlementsFell+r.ruined > 0)
		bareFail += btoi(r.bare > 0)
		overrun = append(overrun, r.overrunEnd)
		for i, d := range r.cost {
			cost[i] += d
		}
	}
	for i := range cost {
		cost[i] /= time.Duration(n)
	}
	early, full, late := cost[0], cost[1], cost[2]
	slices.Sort(overrun)
	flat := late*100 <= full*storyFlat
	share := func(of time.Duration) int {
		if of == 0 {
			return 0
		}
		return int(late * 100 / of)
	}
	won := 0
	for _, t := range byTemplate {
		won += t.won
	}

	p("")
	p("## With the director on")
	p("")
	p("The same %d worlds as games nobody plays, each left alone for %d world days with the director casting arcs and troubles. Nobody backs a side, so every stage should lapse and every trouble be lost. The director's day is the day turn's cost with the director less its cost without, on copies of the game, the least of %d copies each, averaged over a week of day turns and over the worlds.", n, worldDays, storyReps)
	p("")
	p("| Target | Worlds failing | Reading | Holds |")
	p("| --- | --- | --- | --- |")
	p("| No starting settlement lost and no ruin, with troubles | %d of %d | %d fell, %d ruined | %s |", standFail, n, fell, ruined, holds(fell+ruined == 0))
	p("| A stage lapses on every world and none is won | %d without a lapse, %d with a win, of %d | %d stages won | %s |", noLapse, wonSeeds, n, won, holds(noLapse == 0 && won == 0))
	p("| No faction left with no holding, with arcs | %d of %d | %d factions bare, %d fell | %s |", bareFail, n, bare, fallen, holds(bare == 0))
	p("| The director's day in the week to day %d within %d%% of the week to day %d | | %s to day %d, %s to day %d (%d%%) | %s |", worldDays, storyFlat, days[1], full.Round(time.Microsecond), days[1], late.Round(time.Microsecond), worldDays, share(full), holds(flat))
	p("")
	p("| Template | Scope | Cast | Worlds casting | Stages lapsed | Stages won |")
	p("| --- | --- | --- | --- | --- | --- |")
	order := slices.SortedFunc(maps.Keys(byTemplate), func(a, b storyKey) int {
		return cmp.Or(strings.Compare(a.scope, b.scope), strings.Compare(a.template, b.template))
	})
	casts := 0
	for _, k := range order {
		t := byTemplate[k]
		casts += t.cast
		p("| %s | %s | %d | %d | %d | %d |", k.template, k.scope, t.cast, t.seeds, t.lapsed, t.won)
	}
	if len(order) == 0 {
		p("| none cast | | 0 | 0 | 0 | 0 |")
	}
	p("")
	p("| Over the worlds | Value |")
	p("| --- | --- |")
	p("| Arcs and troubles cast | %d |", casts)
	p("| Troubles held / lost | %d / %d |", held, lost)
	p("| Regions overrun on day %d (median, most) | %d, %d |", worldDays, percentile(overrun, 50), overrun[len(overrun)-1])
	p("| The director's day in the first week, while the memory ring fills | %s; the last week is %d%% of it |", early.Round(time.Microsecond), share(early))

	return []Measured{
		{"settlements-stand-troubles", fmt.Sprintf("%d fell, %d ruined in %d worlds", fell, ruined, n), fell+ruined == 0},
		{"arcs-lapse-unattended", fmt.Sprintf("%d worlds without a lapse, %d stages won, of %d", noLapse, won, n), noLapse == 0 && won == 0},
		{"factions-keep-holdings-arcs", fmt.Sprintf("%d factions left with no holding, %d fell, in %d worlds", bare, fallen, n), bare == 0},
		{"director-cost-flat", fmt.Sprintf("%s in the week to day %d, %s in the week to day %d (%d%%); %d%% of the first week", full.Round(time.Microsecond), days[1], late.Round(time.Microsecond), worldDays, share(full), share(early)), flat},
	}, nil
}
