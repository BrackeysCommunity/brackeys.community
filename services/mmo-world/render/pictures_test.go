package render_test

import (
	"os"
	"path/filepath"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/sim/hex"
)

// TestPictures draws one of each picture; RENDER_OUT keeps them to look at.
func TestPictures(t *testing.T) {
	b := testkit.Book(t)
	var tiles []render.MapTile
	for _, h := range hex.Disc(4) {
		tiles = append(tiles, render.MapTile{Hex: h, Known: h.Len() < 3, Terrain: []string{"plain", "forest", "hills", "marsh"}[(h.Q+8)%4], River: h.R == 1,
			Site: map[bool]string{true: "starting-settlement"}[h == hex.Hex{}], Weather: map[bool]string{true: "storm"}[h.Q > 1], Region: "r-1", Threat: 640})
	}
	m := render.Map(render.MapCrop{Radius: 4, Tiles: tiles, Route: []hex.Hex{{Q: 1}, {Q: 2}}, ThreatLine: 600, CorruptionLine: 500})
	ban, err := render.Banner(render.BannerInput{Seed: "r-3", Terrain: "hills", Weather: "storm", Hour: 14, Threat: 640, Danger: true, Settlement: true, Tags: []string{"militant"}}, b.BannerLayers, b.Palette)
	if err != nil {
		t.Fatal(err)
	}
	sig := render.Sigil(render.SigilInput{Process: "shape", Slot: "hook", Axes: [2]int{2, 6}, Level: 7, Picks: 1, Maker: "c-1"})
	for name, c := range map[string]*render.Canvas{"map": m, "banner": ban, "sigil": sig} {
		png, err := c.PNG()
		if err != nil || len(png) == 0 {
			t.Fatal(name, err)
		}
		if dir := os.Getenv("RENDER_OUT"); dir != "" {
			if err := os.WriteFile(filepath.Join(dir, name+".png"), png, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
}
