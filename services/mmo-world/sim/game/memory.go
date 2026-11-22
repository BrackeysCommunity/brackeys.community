package game

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// storyKinds are remembered whatever their weight: the predicates cast
// from each of them.
var storyKinds = []string{"notable.died", "faction.betrayed", factVowBroken, "guardian.slain", "holding.fell", "trouble.lost"}

const factVowBroken = "goal.vow-broken"

// Data a memory takes its place and number from.
const (
	datumSettlement = "settlement"
	datumLapsed     = "lapsed"
	datumN          = "n"
)

// noteStory keeps the facts the director remembers: those at memory-weight
// or heavier and the story kinds, at most memory-kept of them and none
// older than memory-days, since the log's tail is flushed at every save.
// A broken vow also queues an oath.
func (g *Game) noteStory(fs []fact.Fact) {
	s := g.Story
	if s == nil {
		return
	}
	for _, f := range fs {
		if f.Kind == factVowBroken {
			g.pendOath(f)
		}
		if f.Weight < g.r.Story.MemoryWeight && !slices.Contains(storyKinds, f.Kind) {
			continue
		}
		s.Memory = append(s.Memory, g.memoryOf(f))
	}
	g.forget()
}

// forget drops memories past memory-days, then the oldest past memory-kept.
func (g *Game) forget() {
	s := g.Story
	from := g.Tick()/sheets.TicksPerDay - g.r.Story.MemoryDays
	drop := 0
	for drop < len(s.Memory) && s.Memory[drop].Tick/sheets.TicksPerDay < from {
		drop++
	}
	if over := len(s.Memory) - drop - int(g.r.Story.MemoryKept); over > 0 {
		drop += over
	}
	if drop > 0 {
		s.Memory = slices.Delete(s.Memory, 0, drop)
	}
}

// memoryOf is a fact as the ring keeps it. It is located on its tile, else
// at the place its settlement datum names inside its region, else at its
// region's centre; its number is whether an arc lapsed, else its n datum.
func (g *Game) memoryOf(f fact.Fact) arc.Memory {
	m := arc.Memory{Fact: f.ID, Tick: f.Tick, Kind: f.Kind, Region: -1}
	if len(f.Subjects) > 0 {
		m.Subjects = slices.Clone(f.Subjects)
	}
	region, inRegion := world.ParseRegionRef(f.Region)
	inRegion = inRegion && region >= 0 && region < len(g.World.Regions)
	at, located := fact.HexOf(f)
	if d, ok := f.Get(datumSettlement); !located && ok && d.N >= 0 && d.N < int64(len(g.Places)) {
		h := g.Places[d.N].Hex
		if !inRegion || g.World.RegionAt(h) == region {
			at, located = h, true
		}
	}
	if !located {
		at, located = g.World.FactAt(f)
	}
	switch {
	case inRegion:
		m.Region = region
	case located:
		m.Region = g.World.RegionAt(at)
	}
	if located {
		m.At = at
	}
	if d, ok := f.Get(datumLapsed); ok {
		m.N = d.N
	} else if d, ok := f.Get(datumN); ok {
		m.N = d.N
	}
	return m
}

// pendOath queues the oath thread for whoever broke a vow, on the vow's
// board.
func (g *Game) pendOath(f fact.Fact) {
	who, board := "", -1
	for _, s := range f.Subjects {
		switch {
		case s == char.Ref(s.ID):
			who = s.ID
		case s == goalRef(s.ID):
			if x := g.GoalOf(s.ID); x != nil {
				board = x.Board
			}
		}
	}
	if who == "" || board < 0 {
		return
	}
	g.pend(arc.Pending{Kind: arc.PendOath, Char: who, Ref: arc.SettlementRef(board), Tick: f.Tick, Fact: f.ID})
}

// pend queues a personal thread candidate, dropping the oldest past
// pending-kept.
func (g *Game) pend(p arc.Pending) {
	s := g.Story
	if s == nil {
		return
	}
	s.Pending = append(s.Pending, p)
	if over := len(s.Pending) - int(g.r.Story.PendingKept); over > 0 {
		s.Pending = slices.Delete(s.Pending, 0, over)
	}
}

// streaksDay counts each region's streaks for the world day just closed:
// prosperity at the city line, frost and wet weather over their shares,
// and scarcity under seam-below. A day without the condition resets it.
func (g *Game) streaksDay(_ int64) {
	if g.Story == nil {
		return
	}
	p := g.r.Story
	prosper := g.sp("city-prosperity")
	for r := range g.World.Regions {
		reg := &g.World.Regions[r]
		st := g.growStreak(r)
		st.Prosper = run(st.Prosper, g.regionGauge(reg, "prosperity") >= prosper)
		st.Cold = run(st.Cold, g.weatherShare(reg, "cold") >= p.ColdShare)
		st.Wet = run(st.Wet, g.weatherShare(reg, "wet") >= p.WetShare)
		st.Low = run(st.Low, g.regionGauge(reg, "scarcity") < p.SeamBelow)
	}
}

// run is a streak after a day that held or did not.
func run(n int64, held bool) int64 {
	if held {
		return n + 1
	}
	return 0
}

// growStreak is region r's streaks, added in region order when it has none.
func (g *Game) growStreak(r int) *Streak {
	s := g.Story
	i, ok := slices.BinarySearchFunc(s.Streaks, r, streakRegion)
	if !ok {
		s.Streaks = slices.Insert(s.Streaks, i, Streak{Region: r})
	}
	return &s.Streaks[i]
}

func streakRegion(s Streak, r int) int { return cmp.Compare(s.Region, r) }

func (g *Game) regionGauge(reg *world.Region, gauge string) int64 {
	gi, ok := g.World.GaugeOf(gauge)
	if !ok || gi >= len(reg.Gauge) {
		return 0
	}
	return reg.Gauge[gi]
}

// weatherShare is the share of a region's tiles under weather that tags
// them with tag.
func (g *Game) weatherShare(reg *world.Region, tag string) int64 {
	var share int64
	for k, w := range g.r.Book.Weather {
		if k < len(reg.Weather) && slices.Contains(w.TileTags, tag) {
			share += reg.Weather[k]
		}
	}
	return share
}
