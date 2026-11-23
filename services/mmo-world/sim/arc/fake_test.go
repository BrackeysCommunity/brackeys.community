package arc

import (
	"cmp"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// fakeRegion is one region of a fake world.
type fakeRegion struct {
	at         hex.Hex
	gauge      map[string]int64
	lines      map[string]bool
	neighbours []int
	holder     int
	defence    int64
	streak     map[string]int64
}

// fake is a World and an Extra the tests set by hand.
type fake struct {
	day      int64
	regions  []*fakeRegion
	factions []FactionView
	places   []PlaceView
	memory   []Memory
	pending  []Pending
	busy     map[string]bool
	core     hex.Hex
	open     bool
	lineFrom map[string]int64
	homes    map[string]hex.Hex
	followed map[int]int64
	passages map[int]int64
	herd     map[int]int64
	nextFact fact.ID
}

// plain hides a fake's Extra.
type plain struct{ World }

// newFake is n regions in a row, 10 tiles apart, each next to the ones
// beside it, held by nobody.
func newFake(n int) *fake {
	f := &fake{day: 20, busy: map[string]bool{}, lineFrom: map[string]int64{gaugeThreat: 600, gaugeCorruption: 500},
		homes: map[string]hex.Hex{}, followed: map[int]int64{}, passages: map[int]int64{}, herd: map[int]int64{}}
	for i := range n {
		r := &fakeRegion{at: hex.Hex{Q: int64(i) * 10}, gauge: map[string]int64{}, lines: map[string]bool{}, holder: -1, streak: map[string]int64{}}
		if i > 0 {
			r.neighbours = append(r.neighbours, i-1)
		}
		if i < n-1 {
			r.neighbours = append(r.neighbours, i+1)
		}
		f.regions = append(f.regions, r)
	}
	return f
}

// faction adds a faction seated at seat holding the regions given.
func (f *fake) faction(archetype string, tags []string, seat int, defence int64, held ...int) *FactionView {
	id := len(f.factions)
	for i := range f.factions {
		f.factions[i].Grudge = append(f.factions[i].Grudge, 0)
		f.factions[i].Disposition = append(f.factions[i].Disposition, 0)
	}
	v := FactionView{ID: id, Archetype: archetype, Tags: tags, Seat: seat, Holdings: held,
		Grudge: make([]int64, id+1), Disposition: make([]int64, id+1)}
	for _, r := range held {
		f.regions[r].holder, f.regions[r].defence = id, defence
	}
	f.factions = append(f.factions, v)
	return &f.factions[id]
}

// place adds a standing keeper-run place on region r's centre plus off.
func (f *fake) place(r int, off hex.Hex) *PlaceView {
	n := len(f.places)
	f.places = append(f.places, PlaceView{N: n, Hex: f.regions[r].at.Add(off), Region: r, Open: true})
	return &f.places[n]
}

// remember keeps a fact of kind on day in region about subjects.
func (f *fake) remember(kind string, day int64, region int, subjects ...fact.Ref) fact.ID {
	f.nextFact++
	at := hex.Hex{}
	if region >= 0 {
		at = f.regions[region].at
	}
	f.memory = append(f.memory, Memory{Fact: f.nextFact, Tick: day * sheets.TicksPerDay, Kind: kind, Region: region, At: at, Subjects: subjects})
	return f.nextFact
}

func (f *fake) setBusy(scope string, ref fact.Ref) { f.busy[scope+"|"+ref.String()] = true }

func (f *fake) Day() int64 { return f.day }
func (f *fake) Awake() []int {
	out := make([]int, len(f.regions))
	for i := range out {
		out[i] = i
	}
	return out
}
func (f *fake) Gauge(r int, g string) int64    { return f.regions[r].gauge[g] }
func (f *fake) Line(r int, line string) bool   { return f.regions[r].lines[line] }
func (f *fake) Neighbours(r int) []int         { return f.regions[r].neighbours }
func (f *fake) Holder(r int) int               { return f.regions[r].holder }
func (f *fake) Defence(r int) int64            { return f.regions[r].defence }
func (f *fake) RegionHex(r int) hex.Hex        { return f.regions[r].at }
func (f *fake) Factions() []FactionView        { return f.factions }
func (f *fake) Places() []PlaceView            { return f.places }
func (f *fake) Streak(r int, s string) int64   { return f.regions[r].streak[s] }
func (f *fake) Busy(s string, r fact.Ref) bool { return f.busy[s+"|"+r.String()] }
func (f *fake) Core() (hex.Hex, bool)          { return f.core, f.open }

func (f *fake) RegionOf(h hex.Hex) int {
	best := -1
	for i, r := range f.regions {
		if best < 0 || hex.Distance(r.at, h) < hex.Distance(f.regions[best].at, h) {
			best = i
		}
	}
	return best
}

func (f *fake) Recall(kind string, within int64) []Memory {
	var out []Memory
	for _, m := range f.memory {
		if m.Kind == kind && dayOf(m.Tick) >= f.day-within {
			out = append(out, m)
		}
	}
	return out
}

func (f *fake) Pending(kind string) []Pending {
	var out []Pending
	for _, p := range f.pending {
		if p.Kind == kind {
			out = append(out, p)
		}
	}
	return out
}

func (f *fake) NearestPlace(h hex.Hex) (int, bool) {
	p, ok := nearestTo(f.places, h, func(PlaceView) bool { return true })
	return p.N, ok
}

func (f *fake) LineFrom(g string) int64 { return f.lineFrom[g] }
func (f *fake) Home(npc string) (hex.Hex, bool) {
	h, ok := f.homes[npc]
	return h, ok
}
func (f *fake) Followed(n int) int64          { return f.followed[n] }
func (f *fake) Passages(n int) int64          { return f.passages[n] }
func (f *fake) Herd(r int, hunt string) int64 { return f.herd[r] }

// params are the shipped story.params and emergence.params values.
var params = Params{
	MemoryDays: 30, ColdShare: 50, ColdDays: 5, ColdRegions: 3, WetShare: 50, WetDays: 3, WetScarcity: 500,
	SeamBelow: 100, PanicStarvingDays: 3, CaravanPassages: 40, FrontJoined: 2, RivalDistance: 12, RivalGrowthDays: 14,
	DefectorLoyalty: 30, BetrayalDays: 30, LeaderDiedDays: 30, ReturnDays: 14, ThreadStanding: 50,
	FinaleLapseBonus: 200, FinaleLossWeight: 100, RoadWarLoad: 2000, CaravanThreat: 800,
}

// row is a template row of scope with cast roles given as role, kind pairs.
func row(id, scope string, cast ...string) Row {
	r := Row{ID: id, Scope: scope}
	for i := 0; i+1 < len(cast); i += 2 {
		r.Cast = append(r.Cast, sheets.CastRow{Role: cast[i], Kind: cast[i+1]})
	}
	return r
}

// run calls the registered predicate and checks what every predicate
// promises: casting order, sorted casts and regions, busy refs left out.
func run(t *testing.T, w World, id string, r Row) []Candidate {
	t.Helper()
	p, ok := Predicates[id]
	if !ok {
		t.Fatalf("predicate %q is not registered", id)
	}
	cs := p(w, r, params)
	if o := Ordered(cs); !slices.EqualFunc(o, cs, func(a, b Candidate) bool { return a.Cast.Key() == b.Cast.Key() }) {
		t.Fatalf("%s: candidates out of order", id)
	}
	for _, c := range cs {
		if !slices.IsSortedFunc(c.Cast, func(a, b Binding) int { return cmp.Compare(a.Role, b.Role) }) {
			t.Fatalf("%s: cast %s not sorted", id, c.Cast.Key())
		}
		if !slices.IsSorted(c.Regions) || len(slices.Compact(slices.Clone(c.Regions))) != len(c.Regions) {
			t.Fatalf("%s: regions %v", id, c.Regions)
		}
		if !slices.IsSorted(c.Causes) {
			t.Fatalf("%s: causes %v", id, c.Causes)
		}
		if (r.Scope == Settlement) != (c.Place >= 0) {
			t.Fatalf("%s: place %d at scope %s", id, c.Place, r.Scope)
		}
	}
	return cs
}

// one is the only candidate, or a failure.
func one(t *testing.T, cs []Candidate) Candidate {
	t.Helper()
	if len(cs) != 1 {
		var keys []string
		for _, c := range cs {
			keys = append(keys, c.Cast.Key())
		}
		t.Fatalf("want one candidate, got %d: %v", len(cs), keys)
	}
	return cs[0]
}

// none fails when there is any candidate.
func none(t *testing.T, cs []Candidate) {
	t.Helper()
	if len(cs) != 0 {
		t.Fatalf("want no candidate, got %s", cs[0].Cast.Key())
	}
}

// bound fails unless c binds role to ref.
func bound(t *testing.T, c Candidate, role string, ref fact.Ref) {
	t.Helper()
	if got, ok := c.Cast.Get(role); !ok || got != ref {
		t.Fatalf("%s = %v (%v), want %v in %s", role, got, ok, ref, c.Cast.Key())
	}
}

func charRef(id string) fact.Ref { return fact.Ref{Kind: kindCharacter, ID: id} }
