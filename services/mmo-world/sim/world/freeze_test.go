package world_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/world"
)

// v0 loads a replay fixture's snapshot: a world saved before content was
// drawn from history.
func v0(t testing.TB, label string) (*world.State, *fact.Mem, *harness.Replay) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "replay", label+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var r harness.Replay
	if err := json.Unmarshal(raw, &r); err != nil {
		t.Fatal(err)
	}
	b := book(t)
	k := keys.Throwaway(r.Label)
	g, err := gen.New(b, k.Generation)
	if err != nil {
		t.Fatal(err)
	}
	var s world.State
	if err := json.Unmarshal(r.Snapshot, &s); err != nil {
		t.Fatal(err)
	}
	s.Attach(b, g, k.Roll)
	log := &fact.Mem{}
	for _, f := range r.Facts {
		if _, err := log.Append(f); err != nil {
			t.Fatal(err)
		}
	}
	if s.ContentVersion != world.ContentNative {
		t.Fatalf("fixture %s is at content version %d", label, s.ContentVersion)
	}
	return &s, log, &r
}

// Freezing a world from before content was drawn stores the seed's own
// content on every discovered tile and nowhere else, moves the world to
// drawing, and is refused a second time with nothing changed.
func TestFreeze(t *testing.T) {
	s, log, _ := v0(t, "replay-explorer")
	g := s.Gen()
	discovered := 0
	for _, tl := range s.Tiles {
		if tl.Discovered != nil {
			discovered++
		}
	}
	if discovered == 0 {
		t.Fatal("the fixture discovered nothing")
	}
	n, err := s.Freeze(log)
	if err != nil || n != discovered {
		t.Fatalf("froze %d of %d tiles: %v", n, discovered, err)
	}
	if !s.Drawn() || len(s.Edited()) != n {
		t.Fatalf("version %d, %d tiles edited", s.ContentVersion, len(s.Edited()))
	}
	dungeons := 0
	for _, tl := range s.Tiles {
		c := tl.Content
		if tl.Discovered == nil {
			if c != nil {
				t.Fatalf("undiscovered tile %v froze", tl.Hex)
			}
			continue
		}
		want := g.Native(tl.Hex)
		if c == nil || !c.Native || c.Key != "" || c.Digest != nil || c.SiteKind != "" || c.Lead != want.Lead || sum(t, c.Stock) != sum(t, want.Stock) {
			t.Fatalf("tile %v froze to %+v, native %+v", tl.Hex, c, want)
		}
		if (c.Dungeon == nil) != (want.Dungeon == nil) {
			t.Fatalf("tile %v froze dungeon %+v, native %+v", tl.Hex, c.Dungeon, want.Dungeon)
		}
		if p := c.Dungeon; p != nil {
			dungeons++
			w := want.Dungeon
			if p.Kind != w.Kind || p.Floors != w.Floors || p.Guardian != w.Guardian || p.Up != w.Up || p.SeedTier != w.SeedTier || len(p.Drawn) != 0 || len(p.Ways) != 0 {
				t.Fatalf("tile %v froze plan %+v, native %+v", tl.Hex, p, w)
			}
		}
	}
	last := log.Since(0)[log.Len()-1]
	if d, ok := last.Get("tiles"); last.Kind != "world.content-frozen" || !ok || d.N != int64(n) {
		t.Fatalf("the freeze wrote %+v", last)
	}
	before := digest(t, s, log)
	_, err = s.Freeze(log)
	var r *world.Refusal
	if !errors.As(err, &r) || r.Code != world.CodeAlreadyFrozen {
		t.Fatalf("a second freeze gave %v", err)
	}
	if digest(t, s, log) != before {
		t.Fatal("a refused freeze changed the world")
	}
	h := unreached(t, s, 9)
	if err := s.Discover(log, h, fact.Ref{Kind: "character", ID: "c-1"}); err != nil {
		t.Fatal(err)
	}
	if c := s.Content(h); c == nil || c.Native || c.Key == "" {
		t.Fatalf("a tile first reached after the freeze holds %+v", c)
	}
	t.Logf("froze %d tiles, %d of them dungeon entrances", n, dungeons)
}
