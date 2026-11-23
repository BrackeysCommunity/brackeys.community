package game

import (
	"maps"
	"slices"
	"strconv"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// storyGame is a new world with its story running.
func storyGame(t *testing.T) *Game {
	t.Helper()
	g := guardGame(t)
	if g.Story == nil {
		t.Fatal("a new world has no story")
	}
	return g
}

// storyFact is a logged-looking fact of kind at tick, weighed by the sheet.
func storyFact(t *testing.T, g *Game, id fact.ID, tick int64, kind string, subjects []fact.Ref, data ...fact.Datum) fact.Fact {
	t.Helper()
	f, err := g.r.weights.New(tick, kind, world.RegionRef(0), subjects, nil, data...)
	if err != nil {
		t.Fatal(err)
	}
	if err := fact.Normalize(&f); err != nil {
		t.Fatal(err)
	}
	f.ID = id
	return f
}

// TestMemoryBoundedOverTenThousandFacts feeds the ring ten thousand facts a
// tick apart, heavy and light: it never holds more than memory-kept, keeps
// the newest heavy ones, drops the light ones, and forgets everything
// memory-days on.
func TestMemoryBoundedOverTenThousandFacts(t *testing.T) {
	g := storyGame(t)
	p := g.r.Story
	const facts = 10000
	start := g.Tick()
	var kept []fact.ID
	for i := range facts {
		tick := start + int64(i)
		g.World.Tick = tick
		kind := "hunt.slain" // heavy, and no story kind
		switch i % 4 {
		case 1:
			kind = "beat.won"
		case 2:
			kind = factVowBroken // light: its oath is pended before the weight test
		}
		f := storyFact(t, g, fact.ID(i+1), tick, kind, nil)
		if f.Weight >= p.MemoryWeight || slices.Contains(storyKinds, kind) {
			kept = append(kept, f.ID)
		}
		g.noteStory([]fact.Fact{f})
		if int64(len(g.Story.Memory)) > p.MemoryKept {
			t.Fatalf("after %d facts the ring holds %d, over %d", i+1, len(g.Story.Memory), p.MemoryKept)
		}
		if i%97 == 0 {
			ringIndexed(t, g)
		}
	}
	if int64(len(g.Story.Memory)) != p.MemoryKept {
		t.Fatalf("the ring holds %d, want it full at %d", len(g.Story.Memory), p.MemoryKept)
	}
	want := kept[len(kept)-int(p.MemoryKept):]
	var got []fact.ID
	for _, m := range g.Story.Memory {
		got = append(got, m.Fact)
		if m.Kind == "beat.won" || m.Kind == factVowBroken {
			t.Fatal("a light fact was remembered")
		}
	}
	if !slices.Equal(got, want) {
		t.Fatalf("the ring kept %v…, want the newest %v…", got[:3], want[:3])
	}
	g.World.Tick += (p.MemoryDays + 1) * sheets.TicksPerDay
	g.noteStory(nil)
	if len(g.Story.Memory) != 0 {
		t.Fatalf("%d memories outlived memory-days", len(g.Story.Memory))
	}
}

// TestMemoryCapSparesStoryKinds: heavy per-character facts past
// memory-kept push out their own kind, never an older holding.fell.
func TestMemoryCapSparesStoryKinds(t *testing.T) {
	g := storyGame(t)
	p := g.r.Story
	start := g.Tick()
	g.noteStory([]fact.Fact{storyFact(t, g, 1, start, "holding.fell", nil)})
	for i := range 2 * p.MemoryKept {
		g.World.Tick = start + 1 + i
		g.noteStory([]fact.Fact{storyFact(t, g, fact.ID(i+2), g.Tick(), "hunt.slain", []fact.Ref{char.Ref("c-1")})})
	}
	if n := int64(len(g.Story.Memory)); n != p.MemoryKept || g.Story.Memory[0].Kind != "holding.fell" {
		t.Fatalf("the ring holds %d, first %+v", n, g.Story.Memory[0])
	}
	ringIndexed(t, g)
}

// ringIndexed checks the kept ring index against the ring, then that a
// rebuilt one reads the same.
func ringIndexed(t *testing.T, g *Game) {
	t.Helper()
	s := g.Story
	kept := s.kinds
	if kept == nil || !kept.indexes(s.Memory) {
		t.Fatal("the ring index does not index the ring")
	}
	s.kinds = nil
	fresh := s.ring()
	for _, k := range slices.Sorted(maps.Keys(fresh.kinds)) {
		if !slices.EqualFunc(kept.of(k), fresh.of(k), func(a, b arc.Memory) bool { return a.Fact == b.Fact && a.Tick == b.Tick }) {
			t.Fatalf("kind %s indexes %d memories, the ring holds %d", k, len(kept.of(k)), len(fresh.of(k)))
		}
	}
	for k, ms := range kept.kinds {
		if len(ms) != len(fresh.of(k)) {
			t.Fatalf("kind %s indexes %d memories the ring does not hold", k, len(ms))
		}
	}
}

// TestMemoryCapBoundsStoryKinds: story kinds alone past memory-kept are
// held to it, the oldest dropped.
func TestMemoryCapBoundsStoryKinds(t *testing.T) {
	g := storyGame(t)
	p := g.r.Story
	start := g.Tick()
	n := 2 * p.MemoryKept
	for i := range n {
		g.World.Tick = start + i
		f := storyFact(t, g, fact.ID(i+1), g.Tick(), "structure.raised", nil, fact.N(datumSettlement, 0))
		if i == 0 && f.Weight < p.MemoryWeight {
			t.Fatalf("structure.raised weighs %d, under memory-weight", f.Weight)
		}
		g.noteStory([]fact.Fact{f})
	}
	ringIndexed(t, g)
	m := g.Story.Memory
	if int64(len(m)) != p.MemoryKept {
		t.Fatalf("the ring holds %d, want %d", len(m), p.MemoryKept)
	}
	if want := fact.ID(n - p.MemoryKept + 1); m[0].Fact != want || m[len(m)-1].Fact != fact.ID(n) {
		t.Fatalf("the ring runs %d..%d, want %d..%d", m[0].Fact, m[len(m)-1].Fact, want, n)
	}
}

// TestMemoryForgetsStaleCandidates: a thread candidate older than
// memory-days leaves the queue.
func TestMemoryForgetsStaleCandidates(t *testing.T) {
	g := storyGame(t)
	g.pend(arc.Pending{Kind: arc.PendReturn, Char: "c-1", Tick: g.Tick()})
	g.World.Tick += g.r.Story.MemoryDays * sheets.TicksPerDay
	g.noteStory(nil)
	if len(g.Story.Pending) != 1 {
		t.Fatal("a candidate memory-days old was dropped")
	}
	g.World.Tick += sheets.TicksPerDay
	g.pend(arc.Pending{Kind: arc.PendReturn, Char: "c-1", Tick: g.Tick()})
	g.noteStory(nil)
	if len(g.Story.Pending) != 1 || g.Story.Pending[0].Tick != g.Tick() {
		t.Fatalf("the queue after memory-days is %+v", g.Story.Pending)
	}
}

// TestStarvingDaysCounted: a faction that just began starving has starved a
// day though the ring remembers none of it, and the count grows each day.
func TestStarvingDaysCounted(t *testing.T) {
	g := storyGame(t)
	g.World.Factions[0].Starving = true
	if n := g.storyView().Factions()[0].StarvingDays; n != 1 {
		t.Fatalf("just starving: %d days", n)
	}
	g.streaksDay(0)
	g.streaksDay(0)
	if n := g.storyView().Factions()[0].StarvingDays; n != 2 {
		t.Fatalf("two days starving: %d days", n)
	}
	g.World.Factions[0].Starving = false
	g.streaksDay(0)
	g.World.Factions[0].Starving = true
	if n := g.storyView().Factions()[0].StarvingDays; n != 1 {
		t.Fatalf("starving again: %d days", n)
	}
}

// TestHeldDaysSinceTaken: a region that changed hands has been held no days
// by its new holder, and a day more each day it keeps it.
func TestHeldDaysSinceTaken(t *testing.T) {
	g := storyGame(t)
	if len(g.World.Factions) < 2 {
		t.Fatal("fewer than two factions")
	}
	reg := &g.World.Regions[0]
	reg.Holder = 0
	g.streaksDay(0)
	g.streaksDay(0)
	if n := g.heldDays(0, 0); n != 2 {
		t.Fatalf("held two days: %d", n)
	}
	reg.Holder = 1
	if n := g.heldDays(1, 0); n != 0 {
		t.Fatalf("just taken: %d days", n)
	}
	for day := int64(1); day <= 3; day++ {
		g.streaksDay(0)
		if n := g.heldDays(1, 0); n != day {
			t.Fatalf("held %d days, counted %d", day, n)
		}
	}
	if n := g.heldDays(0, 0); n != 0 {
		t.Fatalf("the old holder still holds it %d days", n)
	}
}

// TestMemoryLocatesAndNumbers: a memory is located on its tile, else at
// the place its settlement datum names, and carries lapsed or n.
func TestMemoryLocatesAndNumbers(t *testing.T) {
	g := storyGame(t)
	place := g.Places[0].Hex
	tileAt := place.Add(hex.Hex{Q: 1})
	ended := storyFact(t, g, 1, g.Tick(), "arc.ended", []fact.Ref{{Kind: "scope", ID: arc.ScopeWorld}}, fact.B(datumLapsed, true))
	raised := storyFact(t, g, 2, g.Tick(), "structure.raised", nil, fact.N(datumSettlement, 0), fact.N("tier", 2))
	onTile := storyFact(t, g, 3, g.Tick(), "faction.raided", nil, append(fact.At(tileAt), fact.N(datumN, 7))...)
	g.noteStory([]fact.Fact{ended, raised, onTile})
	m := g.Story.Memory
	if len(m) != 3 || m[0].N != 1 || m[0].Region != 0 || len(m[0].Subjects) != 1 {
		t.Fatalf("arc.ended remembered as %+v", m)
	}
	if m[1].At != place || m[1].N != 0 {
		t.Fatalf("structure.raised remembered at %v, the place is at %v", m[1].At, place)
	}
	if m[2].At != tileAt || m[2].N != 7 {
		t.Fatalf("a tiled fact remembered as %+v", m[2])
	}
	if got := g.storyView().Recall("arc.ended", 0); len(got) != 1 || got[0].Fact != 1 {
		t.Fatalf("recall of today's arc.ended: %+v", got)
	}
	if pv := g.storyView().Places()[0]; pv.Raised != g.Tick() {
		t.Fatalf("the place was raised at %d, its view says %d", g.Tick(), pv.Raised)
	}
}

// TestMemoryPendsTheOath: a broken vow queues an oath on its board, and
// the queue keeps only the newest pending-kept.
func TestMemoryPendsTheOath(t *testing.T) {
	g := storyGame(t)
	x := &Goal{ID: "q-1", Board: 0}
	g.Goals = append(g.Goals, x)
	f := storyFact(t, g, 9, g.Tick(), factVowBroken, []fact.Ref{char.Ref("c-1"), goalRef(x.ID)})
	g.noteStory([]fact.Fact{f})
	want := arc.Pending{Kind: arc.PendOath, Char: "c-1", Ref: arc.SettlementRef(0), Tick: g.Tick(), Fact: 9}
	if got := g.storyView().Pending(arc.PendOath); len(got) != 1 || got[0] != want {
		t.Fatalf("the oath pending is %+v, want %+v", got, want)
	}
	for i := range 2 * g.r.Story.PendingKept {
		g.pend(arc.Pending{Kind: arc.PendReturn, Char: "c-2", Tick: i})
	}
	if n := int64(len(g.Story.Pending)); n != g.r.Story.PendingKept || g.Story.Pending[0].Tick != g.r.Story.PendingKept {
		t.Fatalf("the queue holds %d from tick %d", n, g.Story.Pending[0].Tick)
	}
}

// TestStreaksCountAndReset: each streak counts the days its condition
// held and goes back to nothing on a day it does not.
func TestStreaksCountAndReset(t *testing.T) {
	g := storyGame(t)
	reg := &g.World.Regions[0]
	prosperity, scarcity := g.World.GaugeIndex("prosperity"), g.World.GaugeIndex("scarcity")
	kind := func(tag string) int {
		return slices.IndexFunc(g.r.Book.Weather, func(w sheets.WeatherKind) bool { return slices.Contains(w.TileTags, tag) })
	}
	cold, wet := kind("cold"), kind("wet")
	if cold < 0 || wet < 0 {
		t.Fatal("no cold or wet weather in the sheet")
	}
	set := func(prosper, scarce, frost, storm int64) {
		reg.Gauge[prosperity], reg.Gauge[scarcity] = prosper, scarce
		reg.Weather = make([]int64, len(g.r.Book.Weather))
		reg.Weather[cold], reg.Weather[wet] = frost, storm
	}
	p := g.r.Story
	line := g.sp("city-prosperity")
	for range 3 {
		set(line, p.SeamBelow-1, p.ColdShare, p.WetShare)
		g.streaksDay(0)
	}
	v := g.storyView()
	for _, s := range []string{arc.StreakProsper, arc.StreakCold, arc.StreakWet, arc.StreakLow} {
		if n := v.Streak(0, s); n != 3 {
			t.Fatalf("%s ran %d days, want 3", s, n)
		}
	}
	set(line-1, p.SeamBelow, p.ColdShare-1, p.WetShare)
	g.streaksDay(0)
	for s, want := range map[string]int64{arc.StreakProsper: 0, arc.StreakCold: 0, arc.StreakWet: 4, arc.StreakLow: 0} {
		if n := v.Streak(0, s); n != want {
			t.Fatalf("%s at %d after a day off, want %d", s, n, want)
		}
	}
	if len(g.Story.Streaks) != len(g.World.Regions) {
		t.Fatalf("%d streaks for %d regions", len(g.Story.Streaks), len(g.World.Regions))
	}
}

// TestStoryViewBusy: a rest and an open arc's cast, regions, place and
// character are busy at their own scope only, and stop being so.
func TestStoryViewBusy(t *testing.T) {
	g := storyGame(t)
	v := g.storyView()
	now := g.Tick()
	g.Story.Rests = []ScopeRest{{Scope: arc.Region, Ref: arc.RegionRef(3), Until: now + 1}}
	a := &Arc{ID: "arc-1", Scope: arc.Region, Cast: arc.Cast{{Role: "front", Ref: arc.RegionRef(1)}}, Regions: []int{1, 2}}
	g.Story.Arcs = []*Arc{a, {ID: "arc-2", Scope: arc.Settlement, Place: arc.SettlementRef(0).String()},
		{ID: "arc-3", Scope: arc.Personal, Char: "c-1"}}
	for _, c := range []struct {
		scope string
		ref   fact.Ref
		want  bool
	}{
		{arc.Region, arc.RegionRef(1), true},
		{arc.Region, arc.RegionRef(2), true},
		{arc.Region, arc.RegionRef(3), true},
		{arc.Region, arc.RegionRef(4), false},
		{arc.ScopeWorld, arc.RegionRef(1), false},
		{arc.Settlement, arc.SettlementRef(0), true},
		{arc.Settlement, arc.SettlementRef(1), false},
		{arc.Personal, char.Ref("c-1"), true},
		{arc.Personal, char.Ref("c-2"), false},
	} {
		if got := v.Busy(c.scope, c.ref); got != c.want {
			t.Fatalf("Busy(%s, %s) = %v", c.scope, c.ref, got)
		}
	}
	g.World.Tick++
	a.Ended, a.Outcome = g.Tick(), outcomeLapsed
	if v.Busy(arc.Region, arc.RegionRef(1)) || v.Busy(arc.Region, arc.RegionRef(3)) {
		t.Fatal("an ended arc or a rest run out is still busy")
	}
}

// TestStoryViewReadsTheWorld: the view's regions, factions and places are
// the world's.
func TestStoryViewReadsTheWorld(t *testing.T) {
	g := storyGame(t)
	v := g.storyView()
	if len(v.Awake()) != len(g.World.Regions) || v.Day() != g.Tick()/sheets.TicksPerDay {
		t.Fatal("the view's day or regions differ from the world's")
	}
	if r := v.RegionOf(g.Places[0].Hex); r != g.World.RegionAt(g.Places[0].Hex) || v.RegionOf(v.RegionHex(r)) != r {
		t.Fatalf("region %d's centre is not in it", r)
	}
	if n, ok := v.NearestPlace(g.Places[0].Hex); !ok || n != 0 {
		t.Fatalf("the place nearest the first is %d", n)
	}
	fs := v.Factions()
	if len(fs) != len(g.World.Factions) {
		t.Fatalf("%d faction views for %d factions", len(fs), len(g.World.Factions))
	}
	for i, f := range fs {
		for _, r := range f.Holdings {
			if v.Holder(r) != i {
				t.Fatalf("faction %d holds region %d, whose holder is %d", i, r, v.Holder(r))
			}
		}
		leads := 0
		for _, n := range f.Notables {
			if n.Leading {
				leads++
			}
		}
		if leads > 1 {
			t.Fatalf("faction %d has %d leaders", i, leads)
		}
	}
	if from := v.LineFrom("threat"); from != world.LineAt(g.r.Book, "ambush") {
		t.Fatalf("threat's lowest line is %d", from)
	}
	c := mustCreate(t, g, "u", "knife")
	c.Visits = []Visit{{Settlement: 0, Tick: g.Tick()}}
	ps := g.placeStory(len(g.Places) - 1)
	ps.Lost, ps.Followed = 2, g.Tick()+1
	v = g.storyView()
	if pv := v.Places()[len(g.Places)-1]; pv.Lost != 2 || v.Followed(len(g.Places)-1) != g.Tick()+1 {
		t.Fatalf("the last place's story views as %+v", pv)
	}
	if pv := v.Places()[0]; pv.Users != 1 || !pv.Open || pv.Ruined {
		t.Fatalf("the first place views as %+v", pv)
	}
}

// BenchmarkForgetFullRing: a tick's forgetting costs what leaves the ring,
// not how full it is.
func BenchmarkForgetFullRing(b *testing.B) {
	bk, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		b.Fatal(err)
	}
	r, err := NewRules(bk, keys.Throwaway("forget"))
	if err != nil {
		b.Fatal(err)
	}
	g, err := New(r)
	if err != nil {
		b.Fatal(err)
	}
	p := g.r.Story
	for _, n := range []int64{p.MemoryKept / 4, p.MemoryKept} {
		b.Run(strconv.FormatInt(n, decimal), func(b *testing.B) {
			g.Story.Memory = g.Story.Memory[:0]
			for i := range n {
				g.Story.Memory = append(g.Story.Memory, arc.Memory{Fact: fact.ID(i + 1), Tick: g.Tick(), Kind: "hunt.slain", Region: -1})
			}
			for range b.N {
				g.forget()
			}
		})
	}
}
