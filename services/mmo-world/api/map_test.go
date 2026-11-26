package api

import (
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
