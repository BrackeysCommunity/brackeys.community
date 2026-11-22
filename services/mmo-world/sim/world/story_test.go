package world_test

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// storyWorld is a world a few days in whose first faction holds four
// regions, its seat among them, and whose second holds one.
func storyWorld(t *testing.T) (*world.State, *fact.Mem, *sheets.Book) {
	t.Helper()
	b := book(t)
	for _, kind := range []string{world.FactGaugeMoved, world.FactLoyaltyMoved, world.FactSplit, world.FactPeace, world.FactGrudge, world.FactSeam} {
		if !slices.ContainsFunc(b.FactWeights, func(w sheets.FactWeight) bool { return w.Kind == kind }) {
			t.Fatalf("story.fact-weights has no row for %s", kind)
		}
	}
	k := keys.Throwaway("world-story")
	g, err := gen.New(b, k.Generation)
	if err != nil {
		t.Fatal(err)
	}
	s, err := world.New(b, g, k.Roll)
	if err != nil {
		t.Fatal(err)
	}
	log := &fact.Mem{}
	for range 3 {
		if err := s.AdvanceDay(log); err != nil {
			t.Fatal(err)
		}
	}
	if len(s.Factions) < 2 {
		t.Fatalf("%d factions", len(s.Factions))
	}
	for i := range s.Regions {
		if r := &s.Regions[i]; r.Holder == 0 && i != s.Factions[0].Seat {
			r.Holder = -1
		}
	}
	added := 0
	for i := range s.Regions {
		r := &s.Regions[i]
		if added < 3 && r.Holder == -1 && !r.Settlement && i != s.Factions[1].Seat {
			r.Holder, r.Defence = 0, 60
			added++
		}
	}
	for i := range s.Regions {
		if r := &s.Regions[i]; r.Holder == 1 && i != s.Factions[1].Seat {
			r.Holder = -1
		}
	}
	if added < 3 {
		t.Fatal("no room for the first faction's holdings")
	}
	return s, log, b
}

func centre(s *world.State, r int) hex.Hex { return s.Gen().Region(s.Regions[r].Lattice).Centre }

func held(s *world.State, f int) []int {
	var out []int
	for i, r := range s.Regions {
		if r.Holder == f {
			out = append(out, i)
		}
	}
	return out
}

// act applies story actions in the next tick, which is not a day's.
func act(t *testing.T, s *world.State, log *fact.Mem, acts ...world.Action) []fact.Fact {
	t.Helper()
	_, fs, err := world.Advance(s, log, acts, s.Tick+1)
	if err != nil {
		t.Fatal(err)
	}
	return fs
}

func only(t *testing.T, fs []fact.Fact, kind string) fact.Fact {
	t.Helper()
	var out []fact.Fact
	for _, f := range fs {
		if f.Kind == kind {
			out = append(out, f)
		}
	}
	if len(out) != 1 {
		t.Fatalf("%d %s facts in %v", len(out), kind, fs)
	}
	return out[0]
}

func none(t *testing.T, fs []fact.Fact, kinds ...string) {
	t.Helper()
	for _, f := range fs {
		if slices.Contains(kinds, f.Kind) {
			t.Fatalf("a story action with no target wrote %s", f.Kind)
		}
	}
}

func datum(f fact.Fact, key string) fact.Datum {
	d, _ := f.Get(key)
	return d
}

func notable(f world.Faction, role string) world.Notable {
	for _, n := range f.Notables {
		if !n.Dead && n.Role == role {
			return n
		}
	}
	panic("no " + role)
}

func ref(n world.Notable) string { return fmt.Sprintf("n-%d", n.ID) }

