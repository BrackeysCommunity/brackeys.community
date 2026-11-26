package mapview_test

import (
	"regexp"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/mapview"
)

func TestRev(t *testing.T) {
	c := api.MapChunk{World: "w", A: 1, B: -2, Level: api.LevelTile, Cells: []api.MapCell{{Q: 3, R: 4, Terrain: "plain"}}}
	rev := mapview.Rev(c)
	if !regexp.MustCompile(`^[0-9a-f]{16}$`).MatchString(rev) {
		t.Fatalf("rev %q is not 16 hex", rev)
	}
	c.Rev = "anything"
	if mapview.Rev(c) != rev || mapview.Rev(&c) != rev {
		t.Fatal("a chunk's rev reads its own Rev")
	}
	c.Cells[0].Road = 1
	if mapview.Rev(c) == rev {
		t.Fatal("a changed cell kept the rev")
	}
	r := api.MapRegions{World: "w", Rows: []api.MapRow{{R: 1, Q: 2, Slots: []int64{0}}}}
	rr := mapview.Rev(r)
	r.Rev = rr
	if mapview.Rev(r) != rr || mapview.Rev(&r) != rr {
		t.Fatal("the regions' rev reads its own Rev")
	}
	s := api.MapStyle{Entries: []api.MapStyleEntry{{ID: "ink", Colour: "#000000", Alpha: 255}}}
	sr := mapview.Rev(s)
	s.Rev = sr
	if mapview.Rev(s) != sr || mapview.Rev(&s) != sr {
		t.Fatal("the style's rev reads its own Rev")
	}
}
