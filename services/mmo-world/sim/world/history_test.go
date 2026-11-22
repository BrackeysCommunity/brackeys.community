package world

import (
	"cmp"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/history"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
)

// historyWorld founds a world that draws content from history.
func historyWorld(t testing.TB, label string) *State {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	k := keys.Throwaway(label)
	g, err := gen.New(b, k.Generation)
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(b, g, k.Roll)
	if err != nil {
		t.Fatal(err)
	}
	s.ContentVersion = ContentDrawn
	return s
}

func heavyAt(id fact.ID, kind string, tick, weight int64, at hex.Hex) fact.Fact {
	return fact.Fact{ID: id, Tick: tick, Kind: kind, Weight: weight, Data: fact.At(at)}
}

// The index keeps the newest history-cell-kept entries of each cell, in
// (tick, id) order, skips what it must, keeps cells in (I, J) order, and
// the day's prune drops what no digest can read and the cells left empty.
func TestNoteBounds(t *testing.T) {
	s := historyWorld(t, "history-note-bounds")
	b := s.bounds()
	at := hex.Hex{Q: 200, R: -150}
	var fs []fact.Fact
	for i := range 3 * b.CellKept {
		// Ticks run backwards and repeat, so the order noted is not the order kept.
		fs = append(fs, heavyAt(fact.ID(100+i), "faction.raided", 1000-i/2, b.Weight, at))
	}
	s.Note(fs...)
	s.Note(fs[len(fs)-1], fs[0]) // noted twice: kept once
	if len(s.History) != 1 {
		t.Fatalf("one cell's facts filled %d cells", len(s.History))
	}
	c := s.History[0]
	if ci, cj := b.CellOf(at); c.I != ci || c.J != cj {
		t.Fatalf("cell (%d, %d), want (%d, %d)", c.I, c.J, ci, cj)
	}
	if int64(len(c.Facts)) != b.CellKept {
		t.Fatalf("cell holds %d, want the cap %d", len(c.Facts), b.CellKept)
	}
	if !slices.IsSortedFunc(c.Facts, olderFirst) {
		t.Fatal("cell not oldest first")
	}
	want := slices.Clone(fs)
	slices.SortFunc(want, func(x, y fact.Fact) int { return cmp.Or(cmp.Compare(x.Tick, y.Tick), cmp.Compare(x.ID, y.ID)) })
	want = want[len(want)-int(b.CellKept):]
	for k, e := range c.Facts {
		if e.ID != int64(want[k].ID) || e.Tick != want[k].Tick || e.At != at || e.Kind != "faction.raided" || e.Weight != b.Weight {
			t.Fatalf("entry %d is %+v, want fact %d at tick %d", k, e, want[k].ID, want[k].Tick)
		}
	}

	// Light, pin and placeless facts are never indexed; a region's fact
	// stands at the region's centre.
	far := hex.Hex{Q: -40, R: 17}
	s.Note(
		heavyAt(1, "region.surge", 5, b.Weight-1, far),
		heavyAt(2, "pin.landed", 5, b.Weight+5, far),
		fact.Fact{ID: 3, Tick: 5, Kind: "season.turned", Weight: b.Weight + 5},
		fact.Fact{ID: 4, Tick: 5, Kind: "world.week", Weight: b.Weight + 5, Region: "r-999"},
		fact.Fact{ID: 5, Tick: 5, Kind: "region.surge", Weight: b.Weight, Region: RegionRef(0)},
	)
	if len(s.History) != 2 {
		t.Fatalf("after the skipped facts and one region fact: %d cells, want 2", len(s.History))
	}
	ri, rj := b.CellOf(s.centre(0))
	if c := s.cell(ri, rj, false); c == nil || !slices.ContainsFunc(c.Facts, func(e history.Heavy) bool { return e.ID == 5 && e.At == s.centre(0) }) {
		t.Fatal("a region's fact is not at its centre")
	}

	// Cells stay in (I, J) order however they arrive.
	for k := range int64(12) {
		h := hex.Hex{Q: (k*37)%11*b.Radius - 30, R: (k*53)%7*b.Radius - 20}
		s.Note(heavyAt(fact.ID(5000+k), "holding.fell", 2000+k, b.Weight, h))
	}
	if !slices.IsSortedFunc(s.History, func(x, y HistoryCell) int { return cmp.Or(cmp.Compare(x.I, y.I), cmp.Compare(x.J, y.J)) }) {
		t.Fatal("cells out of (I, J) order")
	}

	// The prune at a day's turn.
	s.Tick = 1000 + b.Ticks - 4
	s.pruneHistory()
	for _, c := range s.History {
		if len(c.Facts) == 0 {
			t.Fatalf("an empty cell (%d, %d) is kept", c.I, c.J)
		}
		for _, e := range c.Facts {
			if e.Tick < s.Tick-b.Ticks {
				t.Fatalf("entry at tick %d kept past the window from %d", e.Tick, s.Tick-b.Ticks)
			}
		}
	}
	if c := s.cell(ri, rj, false); c != nil && slices.ContainsFunc(c.Facts, func(e history.Heavy) bool { return e.ID == 5 }) {
		t.Fatal("the tick-5 fact outlived the window")
	}
	ai, aj := b.CellOf(at)
	if full := s.cell(ai, aj, false); full == nil || len(full.Facts) != 10 {
		t.Fatalf("the full cell should keep its 10 entries at ticks 996 to 1000, kept %v", full)
	}
	s.Tick += b.Ticks * b.Ticks
	s.pruneHistory()
	if len(s.History) != 0 {
		t.Fatalf("%d cells outlived every entry", len(s.History))
	}
}

