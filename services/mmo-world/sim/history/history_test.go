package history

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

var bounds = Bounds{Weight: 40, Radius: 6, Ticks: 28 * sheets.TicksPerDay, CellKept: 32, KindMost: 8, HoldersMost: 3, PinsMost: 8, PinsPerCell: 8}

const now = 100 * sheets.TicksPerDay

func heavy(id int64, kind string, tick int64, at hex.Hex) Heavy {
	return Heavy{ID: id, Kind: kind, Tick: tick, Weight: 45, At: at}
}

func TestFactsWindow(t *testing.T) {
	at := hex.Hex{Q: 3, R: -2}
	cell := []Heavy{
		heavy(1, "faction.raided", now, at),              // the tick being drawn: not yet history
		heavy(2, "faction.raided", now-1, at),            // the tick before
		heavy(3, "faction.raided", now-bounds.Ticks, at), // the window's first tick
		heavy(4, "faction.raided", now-bounds.Ticks-1, at),
		heavy(5, "faction.raided", now+1, at),
	}
	got := Facts(at, now, bounds, cell)
	if want := []Count{{Kind: "faction.raided", N: 2}}; !slices.Equal(got, want) {
		t.Fatalf("window: got %v, want %v", got, want)
	}
}

func TestFactsRadius(t *testing.T) {
	at := hex.Hex{Q: -4, R: 7}
	var cell []Heavy
	for i, d := range []int64{0, 1, bounds.Radius, bounds.Radius + 1, 2 * bounds.Radius} {
		cell = append(cell, heavy(int64(i), "region.surge", now-1, at.Add(hex.Direction(i%hex.Directions).Scale(d))))
	}
	// Off the axis: at distance Radius by a bent path, and one past it.
	cell = append(cell,
		heavy(10, "region.surge", now-1, at.Add(hex.Hex{Q: 2, R: 4})),
		heavy(11, "region.surge", now-1, at.Add(hex.Hex{Q: -3, R: 7})))
	got := Facts(at, now, bounds, cell)
	if want := []Count{{Kind: "region.surge", N: 4}}; !slices.Equal(got, want) {
		t.Fatalf("radius: got %v, want %v", got, want)
	}
}

func TestFactsKindCap(t *testing.T) {
	at := hex.Hex{}
	var cell []Heavy
	for i := range 3 * bounds.KindMost {
		cell = append(cell, heavy(i, "hunt.slain", now-1-i, at))
	}
	for i := range bounds.KindMost - 1 {
		cell = append(cell, heavy(1000+i, "holding.fell", now-1, at))
	}
	got := Facts(at, now, bounds, cell)
	want := []Count{{Kind: "holding.fell", N: bounds.KindMost - 1}, {Kind: "hunt.slain", N: bounds.KindMost}}
	if !slices.Equal(got, want) {
		t.Fatalf("cap: got %v, want %v", got, want)
	}
}

func TestFactsSkipPinsAndLight(t *testing.T) {
	at := hex.Hex{Q: 1, R: 1}
	cell := []Heavy{
		heavy(1, "pin.landed", now-1, at),
		heavy(2, "pin.reserved", now-1, at),
		{ID: 3, Kind: "region.surge", Tick: now - 1, Weight: bounds.Weight - 1, At: at},
		{ID: 4, Kind: "region.surge", Tick: now - 1, Weight: bounds.Weight, At: at},
		heavy(5, "pinned.elsewhere", now-1, at),
	}
	got := Facts(at, now, bounds, cell)
	want := []Count{{Kind: "pinned.elsewhere", N: 1}, {Kind: "region.surge", N: 1}}
	if !slices.Equal(got, want) {
		t.Fatalf("pins and weight: got %v, want %v", got, want)
	}
	if Facts(at, now, bounds) != nil || Facts(at, now, bounds, cell[:2]) != nil {
		t.Fatal("nothing counted should give a nil list, so an empty digest omits it")
	}
}

func TestFactsCountOnce(t *testing.T) {
	at := hex.Hex{}
	cell := []Heavy{heavy(7, "faction.raided", now-1, at), heavy(8, "faction.raided", now-1, at)}
	got := Facts(at, now, bounds, cell, cell, cell[:1])
	if want := []Count{{Kind: "faction.raided", N: 2}}; !slices.Equal(got, want) {
		t.Fatalf("a cell passed twice: got %v, want %v", got, want)
	}
}

