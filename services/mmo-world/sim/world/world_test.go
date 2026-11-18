package world_test

import (
	"encoding/json"
	"slices"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/world"
)

func book(t testing.TB) *sheets.Book {
	t.Helper()
	b, err := harness.LoadBook(harness.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func start(t testing.TB, label string) (*world.State, *fact.Mem) {
	t.Helper()
	b := book(t)
	k := keys.Throwaway(label)
	g, err := gen.New(b, k.Generation)
	if err != nil {
		t.Fatal(err)
	}
	s, err := world.New(b, g, k.Roll)
	if err != nil {
		t.Fatal(err)
	}
	return s, &fact.Mem{}
}

func run(t testing.TB, label string, days int) (*world.State, *fact.Mem) {
	t.Helper()
	s, log := start(t, label)
	for range days {
		if err := s.AdvanceDay(log); err != nil {
			t.Fatal(err)
		}
	}
	return s, log
}

func digest(t testing.TB, s *world.State, log *fact.Mem) string {
	t.Helper()
	d, err := canon.Digest([]any{s, log.Since(0)})
	if err != nil {
		t.Fatal(err)
	}
	return d.String()
}

// A replay of the same days reaches the same digest.
func TestReplayDigest(t *testing.T) {
	s1, l1 := run(t, "world-test", 30)
	s2, l2 := run(t, "world-test", 30)
	if digest(t, s1, l1) != digest(t, s2, l2) || l1.Len() == 0 {
		t.Fatalf("replays differ over %d facts", l1.Len())
	}
}

// Ticks run one at a time.
func TestAdvanceInOrder(t *testing.T) {
	s, log := start(t, "world-order")
	if _, _, err := world.Advance(s, log, nil, 5); err == nil {
		t.Fatal("skipped ticks without an error")
	}
	if _, _, err := world.Advance(s, log, []world.Action{{Kind: "dance"}}, 1); err == nil {
		t.Fatal("an unknown action passed")
	}
}

func TestGaugesStayInRange(t *testing.T) {
	s, log := run(t, "world-test", 90)
	for _, r := range s.Regions {
		for _, v := range r.Gauge {
			if v < 0 || v > 1000 {
				t.Fatalf("region %d gauge %d", r.ID, v)
			}
		}
	}
	for _, f := range log.Since(0) {
		for _, c := range f.Causes {
			if c >= f.ID {
				t.Fatalf("fact %d caused by a later fact %d", f.ID, c)
			}
		}
	}
}

// The horizon holds the discovered regions and those two regions out;
// the rest are dormant. Discovering a tile further out wakes more, finds
// what they hold once, and counts novelty.
func TestHorizon(t *testing.T) {
	s, log := start(t, "world-horizon")
	awake := len(s.Regions)
	if awake < 7 || len(s.Dormant) == 0 {
		t.Fatalf("%d awake, %d dormant at start", awake, len(s.Dormant))
	}
	for _, d := range s.Dormant {
		if s.RegionIndex(d) >= 0 {
			t.Fatalf("dormant region %v is awake", d)
		}
	}
	g := s.Gen()
	if home := s.Tile(g.Settlement(0).Hex); home == nil || len(home.Structures) != len(book(t).Starting) {
		t.Fatal("the first settlement opened without its structures")
	}
	far := g.Region(s.Dormant[0]).Centre
	if err := s.Discover(log, far, fact.Ref{Kind: "character", ID: "c-1"}); err != nil {
		t.Fatal(err)
	}
	if len(s.Regions) <= awake || s.RegionAt(far) < 0 || s.Tile(far).Discovered == nil || s.Frontier() != 1 {
		t.Fatalf("discovery woke %d regions, frontier %d", len(s.Regions)-awake, s.Frontier())
	}
	discovered := 0
	for _, f := range log.Since(0) {
		if f.Kind == "region.discovered" {
			discovered++
		}
	}
	if discovered != 1 {
		t.Fatalf("%d region.discovered facts", discovered)
	}
	n := len(log.Since(0))
	if err := s.Discover(log, far, fact.Ref{Kind: "character", ID: "c-2"}); err != nil || log.Len() != n {
		t.Fatal("rediscovering a tile wrote facts")
	}
	keys := map[string]bool{}
	for _, f := range s.Finds {
		if keys[f.Key] {
			t.Fatalf("find %s twice", f.Key)
		}
		keys[f.Key] = true
	}
}

// Opening a settlement lowers the tier of the land round it at the next
// day, and a fact says so; what was found stays frozen at its tier.
func TestOpenSettlement(t *testing.T) {
	s, log := start(t, "world-open")
	g := s.Gen()
	home := g.Settlement(0).Hex
	next := g.Settlement(1).Hex
	for _, h := range hex.Line(home, next) {
		if err := s.Discover(log, h, fact.Ref{Kind: "character", ID: "c-1"}); err != nil {
			t.Fatal(err)
		}
	}
	finds := slices.Clone(s.Finds)
	before := make([]int64, len(s.Regions))
	for i, r := range s.Regions {
		before[i] = r.Tier
	}
	s.OpenSettlement()
	if s.Opened != 1 {
		t.Fatal("a settlement opened before the day turned")
	}
	if err := s.AdvanceDay(log); err != nil {
		t.Fatal(err)
	}
	lowered := 0
	for i := range before {
		if s.Regions[i].Tier > before[i] {
			t.Fatalf("region %d rose from tier %d to %d", i, before[i], s.Regions[i].Tier)
		}
		if s.Regions[i].Tier < before[i] {
			lowered++
		}
	}
	calm := 0
	for _, f := range log.Since(0) {
		if f.Kind == "land.calmer" {
			calm++
		}
	}
	if s.Opened != 2 || lowered == 0 || calm != 1 {
		t.Fatalf("opened %d, %d regions lowered, %d calmer facts", s.Opened, lowered, calm)
	}
	for _, f := range finds {
		k := slices.IndexFunc(s.Finds, func(x world.Find) bool { return x.Key == f.Key })
		if k < 0 || s.Finds[k].Tier != f.Tier || !slices.Equal(s.Finds[k].Vector, f.Vector) {
			t.Fatalf("find %s changed after a settlement opened", f.Key)
		}
	}
}

// Notables: posts filled, traits never an opposed pair, loyalty kept.
func TestNotables(t *testing.T) {
	s, log := run(t, "world-notables", 60)
	b := book(t)
	opposed := map[string]string{}
	for _, tr := range b.NPCTraits {
		opposed[tr.ID] = tr.Opposes
	}
	for _, f := range s.Factions {
		if f.Fallen {
			continue
		}
		roles := map[string]int{}
		for _, n := range f.Notables {
			if n.Dead {
				continue
			}
			roles[n.Role]++
			if len(n.Traits) != 2 || opposed[n.Traits[0]] == n.Traits[1] {
				t.Fatalf("notable %d traits %v", n.ID, n.Traits)
			}
		}
		if roles[world.RoleLeader] != 1 || roles[world.RoleCaptain] < 1 || roles[world.RoleFactor] < 1 {
			t.Fatalf("faction %d posts %v", f.ID, roles)
		}
	}
	_ = log
}

// Weather forms over the horizon, moves, and lays its tags on the tiles
// under it; a dead zone cuts sight.
func TestWeather(t *testing.T) {
	s, log := start(t, "world-weather")
	formed, seenTag := 0, false
	for range 20 {
		if err := s.AdvanceDay(log); err != nil {
			t.Fatal(err)
		}
		for _, sys := range s.Sky.Systems {
			place := s.Place(sys.Centre)
			if place.Has(tagOf(sys.Kind)) {
				seenTag = true
			}
			if sys.Kind == "fog" && s.Sight(sys.Centre) > 1 {
				t.Fatalf("sight %d in a dead zone", s.Sight(sys.Centre))
			}
		}
	}
	for _, f := range log.Since(0) {
		if f.Kind == "weather.formed" {
			formed++
		}
	}
	if formed == 0 || !seenTag {
		t.Fatalf("%d systems formed; weather tag seen %v", formed, seenTag)
	}
}

func tagOf(kind string) tags.Tag { return tags.Tag(kind) }

// Slaying lowers a population; under a tenth it is gone; it spreads back
// from a full neighbour and breeds back to capacity.
func TestPopulations(t *testing.T) {
	s, log := start(t, "world-creatures")
	g := s.Gen()
	var at hex.Hex
	species := ""
	for _, r := range s.Regions {
		base := g.Region(r.Lattice)
		if base.Creature != "" && s.Capacity(base.Centre, base.Creature) >= 3 {
			at, species = base.Centre, base.Creature
			break
		}
	}
	if species == "" {
		t.Skip("no creature with room to test")
	}
	cap := s.Capacity(at, species)
	for range cap {
		if _, _, err := world.Advance(s, log, []world.Action{{Kind: world.ActSlay, Hex: at, Species: species}}, s.Tick+1); err != nil {
			t.Fatal(err)
		}
	}
	if s.Population(at, species) != 0 {
		t.Fatalf("population %d after slaying %d", s.Population(at, species), cap)
	}
	for range 120 {
		if err := s.AdvanceDay(log); err != nil {
			t.Fatal(err)
		}
	}
	if s.Population(at, species) != cap {
		t.Fatalf("population %d of %d after four months", s.Population(at, species), cap)
	}
}

// A snapshot decodes, attaches and runs on to the same digest as the
// world it was taken from.
func TestSnapshotResumes(t *testing.T) {
	b := book(t)
	k := keys.Throwaway("world-snap")
	s, log := run(t, "world-snap", 10)
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var back world.State
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	g, err := gen.New(b, k.Generation)
	if err != nil {
		t.Fatal(err)
	}
	back.Attach(b, g, k.Roll)
	logB := &fact.Mem{}
	for _, f := range log.Since(0) {
		if _, err := logB.Append(f); err != nil {
			t.Fatal(err)
		}
	}
	for range 10 {
		if err := s.AdvanceDay(log); err != nil {
			t.Fatal(err)
		}
		if err := back.AdvanceDay(logB); err != nil {
			t.Fatal(err)
		}
	}
	if digest(t, s, log) != digest(t, &back, logB) {
		t.Fatal("a resumed snapshot drifted")
	}
}