// Every located heavy fact a world-only run writes is indexed once: at
// every day's end the index is exactly the newest history-cell-kept of
// each cell within the window, as read back from the log.
func TestNotedOnce(t *testing.T) {
	s := historyWorld(t, "history-noted-once")
	log := &fact.Mem{}
	b := s.bounds()
	type cellKey struct{ I, J int64 }
	ever := map[int64]bool{}
	for day := range 60 {
		if err := s.AdvanceDay(log); err != nil {
			t.Fatal(err)
		}
		want := map[cellKey][]history.Heavy{}
		for _, f := range log.Since(0) {
			if !b.Indexed(f.Kind, f.Weight) || f.Tick < s.Tick-b.Ticks {
				continue
			}
			at, ok := fact.HexOf(f)
			if !ok {
				r, isRegion := ParseRegionRef(f.Region)
				if !isRegion || r < 0 || r >= len(s.Regions) {
					continue
				}
				at = s.g.Region(s.Regions[r].Lattice).Centre
			}
			i, j := b.CellOf(at)
			want[cellKey{i, j}] = append(want[cellKey{i, j}], history.Heavy{ID: int64(f.ID), Kind: f.Kind, Tick: f.Tick, Weight: f.Weight, At: at})
		}
		ids := map[int64]bool{}
		for _, c := range s.History {
			w := want[cellKey{c.I, c.J}]
			slices.SortFunc(w, olderFirst)
			if int64(len(w)) > b.CellKept {
				w = w[len(w)-int(b.CellKept):]
			}
			if !slices.Equal(c.Facts, w) {
				t.Fatalf("day %d: cell (%d, %d) holds %v, want %v", day+1, c.I, c.J, c.Facts, w)
			}
			delete(want, cellKey{c.I, c.J})
			for _, e := range c.Facts {
				if ids[e.ID] {
					t.Fatalf("day %d: fact %d indexed twice", day+1, e.ID)
				}
				ids[e.ID], ever[e.ID] = true, true
			}
		}
		if len(want) > 0 {
			t.Fatalf("day %d: %d cells of located heavy facts missing from the index", day+1, len(want))
		}
	}
	if len(ever) == 0 {
		t.Fatal("a 60-day run wrote no located heavy fact: the test proves nothing")
	}
	t.Logf("%d facts indexed over 60 days, %d cells at the end", len(ever), len(s.History))
}