func TestKeyStableUnderOrder(t *testing.T) {
	at := hex.Hex{Q: 2, R: 2}
	kinds := []string{"faction.raided", "region.surge", "hunt.slain", "holding.fell"}
	var all []Heavy
	for i := range int64(40) {
		all = append(all, heavy(i, kinds[i%int64(len(kinds))], now-1-i*7, at.Add(hex.Direction(int(i)%hex.Directions).Scale(i%5))))
	}
	a := Facts(at, now, bounds, all[:13], all[13:29], all[29:])
	rev := slices.Clone(all)
	slices.Reverse(rev)
	b := Facts(at, now, bounds, rev[20:], rev[:7], rev[7:20])
	if !slices.Equal(a, b) {
		t.Fatalf("input order moved the counts: %v against %v", a, b)
	}
	da, db := Digest{Facts: a, Bands: []int64{1, 0}}, Digest{Facts: b, Bands: []int64{1, 0}}
	if da.Key() != db.Key() {
		t.Fatal("input order moved the key")
	}
	more := Facts(at, now, bounds, append(slices.Clone(all), heavy(99, "region.overrun", now-1, at)))
	if (Digest{Facts: more, Bands: []int64{1, 0}}).Key() == da.Key() {
		t.Fatal("one more fact in reach left the key as it was")
	}
	if (Digest{}).Key() == (Digest{Pins: []string{"pin-1"}}).Key() {
		t.Fatal("a pin in reach left the key as it was")
	}
}

func TestDigestReads(t *testing.T) {
	d := Digest{
		Facts: []Count{{Kind: "a", N: 2}, {Kind: "c", N: 5}},
		Bands: []int64{3, 0, 1},
		Finds: []Count{{Kind: "far-material", N: 1}, {Kind: "pattern", N: 4}},
	}
	for _, c := range []struct {
		got, want int64
	}{
		{d.Count("a"), 2}, {d.Count("b"), 0}, {d.Count("c"), 5},
		{d.Found("pattern"), 4}, {d.Found("variant"), 0},
		{d.Band(0), 3}, {d.Band(2), 1}, {d.Band(3), 0}, {d.Band(-1), 0},
	} {
		if c.got != c.want {
			t.Errorf("got %d, want %d", c.got, c.want)
		}
	}
}

func TestBandOf(t *testing.T) {
	lines := []sheets.GaugeLine{
		{ID: "ambush", Gauge: "threat", AtLeast: 600},
		{ID: "raid", Gauge: "threat", AtLeast: 800},
		{ID: "spread", Gauge: "threat", AtLeast: 800},
		{ID: "overrun", Gauge: "threat", AtLeast: 900},
		{ID: "halve", Gauge: "scarcity", AtLeast: 700},
	}
	for _, c := range []struct {
		gauge string
		value int64
		want  int64
	}{
		{"threat", 0, 0}, {"threat", 599, 0}, {"threat", 600, 1}, {"threat", 850, 2},
		{"threat", 900, 3}, {"threat", 1000, 3}, {"scarcity", 950, 1}, {"unrest", 1000, 0},
	} {
		if got := BandOf(lines, c.gauge, c.value); got != c.want {
			t.Errorf("%s at %d: band %d, want %d", c.gauge, c.value, got, c.want)
		}
	}
}

func TestBoundsOf(t *testing.T) {
	cell := func(id string, v int64) sheets.Param {
		return sheets.Param{ID: id, Value: fixed.FromInt(v), Unit: "count"}
	}
	got := BoundsOf([]sheets.Param{
		cell("history-weight", 40), cell("history-radius", 6), cell("history-days", 28),
		cell("history-cell-kept", 32), cell("history-kind-most", 8), cell("history-holders-most", 3),
		cell("pins-in-reach-max", 8),
		cell("pins-per-cell", 8),
	})
	if got != bounds {
		t.Fatalf("got %+v, want %+v", got, bounds)
	}
}

// The cost bound is the disc and, per cell read, its kept facts, its pins
// and the find kinds.
func TestCostBound(t *testing.T) {
	want := hex.DiscSize(bounds.Radius) + 9*(bounds.CellKept+bounds.PinsPerCell+FindKinds)
	if got := bounds.CostBound(); got != want {
		t.Fatalf("cost bound %d, want %d", got, want)
	}
}

func TestCellOf(t *testing.T) {
	for _, c := range []struct {
		h    hex.Hex
		i, j int64
	}{
		{hex.Hex{}, 0, 0}, {hex.Hex{Q: 5, R: 5}, 0, 0}, {hex.Hex{Q: 6, R: -1}, 1, -1},
		{hex.Hex{Q: -6, R: -7}, -1, -2}, {hex.Hex{Q: -1, R: 12}, -1, 2},
	} {
		if i, j := bounds.CellOf(c.h); i != c.i || j != c.j {
			t.Errorf("%v: cell (%d, %d), want (%d, %d)", c.h, i, j, c.i, c.j)
		}
	}
	// Every tile of a radius disc lies in the 3 × 3 cells round its centre's.
	for _, centre := range []hex.Hex{{}, {Q: 5, R: -5}, {Q: -13, R: 4}, {Q: 6, R: 6}} {
		ci, cj := bounds.CellOf(centre)
		for _, h := range hex.DiscAt(centre, bounds.Radius) {
			if i, j := bounds.CellOf(h); i < ci-1 || i > ci+1 || j < cj-1 || j > cj+1 {
				t.Fatalf("%v round %v lies in cell (%d, %d), outside the 3 × 3 round (%d, %d)", h, centre, i, j, ci, cj)
			}
		}
	}
}