// TestStoryFortify moves a holding's defence and names its cause; a cut
// never goes under 0 nor fells it, and a faction's last holding takes a
// share of a cut.
func TestStoryFortify(t *testing.T) {
	s, log, _ := storyWorld(t)
	at := held(s, 0)[1]
	before := s.Regions[at].Defence
	cause := fact.ID(log.Len())
	f := only(t, act(t, s, log, world.Action{Kind: world.ActFortify, Hex: centre(s, at), Units: 15, Cause: cause}), "faction.fortified")
	if s.Regions[at].Defence != before+15 || datum(f, "by").N != 15 || !slices.Equal(f.Causes, []fact.ID{cause}) {
		t.Fatalf("defence %d from %d, fact %+v", s.Regions[at].Defence, before, f)
	}
	act(t, s, log, world.Action{Kind: world.ActFortify, Hex: centre(s, at), Units: -10_000})
	if s.Regions[at].Defence != 0 || s.Regions[at].Holder != 0 {
		t.Fatalf("a cut left defence %d, holder %d", s.Regions[at].Defence, s.Regions[at].Holder)
	}
	last := s.Factions[1].Seat
	before = s.Regions[last].Defence
	act(t, s, log, world.Action{Kind: world.ActFortify, Hex: centre(s, last), Units: -40})
	cut := fixed.PercentOf(40, sheets.IntParam(book(t).FactionParams, "last-holding-damage"))
	if s.Regions[last].Defence != max(0, before-cut) {
		t.Fatalf("a last holding cut by 40 went %d to %d, want a cut of %d", before, s.Regions[last].Defence, cut)
	}
}

// TestStoryFall: a holding falls with holding.fell naming no settlement,
// a seat that falls moves, and a last holding never falls.
func TestStoryFall(t *testing.T) {
	s, log, _ := storyWorld(t)
	seat := s.Factions[0].Seat
	f := only(t, act(t, s, log, world.Action{Kind: world.ActFallHolding, Hex: centre(s, seat)}), "holding.fell")
	if s.Regions[seat].Holder != -1 || datum(f, "settlement").N != 0 || datum(f, "cause").S != "story" || s.Factions[0].Seat == seat {
		t.Fatalf("holder %d, fact %+v, seat %d", s.Regions[seat].Holder, f, s.Factions[0].Seat)
	}
	if s.Regions[s.Factions[0].Seat].Holder != 0 || s.Factions[0].Fallen {
		t.Fatal("the seat moved off the faction's holdings")
	}
	last := s.Factions[1].Seat
	none(t, act(t, s, log, world.Action{Kind: world.ActFallHolding, Hex: centre(s, last)}), "holding.fell")
	if s.Regions[last].Holder != 1 || s.Factions[1].Fallen {
		t.Fatal("a faction's last holding fell to the story")
	}
	none(t, act(t, s, log, world.Action{Kind: world.ActFallHolding, Hex: centre(s, seat)}), "holding.fell")
}

// TestStoryGaugeAndSurge: a gauge moves in one region; a surge lifts the
// region's threat and its neighbours' at the neighbour share.
func TestStoryGaugeAndSurge(t *testing.T) {
	s, log, b := storyWorld(t)
	r := s.Factions[0].Seat
	threat := s.GaugeIndex("threat")
	unrest := s.GaugeIndex("unrest")
	s.Regions[r].Gauge[unrest] = 200
	f := only(t, act(t, s, log, world.Action{Kind: world.ActGauge, Hex: centre(s, r), Tag: "unrest", Units: -50}), world.FactGaugeMoved)
	if s.Regions[r].Gauge[unrest] != 150 || datum(f, "gauge").S != "unrest" || datum(f, "value").N != 150 {
		t.Fatalf("unrest %d, fact %+v", s.Regions[r].Gauge[unrest], f)
	}
	for i := range s.Regions {
		s.Regions[i].Gauge[threat] = 0
	}
	f = only(t, act(t, s, log, world.Action{Kind: world.ActSurge, Hex: centre(s, r), Units: 300}), "region.surge")
	share := fixed.PercentFloor(300, sheets.IntParam(b.WorldParams, "surge-neighbour-share"))
	if s.Regions[r].Gauge[threat] != 300 || s.Regions[r].SurgeFact != f.ID || len(s.Regions[r].Neighbours) == 0 {
		t.Fatalf("threat %d at the surge", s.Regions[r].Gauge[threat])
	}
	for _, n := range s.Regions[r].Neighbours {
		if s.Regions[n].Gauge[threat] != share || s.Regions[n].SurgeFact != f.ID {
			t.Fatalf("neighbour %d threat %d, want %d", n, s.Regions[n].Gauge[threat], share)
		}
	}
}