// However many facts and pins a world holds, a digest visits at most
// 9 × history-cell-kept entries, one disc of tiles, 9 × pins-per-cell pins
// and a handful of finds per region, and that maximum is the same on day
// 300 as once the window first filled.
func TestDigestBounded(t *testing.T) {
	s := historyWorld(t, "history-digest-bounded")
	b := s.bounds()
	const (
		facts  = 100_000
		days   = 300
		spread = 30
		pins   = 64
		sample = 200
	)
	centre := s.g.Settlement(0).Hex
	disc := hex.DiscAt(centre, spread)
	rng := rand.New(rand.NewPCG(1, 2))
	kinds := []string{"faction.raided", "region.surge", "holding.fell", "hunt.slain", "region.overrun"}
	ticks := make([]int64, facts)
	for k := range ticks {
		ticks[k] = sheets.TicksPerDay + rng.Int64N(days*sheets.TicksPerDay)
	}
	slices.Sort(ticks)

	// 64 pins on an 8 × 8 grid round the disc: at most four in any pin cell.
	for k := range int64(pins) {
		at := centre.Add(hex.Hex{Q: (k%8)*6 - 24, R: (k/8)*6 - 24})
		s.Pins = append(s.Pins, Pin{
			ID: fmt.Sprintf("pin-%d", k+1), At: at, Reach: 12,
			Fix: tile.Fix{SiteKind: "den"}, By: PinBy{Role: PinDesigner}, Tick: 1,
		})
	}
	s.pinCells = nil

	tiles := make([]hex.Hex, sample)
	for k := range tiles {
		tiles[k] = disc[rng.IntN(len(disc))]
	}
	most := func(t int64) int64 {
		var m int64
		for _, h := range tiles {
			_, c := s.DigestCost(h, t)
			m = max(m, c)
		}
		return m
	}
	bound := b.CostBound()

	next := 0
	var day1, full int64
	for day := int64(1); day <= days; day++ {
		end := (day + 1) * sheets.TicksPerDay
		var batch []fact.Fact
		for ; next < facts && ticks[next] < end; next++ {
			batch = append(batch, heavyAt(fact.ID(next+1), kinds[rng.IntN(len(kinds))], ticks[next], b.Weight+rng.Int64N(20), disc[rng.IntN(len(disc))]))
		}
		s.Note(batch...)
		s.Tick = end
		s.pruneHistory()
		switch day {
		case 1:
			day1 = most(s.Tick)
		case b.Ticks / sheets.TicksPerDay:
			full = most(s.Tick)
		}
	}
	if next != facts {
		t.Fatalf("noted %d facts of %d", next, facts)
	}
	day300 := most(s.Tick)
	t.Logf("most visited: day 1 %d, window full %d, day 300 %d; bound %d; %d cells kept", day1, full, day300, bound, len(s.History))
	for _, c := range []int64{day1, full, day300} {
		if c > bound {
			t.Fatalf("a digest visited %d, past the bound %d", c, bound)
		}
	}
	if day300 != full {
		t.Fatalf("day 300's digest visits %d, the window's first full day %d: the cost grew with age", day300, full)
	}
	if day1 > day300 {
		t.Fatalf("day 1 visited %d, more than day 300's %d", day1, day300)
	}
	for _, c := range s.History {
		if int64(len(c.Facts)) > b.CellKept {
			t.Fatalf("cell (%d, %d) holds %d entries", c.I, c.J, len(c.Facts))
		}
	}
}

// A digest read at tick t sees nothing written at t: not a fact, not a
// find. So two arrivals on one tile in one tick read the same history.
func TestDigestBeforeTick(t *testing.T) {
	s := historyWorld(t, "history-before-tick")
	b := s.bounds()
	h := s.g.Settlement(0).Hex.Add(hex.Hex{Q: 2, R: -1})
	at := int64(40 * sheets.TicksPerDay)
	before := s.DigestAt(h, at)

	s.Note(heavyAt(9001, "faction.raided", at, b.Weight, h.Add(hex.Hex{Q: 1})))
	if got := s.DigestAt(h, at); got.Key() != before.Key() || got.Count("faction.raided") != before.Count("faction.raided") {
		t.Fatal("a fact written at t was read at t")
	}
	if got := s.DigestAt(h, at+1).Count("faction.raided"); got != before.Count("faction.raided")+1 {
		t.Fatalf("the fact is not read a tick later: %d", got)
	}

	s.Finds = append(s.Finds, Find{Key: "~test", Kind: "pattern", Region: s.g.RegionOf(h), Tick: at})
	if got := s.DigestAt(h, at); got.Found("pattern") != before.Found("pattern") {
		t.Fatal("a find made at t was read at t")
	}
	if got := s.DigestAt(h, at+1).Found("pattern"); got != min(before.Found("pattern")+1, b.KindMost) {
		t.Fatalf("the find is not read a tick later: %d", got)
	}

	// The window's far edge: a fact exactly history-days old is read, one
	// tick older is not.
	edge := at + b.Ticks
	s.Note(heavyAt(9002, "holding.fell", at, b.Weight, h))
	if s.DigestAt(h, edge).Count("holding.fell") != 1 || s.DigestAt(h, edge+1).Count("holding.fell") != 0 {
		t.Fatal("the window's edges moved")
	}
}

