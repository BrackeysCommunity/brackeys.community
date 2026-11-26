package render

import (
	"image/color"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
)

func opaque(c color.RGBA) color.NRGBA { return Alpha(c, 0xff) }

// The pack's map style carries today's picture colours unchanged.
func TestMapStyleOf(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	s, err := MapStyleOf(b)
	if err != nil {
		t.Fatal(err)
	}
	for _, ter := range b.Terrain {
		want, ok := terrainColour[ter.ID]
		if !ok {
			t.Errorf("terrain %s has no picture colour", ter.ID)
			continue
		}
		if got := s.Colour("terrain:" + ter.ID); got != opaque(want) {
			t.Errorf("terrain:%s is %v, want %v", ter.ID, got, opaque(want))
		}
	}
	for _, w := range b.Weather {
		tint, ok := weatherTint[w.ID]
		if !ok {
			t.Errorf("weather %s has no tint", w.ID)
			continue
		}
		want := Alpha(tint, 0x50)
		if w.ID == "clear" {
			want = Alpha(tint, 0)
		}
		if got := s.Colour("weather:" + w.ID); got != want {
			t.Errorf("weather:%s is %v, want %v", w.ID, got, want)
		}
	}
	for id, want := range map[string]color.NRGBA{
		"fog:unknown":      opaque(fogColour),
		"fog:seen":         Alpha(tar, 115),
		"fog:sight":        opaque(hazard),
		"layer:corruption": Alpha(corrupt, 0x60),
		"layer:danger":     Alpha(rust, 0xa0),
		"layer:self":       opaque(hazard),
		"layer:route":      opaque(hazard),
		"place:settlement": opaque(settlement),
		"site:dungeon":     opaque(dungeon),
		"site:other":       opaque(site),
		"water:river":      opaque(river),
		"water:lake":       opaque(terrainColour["deep-water"]),
		"road":             opaque(Hex("#5a4a3a")),
		"ink":              opaque(ink),
		"paper":            opaque(paper),
		"region-border":    Alpha(border, border.A),
	} {
		if got := s.Colour(id); got != want {
			t.Errorf("%s is %v, want %v", id, got, want)
		}
	}
	for id, want := range map[string][2]string{
		"fog:unknown": {"", "hatch"}, "fog:seen": {"", "dots"}, "fog:sight": {"", "rim"},
		"place:settlement": {"diamond", ""}, "site:dungeon": {"square", ""}, "site:other": {"circle", ""},
		"layer:self": {"ring", ""}, "layer:trouble": {"triangle", ""}, "layer:corruption": {"", "stripes"},
	} {
		if g, p := s.Glyph(id), s.Pattern(id); g != want[0] || p != want[1] {
			t.Errorf("%s draws glyph %q pattern %q, want %q %q", id, g, p, want[0], want[1])
		}
	}
	if s.SeenDim != 45 {
		t.Errorf("seen-dim %d", s.SeenDim)
	}
	if got := s.Colour("terrain:nowhere"); got != opaque(unknownTerrain) {
		t.Errorf("an id the pack lacks is %v", got)
	}
}

// A pack that lacks an entry the map draws by is refused.
func TestMapStyleOfRefusesGaps(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	cut := *b
	cut.MapStyle = slices.DeleteFunc(slices.Clone(b.MapStyle), func(e sheets.MapStyle) bool { return e.ID == "terrain-peak" })
	cut.MapView = slices.DeleteFunc(slices.Clone(b.MapView), func(p sheets.Param) bool { return p.ID == "busy-distinct" })
	_, err = MapStyleOf(&cut)
	if err == nil || !strings.Contains(err.Error(), "terrain:peak") || !strings.Contains(err.Error(), "busy-distinct") {
		t.Fatalf("a pack without terrain:peak and busy-distinct: %v", err)
	}
	cut = *b
	cut.MapStyle = slices.Clone(b.MapStyle)
	cut.MapStyle[0].Colour = "#ABC"
	if _, err := MapStyleOf(&cut); err == nil || !strings.Contains(err.Error(), "#rrggbb") {
		t.Fatalf("a short colour: %v", err)
	}
}