// TestStorySplit seats a new faction on drawn holdings of the old one,
// led by the named notable, and grows every per-faction slice.
func TestStorySplit(t *testing.T) {
	s, log, _ := storyWorld(t)
	was := len(s.Factions)
	seat := s.Factions[0].Seat
	claimant := notable(s.Factions[0], world.RoleCaptain)
	stock := s.Factions[0].Stock
	f := only(t, act(t, s, log, world.Action{Kind: world.ActSplit, Hex: centre(s, seat), Species: ref(claimant)}), world.FactSplit)
	if len(s.Factions) != was+1 {
		t.Fatalf("%d factions after a split, want %d", len(s.Factions), was+1)
	}
	nf := s.Factions[was]
	if len(held(s, was)) != 2 || len(held(s, 0)) != 2 || s.Factions[0].Seat != seat || s.Regions[nf.Seat].Holder != was {
		t.Fatalf("holdings %v and %v, new seat %d", held(s, 0), held(s, was), nf.Seat)
	}
	if nf.Archetype != s.Factions[0].Archetype || nf.Head != claimant.Family || nf.Stock+s.Factions[0].Stock != stock {
		t.Fatalf("new faction %+v", nf)
	}
	if lead := notable(nf, world.RoleLeader); lead.ID != claimant.ID {
		t.Fatalf("led by %d, want %d", lead.ID, claimant.ID)
	}
	if slices.ContainsFunc(s.Factions[0].Notables, func(n world.Notable) bool { return n.ID == claimant.ID }) {
		t.Fatal("the claimant stayed with the old faction")
	}
	for _, x := range s.Factions {
		if len(x.Disposition) != len(s.Factions) || len(x.Grudge) != len(s.Factions) || len(x.Wrong) != len(s.Factions) || len(x.Ties) != len(s.Factions) {
			t.Fatalf("faction %d's slices did not grow", x.ID)
		}
	}
	if datum(f, "holdings").N != 2 || len(f.Subjects) != 3 {
		t.Fatalf("split fact %+v", f)
	}
	again, againLog, _ := storyWorld(t)
	act(t, again, againLog, world.Action{Kind: world.ActSplit, Hex: centre(again, seat), Species: ref(claimant)})
	if !slices.Equal(held(again, was), held(s, was)) {
		t.Fatal("the split's draw is not keyed")
	}
	none(t, act(t, s, log, world.Action{Kind: world.ActSplit, Hex: centre(s, s.Factions[1].Seat), Species: ref(claimant)}), world.FactSplit)
	if len(s.Factions) != was+1 {
		t.Fatal("a faction of one holding split")
	}
}

// TestStoryNotables: an appointment leads, loyalty moves, and a defector
// takes defence with it to the faction at Hex.
func TestStoryNotables(t *testing.T) {
	s, log, _ := storyWorld(t)
	f0 := s.Factions[0]
	leader, captain := notable(f0, world.RoleLeader), notable(f0, world.RoleCaptain)
	only(t, act(t, s, log, world.Action{Kind: world.ActAppoint, Hex: centre(s, f0.Seat), Species: ref(captain)}), "notable.promoted")
	if notable(s.Factions[0], world.RoleLeader).ID != captain.ID {
		t.Fatal("the appointed notable does not lead")
	}
	for _, n := range s.Factions[0].Notables {
		if n.ID == leader.ID && n.Role != world.RoleCaptain {
			t.Fatalf("the old leader is %s", n.Role)
		}
	}
	f := only(t, act(t, s, log, world.Action{Kind: world.ActLoyalty, Species: ref(captain), Units: -20}), world.FactLoyaltyMoved)
	if notable(s.Factions[0], world.RoleLeader).Loyalty != captain.Loyalty-20 || datum(f, "by").N != -20 {
		t.Fatalf("loyalty fact %+v", f)
	}
	seat1 := s.Factions[1].Seat
	defence := s.Regions[seat1].Defence
	only(t, act(t, s, log, world.Action{Kind: world.ActDefect, Hex: centre(s, seat1), Species: ref(leader)}), "notable.defected")
	if !slices.ContainsFunc(s.Factions[1].Notables, func(n world.Notable) bool { return n.ID == leader.ID }) ||
		slices.ContainsFunc(s.Factions[0].Notables, func(n world.Notable) bool { return n.ID == leader.ID }) {
		t.Fatal("the defector did not move")
	}
	if s.Regions[seat1].Defence <= defence {
		t.Fatal("the defector brought no defence")
	}
	none(t, act(t, s, log, world.Action{Kind: world.ActDefect, Hex: centre(s, seat1), Species: ref(leader)},
		world.Action{Kind: world.ActLoyalty, Species: "n-99999", Units: 5}), "notable.defected", world.FactLoyaltyMoved)
}