// The digest's other parts: the tile's own region's bands, the pressure
// of the factions holding regions in reach, and nothing once dormant.
func TestDigestParts(t *testing.T) {
	s := historyWorld(t, "history-digest-parts")
	home := s.g.Settlement(0).Hex
	d := s.DigestAt(home, s.Tick+1)
	if len(d.Bands) != len(s.b.Gauges) {
		t.Fatalf("%d bands for %d gauges", len(d.Bands), len(s.b.Gauges))
	}
	r := s.RegionAt(home)
	for i, g := range s.b.Gauges {
		if want := history.BandOf(s.b.GaugeLines, g.ID, s.Regions[r].Gauge[i]); d.Bands[i] != want {
			t.Errorf("%s band %d, want %d", g.ID, d.Bands[i], want)
		}
	}
	threat := s.GaugeIndex("threat")
	s.Regions[r].Gauge[threat] = 1000
	if got := s.DigestAt(home, s.Tick+1).Band(threat); got == 0 {
		t.Fatal("threat at its top left the band at 0")
	}

	f := s.Factions[0]
	seat := s.centre(f.Seat)
	p := s.DigestAt(seat, s.Tick+1).Faction
	if p.Holders == 0 || !slices.Contains(p.Archetypes, f.Archetype) || p.Holders > s.bounds().HoldersMost {
		t.Fatalf("pressure at a seat: %+v", p)
	}
	if !slices.IsSorted(p.Archetypes) {
		t.Fatal("archetypes unsorted")
	}
	if len(s.Factions[0].Grudge) > 0 {
		s.Factions[0].Grudge[0] = 3
		s.Factions[0].Starving = true
		if p := s.DigestAt(seat, s.Tick+1).Faction; !p.War || !p.Starving {
			t.Fatalf("a grudge and hunger did not show: %+v", p)
		}
	}

	far := home.Add(hex.Hex{Q: 400, R: -200})
	if d := s.DigestAt(far, s.Tick+1); slices.ContainsFunc(d.Bands, func(v int64) bool { return v != 0 }) || d.Faction.Holders != 0 {
		t.Fatalf("a dormant tile read %+v", d)
	}
}

// A world from before content was drawn from history notes nothing, so
// its state and digest are as they were without noting at all.
func TestNoteV0(t *testing.T) {
	s := historyWorld(t, "history-note-v0")
	s.ContentVersion = ContentNative
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	log := &fact.Mem{}
	for range 10 {
		if err := s.AdvanceDay(log); err != nil {
			t.Fatal(err)
		}
	}
	if len(s.History) != 0 {
		t.Fatalf("a v0 world indexed %d cells", len(s.History))
	}
	before, err := Digest(s, log)
	if err != nil {
		t.Fatal(err)
	}
	s.Note(log.Since(0)...)
	after, err := Digest(s, log)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("noting on a v0 world changed its digest")
	}
	out, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), `"history"`) || strings.Contains(string(out), `"contentVersion"`) {
		t.Fatal("a v0 snapshot carries the new fields")
	}

	// The same start at v1 does index: the v0 run is quiet by the switch,
	// not for want of facts.
	var v1 State
	if err := json.Unmarshal(raw, &v1); err != nil {
		t.Fatal(err)
	}
	k := keys.Throwaway("history-note-v0")
	v1.Attach(s.b, s.g, k.Roll)
	v1.ContentVersion = ContentDrawn
	log1 := &fact.Mem{}
	for range 10 {
		if err := v1.AdvanceDay(log1); err != nil {
			t.Fatal(err)
		}
	}
	if len(v1.History) == 0 {
		t.Fatal("the v1 twin indexed nothing either: the test proves nothing")
	}
}
