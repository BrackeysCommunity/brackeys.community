package api

import (
	"fmt"
	"net/url"
	"strings"
	"testing"
)

func TestMapPaths(t *testing.T) {
	world := []string{PathMapIndex, PathMapStyle, PathMapRegions, PathMapChunk, PathMapOverlay, PathMapFocus}
	activity := []string{PathActivityMapTick, PathActivityMapStyle, PathActivityMapRegions, PathActivityMapChunk, PathActivityMapOverlay}
	for _, p := range world {
		if !strings.HasPrefix(p, PathMap+"/") || len(p) == len(PathMap)+1 {
			t.Errorf("world map path %q is not under %s/", p, PathMap)
		}
	}
	for _, p := range activity {
		if !strings.HasPrefix(p, "/api/activity/map/") || len(p) == len("/api/activity/map/") {
			t.Errorf("activity map path %q is not under /api/activity/map/", p)
		}
	}
	distinct(t, "path", append(append([]string{PathMap}, world...), activity...))
}

func TestMapConstantsDistinct(t *testing.T) {
	groups := map[string][]string{
		"level":  {LevelRegion, LevelArea, LevelTile},
		"fog":    {FogSight, FogSeen, FogDiscovered, FogUnknown},
		"viewer": {ViewerAnonymous, ViewerPlayer, ViewerCharacter},
		"busy":   {BusyLight, BusyBusy, BusyCrowded},
		"place":  {PlaceSettlement, PlaceCity, PlaceCityTile, PlaceRuin, PlaceFaction},
	}
	var all []string
	for kind, vs := range groups {
		for _, v := range vs {
			if v == "" {
				t.Errorf("%s constant is empty; \"\" is reserved for none", kind)
			}
		}
		distinct(t, kind, vs)
		all = append(all, vs...)
	}
	// One string never means two things on the wire.
	distinct(t, "map", all)
}

func distinct(t *testing.T, kind string, vs []string) {
	t.Helper()
	seen := map[string]bool{}
	for _, v := range vs {
		if seen[v] {
			t.Errorf("%s constant %q appears twice", kind, v)
		}
		seen[v] = true
	}
}

func TestParseMapOverlayQuery(t *testing.T) {
	many := func(n int) string {
		ids := make([]string, n)
		for i := range ids {
			ids[i] = fmt.Sprintf("%d.%d", i, -i)
		}
		return strings.Join(ids, ",")
	}
	cases := []struct {
		name, query string
		chunks      int
		sight, ok   bool
	}{
		{"chunks", "chunks=1.2,-3.4", 2, false, true},
		{"sight", "scope=sight", 0, true, true},
		{"both", "chunks=1.2&scope=sight", 0, false, false},
		{"neither", "", 0, false, false},
		{"another scope", "scope=all", 0, false, false},
		{"the most chunks", "chunks=" + many(MapOverlayMaxChunks), MapOverlayMaxChunks, false, true},
		{"one past the most", "chunks=" + many(MapOverlayMaxChunks+1), 0, false, false},
		{"a bad pair", "chunks=1.2,3", 0, false, false},
		{"a pair that is no number", "chunks=1.x", 0, false, false},
	}
	for _, c := range cases {
		v, err := url.ParseQuery(c.query)
		if err != nil {
			t.Fatal(err)
		}
		q, ref := ParseMapOverlayQuery(v)
		if c.ok != (ref == nil) {
			t.Errorf("%s: refusal %v", c.name, ref)
			continue
		}
		if !c.ok {
			if *ref != *MapOverlayRefusal() {
				t.Errorf("%s: refused with %+v", c.name, *ref)
			}
			continue
		}
		if q.Sight != c.sight || len(q.Chunks) != c.chunks {
			t.Errorf("%s: got %+v", c.name, q)
		}
	}
	q, _ := ParseMapOverlayQuery(url.Values{"chunks": {"1.2,-3.4"}})
	if q.Chunks[0] != (MapChunkID{A: 1, B: 2}) || q.Chunks[1] != (MapChunkID{A: -3, B: 4}) {
		t.Errorf("chunks read as %+v", q.Chunks)
	}
}

func TestMapOverlayQueryCheck(t *testing.T) {
	chunks := func(n int) []MapChunkID { return make([]MapChunkID, n) }
	for _, tc := range []struct {
		name string
		q    MapOverlayQuery
		ok   bool
	}{
		{"sight", MapOverlayQuery{Sight: true}, true},
		{"one chunk", MapOverlayQuery{Chunks: chunks(1)}, true},
		{"max chunks", MapOverlayQuery{Chunks: chunks(MapOverlayMaxChunks)}, true},
		{"none", MapOverlayQuery{}, false},
		{"both", MapOverlayQuery{Chunks: chunks(1), Sight: true}, false},
		{"too many", MapOverlayQuery{Chunks: chunks(MapOverlayMaxChunks + 1)}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ref := tc.q.Check()
			if tc.ok {
				if ref != nil {
					t.Fatalf("refused: %+v", ref)
				}
				return
			}
			if ref == nil || *ref != *MapOverlayRefusal() {
				t.Fatalf("got %+v, want the overlay refusal", ref)
			}
		})
	}
}