// TestStoryGrudgeAndPeace: a grudge adds days and names its fact as the
// wrong; peace clears both ways.
func TestStoryGrudgeAndPeace(t *testing.T) {
	s, log, _ := storyWorld(t)
	at := centre(s, s.Factions[0].Seat)
	f := only(t, act(t, s, log, world.Action{Kind: world.ActGrudge, Hex: at, Material: "faction:f-1", Units: 14}), world.FactGrudge)
	if s.Factions[0].Grudge[1] != 14 || s.Factions[0].Wrong[1] != f.ID {
		t.Fatalf("grudge %d, wrong %d", s.Factions[0].Grudge[1], s.Factions[0].Wrong[1])
	}
	s.Factions[1].Grudge[0] = 5
	only(t, act(t, s, log, world.Action{Kind: world.ActPeace, Hex: at, Material: "f-1"}), world.FactPeace)
	if s.Factions[0].Grudge[1] != 0 || s.Factions[1].Grudge[0] != 0 {
		t.Fatal("peace left a grudge")
	}
}

// TestStorySeam adds stock to a node that no day's forgetting wears down.
func TestStorySeam(t *testing.T) {
	s, log, _ := storyWorld(t)
	h := centre(s, s.Factions[0].Seat)
	only(t, act(t, s, log, world.Action{Kind: world.ActSeam, Hex: h, Material: "iron", Units: 40}), world.FactSeam)
	if s.Tile(h).Gathered["iron"] != -40 {
		t.Fatalf("gathered %v", s.Tile(h).Gathered)
	}
	if err := s.AdvanceDay(log); err != nil {
		t.Fatal(err)
	}
	if s.Tile(h).Gathered["iron"] != -40 {
		t.Fatalf("a seam wore down to %v", s.Tile(h).Gathered)
	}
}

// TestStoryRefusals: a malformed story action refuses before anything
// changes.
func TestStoryRefusals(t *testing.T) {
	s, log, _ := storyWorld(t)
	at := centre(s, s.Factions[0].Seat)
	before := digest(t, s, log)
	for _, a := range []world.Action{
		{Kind: world.ActFortify, Hex: at},
		{Kind: world.ActGauge, Hex: at, Tag: "mood", Units: 5},
		{Kind: world.ActGauge, Hex: at, Tag: "threat"},
		{Kind: world.ActSplit, Hex: at, Species: "c-1"},
		{Kind: world.ActAppoint, Hex: at},
		{Kind: world.ActLoyalty, Species: "n-1"},
		{Kind: world.ActDefect, Hex: at, Species: "notable"},
		{Kind: world.ActPeace, Hex: at, Material: "guild:g-1"},
		{Kind: world.ActGrudge, Hex: at, Material: "f-1"},
		{Kind: world.ActSurge, Hex: at, Units: -1},
		{Kind: world.ActSeam, Hex: at, Units: 4},
	} {
		if _, _, err := world.Advance(s, log, []world.Action{{Kind: world.ActFortify, Hex: at, Units: 5}, a}, s.Tick+1); err == nil {
			t.Errorf("%+v passed", a)
		}
	}
	if digest(t, s, log) != before {
		t.Fatal("a refused story action changed the world")
	}
}

// TestFactionIndex reads a faction's ref in each spelling.
func TestFactionIndex(t *testing.T) {
	for ref, want := range map[string]int{"faction:f-3": 3, "f-3": 3, "faction:3": 3} {
		if got, ok := world.FactionIndex(ref); !ok || got != want {
			t.Errorf("%s: %d %v", ref, got, ok)
		}
	}
	for _, ref := range []string{"3", "faction:", "faction:-1", "n-3", "faction:x"} {
		if _, ok := world.FactionIndex(ref); ok {
			t.Errorf("%s read as a faction", ref)
		}
	}
}
