package world_test

import (
	"encoding/json"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// twin copies a world and its log through a snapshot, as a save and a
// load would.
func twin(t testing.TB, s *world.State, log *fact.Mem, label string) (*world.State, *fact.Mem) {
	t.Helper()
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var c world.State
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	c.Attach(book(t), s.Gen(), keys.Throwaway(label).Roll)
	l := &fact.Mem{}
	for _, f := range log.Since(0) {
		if _, err := l.Append(f); err != nil {
			t.Fatal(err)
		}
	}
	return &c, l
}

func sum(t testing.TB, v any) string {
	t.Helper()
	d, err := canon.Digest(v)
	if err != nil {
		t.Fatal(err)
	}
	return d.String()
}

// unreached is a passable tile at distance d from the first settlement
// that nobody has reached.
func unreached(t testing.TB, s *world.State, d int64) hex.Hex {
	t.Helper()
	g := s.Gen()
	for _, h := range hex.Ring(g.Settlement(0).Hex, d) {
		if g.Passable(g.Baseline(h).Terrain) && s.Content(h) == nil {
			return h
		}
	}
	t.Fatalf("no unreached passable tile %d out", d)
	return hex.Hex{}
}

// Two arrivals on one tile in one tick store one content, the same
// whichever arrives first.
func TestReachOnce(t *testing.T) {
	const label = "world-reach-once"
	s, log := run(t, label, 2)
	h := unreached(t, s, 3)
	visit := func(id string) world.Action {
		return world.Action{Kind: world.ActVisit, Hex: h, By: fact.Ref{Kind: "character", ID: id}}
	}
	var got []string
	for _, order := range [][]world.Action{{visit("c-1"), visit("c-2")}, {visit("c-2"), visit("c-1")}} {
		w, l := twin(t, s, log, label)
		tick := w.Tick + 1
		if _, _, err := world.Advance(w, l, order, tick); err != nil {
			t.Fatal(err)
		}
		c := w.Content(h)
		if c == nil || c.Drawn != tick || c.Key == "" || c.Digest == nil || c.Native {
			t.Fatalf("content after two arrivals: %+v", c)
		}
		if ed := w.Edited(); len(ed) != 1 || ed[0] != h {
			t.Fatalf("edited %v, want only %v", ed, h)
		}
		before := sum(t, c)
		if err := w.Reach(l, h, tick+1); err != nil || sum(t, w.Content(h)) != before {
			t.Fatal("a later reach redrew the tile")
		}
		got = append(got, before)
	}
	if got[0] != got[1] {
		t.Fatalf("arrival order changed the content: %s against %s", got[0], got[1])
	}
}

// explore runs a world with the replay fixtures' explorer and returns
// every stored content by tile.
func explore(t testing.TB, label string, days int) (*world.State, map[hex.Hex]*tile.Content) {
	t.Helper()
	s, log := start(t, label)
	ex := harness.NewExplorer(s.Gen().Settlement(0).Hex, 40)
	for range days {
		if err := s.AdvanceDayWith(log, ex.Day(s, 12)); err != nil {
			t.Fatal(err)
		}
	}
	out := map[hex.Hex]*tile.Content{}
	for _, tl := range s.Tiles {
		if tl.Content != nil {
			out[tl.Hex] = tl.Content
		}
	}
	return s, out
}

// The same history gives the same content twice.
func TestReachDeterministic(t *testing.T) {
	_, a := explore(t, "world-reach-same", 60)
	_, b := explore(t, "world-reach-same", 60)
	if len(a) < 200 || len(a) != len(b) {
		t.Fatalf("%d and %d tiles hold content", len(a), len(b))
	}
	for h, c := range a {
		if sum(t, c) != sum(t, b[h]) {
			t.Fatalf("tile %v drew differently twice", h)
		}
	}
}

// One more heavy fact within the history radius reseeds a tile's draw;
// one just past it does not.
func TestReachReadsHistory(t *testing.T) {
	const label = "world-reach-history"
	s, log := run(t, label, 3)
	h := unreached(t, s, 12)
	weights := fact.NewWeights(book(t).FactWeights)
	key := func(at *hex.Hex) string {
		w, l := twin(t, s, log, label)
		if at != nil {
			f, err := weights.New(w.Tick, "faction.raided", "", nil, nil, fact.At(*at)...)
			if err != nil {
				t.Fatal(err)
			}
			if f.ID, err = l.Append(f); err != nil {
				t.Fatal(err)
			}
			w.Note(f)
		}
		if err := w.Reach(l, h, w.Tick+1); err != nil {
			t.Fatal(err)
		}
		return w.Content(h).Key
	}
	base := key(nil)
	near, far := hex.Ring(h, 6)[0], hex.Ring(h, 7)[0]
	if key(&near) == base {
		t.Fatal("a raid 6 tiles off left the tile's key alone")
	}
	if key(&far) != base {
		t.Fatal("a raid 7 tiles off changed the tile's key")
	}
}

// A world from before content was drawn from history discovers tiles and
// stores no content on any of them.
func TestV0Untouched(t *testing.T) {
	s, log, r := v0(t, "replay-explorer")
	frontier := s.Frontier()
	at := 0
	for range r.Ticks {
		var acts []world.Action
		if at < len(r.Actions) && r.Actions[at].Tick == s.Tick+1 {
			acts = r.Actions[at].Actions
			at++
		}
		if _, _, err := world.Advance(s, log, acts, s.Tick+1); err != nil {
			t.Fatal(err)
		}
		if len(s.Edited()) != 0 {
			t.Fatalf("tick %d edited %v", s.Tick, s.Edited())
		}
	}
	if s.Frontier() <= frontier {
		t.Fatalf("frontier %d after the replay, %d before", s.Frontier(), frontier)
	}
	if s.Drawn() || len(s.History) != 0 {
		t.Fatalf("a v0 world moved to version %d with %d history cells", s.ContentVersion, len(s.History))
	}
	for _, tl := range s.Tiles {
		if tl.Content != nil {
			t.Fatalf("tile %v holds content on a v0 world", tl.Hex)
		}
	}
}

// In a world drawing from history every tile anyone has reached holds
// content, and nothing else does.
func TestEveryReachedTileHasContent(t *testing.T) {
	s, contents := explore(t, "world-every-reached", 30)
	reached := 0
	for _, tl := range s.Tiles {
		if tl.Discovered != nil {
			reached++
			if tl.Content == nil || tl.Content.Native || tl.Content.Key == "" {
				t.Fatalf("reached tile %v content %+v", tl.Hex, tl.Content)
			}
			if tl.Content.Drawn > tl.Discovered.Tick {
				t.Fatalf("tile %v drawn at %d after its discovery at %d", tl.Hex, tl.Content.Drawn, tl.Discovered.Tick)
			}
		}
	}
	if reached < 100 || reached != len(contents) {
		t.Fatalf("%d tiles reached, %d hold content", reached, len(contents))
	}
}
