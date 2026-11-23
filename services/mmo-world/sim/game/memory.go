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

// storyKinds are remembered whatever their weight and leave the ring by
// count only after every other kind: the predicates' kinds and those the
// game reads back itself.
var storyKinds = append(slices.Clone(arc.Remembered), factGuardianSlain)

// storyKindSet is storyKinds once each.
var storyKindSet = slices.Compact(slices.Sorted(slices.Values(storyKinds)))

const factVowBroken = "goal.vow-broken"

// Data a memory takes its place and number from.
const (
	datumSettlement = "settlement"
	datumLapsed     = "lapsed"
	datumN          = "n"
)

// noteStory keeps the facts the director remembers: those at memory-weight
// or heavier and the story kinds, none older than memory-days and at most
// memory-kept, since the log's tail is flushed at every save.
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
		g.ringFact(f)
		if f.Weight < g.r.Story.MemoryWeight && !slices.Contains(storyKinds, f.Kind) {
			continue
		}
		m := g.memoryOf(f)
		x := s.ring()
		s.Memory = append(s.Memory, m)
		x.add(m, s.Memory)
	}
	g.forget()
}

// forget drops memories and thread candidates past memory-days, then holds
// the ring to memory-kept: the oldest of other kinds go first, so a story
// kind is evicted by count only when story kinds alone overfill it.
func (g *Game) forget() {
	s := g.Story
	x := s.ring()
	from := g.Tick()/sheets.TicksPerDay - g.r.Story.MemoryDays
	old := func(tick int64) bool { return tick/sheets.TicksPerDay < from }
	// The ring is oldest first, so what has aged out leads it.
	young := slices.IndexFunc(s.Memory, func(m arc.Memory) bool { return !old(m.Tick) })
	if young < 0 {
		young = len(s.Memory)
	}
	gone := slices.Clone(s.Memory[:young])
	s.Memory = s.Memory[young:]
	s.Pending = slices.DeleteFunc(s.Pending, func(p arc.Pending) bool { return old(p.Tick) })
	defer func() { x.drop(gone, s.Memory) }()
	over := len(s.Memory) - int(g.r.Story.MemoryKept)
	if over <= 0 {
		return
	}
	story := 0
	for _, k := range storyKindSet {
		story += len(x.of(k))
	}
	others := min(over, len(s.Memory)-story)
	over -= others
	if others > 0 {
		s.Memory, gone = shed(s.Memory, gone, others, func(m arc.Memory) bool { return !slices.Contains(storyKinds, m.Kind) })
	}
	if over > 0 {
		gone = append(gone, s.Memory[:over]...)
		s.Memory = s.Memory[over:]
	}
}

// shed takes the ring's first n memories that go out of it and adds them
// to gone. The memories kept ahead of the last to go move up behind it, so
// a full ring sheds at the cost of what lies ahead of its last shed memory,
// not of its fill.
func shed(ring, gone []arc.Memory, n int, goes func(arc.Memory) bool) ([]arc.Memory, []arc.Memory) {
	end, cut := 0, 0
	for ; end < len(ring) && cut < n; end++ {
		if goes(ring[end]) {
			gone = append(gone, ring[end])
			cut++
		}
	}
	to := end
	for i := end - 1; i >= 0; i-- {
		if !goes(ring[i]) {
			to--
			ring[to] = ring[i]
		}
	}
	return ring[to:], gone
}

// ringIndex is the memory ring by kind, each kind's memories in ring
// order, so a predicate's recall costs the memories of the kind it asks
// for and not the ring's fill.
type ringIndex struct {
	head  *arc.Memory // the ring it indexes, by its first memory and length
	n     int
	kinds map[string][]arc.Memory
}

// ring is the story's ring index, built afresh when it does not index the
// ring the story holds.
func (s *Story) ring() *ringIndex {
	if x := s.kinds; x != nil && x.indexes(s.Memory) {
		return x
	}
	x := &ringIndex{kinds: map[string][]arc.Memory{}}
	for _, m := range s.Memory {
		x.kinds[m.Kind] = append(x.kinds[m.Kind], m)
	}
	x.mark(s.Memory)
	s.kinds = x
	return x
}

func (x *ringIndex) indexes(ring []arc.Memory) bool {
	return x.n == len(ring) && (x.n == 0 || x.head == &ring[0])
}

func (x *ringIndex) mark(ring []arc.Memory) {
	x.n, x.head = len(ring), nil
	if len(ring) > 0 {
		x.head = &ring[0]
	}
}

// of is the ring's memories of a kind, oldest first, for reading only.
func (x *ringIndex) of(kind string) []arc.Memory { return x.kinds[kind] }

// add indexes a memory appended to the ring.
func (x *ringIndex) add(m arc.Memory, ring []arc.Memory) {
	x.kinds[m.Kind] = append(x.kinds[m.Kind], m)
	x.mark(ring)
}

// drop unindexes memories gone from the ring, in ring order. Each kind
// loses its oldest, so a memory that is not its kind's oldest leaves the
// index stale, and the next read rebuilds it.
func (x *ringIndex) drop(gone []arc.Memory, ring []arc.Memory) {
	for _, m := range gone {
		k := x.kinds[m.Kind]
		if len(k) == 0 || k[0].Fact != m.Fact || k[0].Tick != m.Tick {
			x.n, x.head = -1, nil
			return
		}
		x.kinds[m.Kind] = k[1:]
	}
	x.mark(ring)
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
// scarcity under seam-below, and how long its holder has held it; and
// each faction's days starving. A day without the condition resets it.
func (g *Game) streaksDay(_ int64) {
	s := g.Story
	if s == nil {
		return
	}
	if n := len(g.World.Factions); len(s.Starving) < n {
		s.Starving = append(s.Starving, make([]int64, n-len(s.Starving))...)
	}
	for i := range g.World.Factions {
		s.Starving[i] = run(s.Starving[i], g.World.Factions[i].Starving)
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
		if st.Holder != reg.Holder {
			st.Holder, st.Held = reg.Holder, 0
		}
		if reg.Holder >= 0 {
			st.Held++
		}
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
