package render_test

import (
	"bytes"
	"image/color"
	"os"
	"path/filepath"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/sim/hex"
)

// TestPictures draws one of each picture; RENDER_OUT keeps them to look at.
func TestPictures(t *testing.T) {
	b := testkit.Book(t)
	style, err := render.MapStyleOf(b)
	if err != nil {
		t.Fatal(err)
	}
	var tiles []render.MapTile
	for _, h := range hex.Disc(4) {
		fog := []string{api.FogSight, api.FogSight, api.FogSeen, api.FogDiscovered, api.FogUnknown}[h.Len()]
		tiles = append(tiles, render.MapTile{Hex: h, Fog: fog, Terrain: []string{"plain", "forest", "hills", "marsh"}[(h.Q+8)%4], River: h.R == 1,
			Site: map[bool]string{true: "starting-settlement"}[h == hex.Hex{}], Weather: map[bool]string{true: "storm"}[h.Q > 1], Region: "r-1", Threat: 640,
			Danger: h.Q == -1, Age: h.Len(), Busy: map[bool]string{true: api.BusyBusy}[h.R == -1], Trouble: h.Q == 2, Fire: h.R == 2})
	}
	m := render.Map(render.MapCrop{Radius: 4, Tiles: tiles, Route: []hex.Hex{{Q: 1}, {Q: 2}}}, style)
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

// TestMapPictureFogStates draws one tile in each fog state among
// discovered neighbours: fog alone when unknown, the terrain alone when
// never seen, dimmed terrain with its age when last seen, and full terrain
// inside the sight rim when in sight. Each state draws otherwise.
func TestMapPictureFogStates(t *testing.T) {
	style, err := render.MapStyleOf(testkit.Book(t))
	if err != nil {
		t.Fatal(err)
	}
	draw := func(target render.MapTile) *render.Canvas {
		target.Hex, target.Terrain, target.Region = hex.Hex{}, "plain", "r-1"
		tiles := []render.MapTile{target}
		for _, h := range hex.Ring(hex.Hex{}, 1) {
			tiles = append(tiles, render.MapTile{Hex: h, Fog: api.FogDiscovered, Terrain: "plain", Region: "r-1"})
		}
		return render.Map(render.MapCrop{Radius: 1, Tiles: tiles, At: hex.Hex{Q: -1}}, style)
	}
	live := render.MapTile{Threat: 640, Trouble: true, Busy: api.BusyCrowded, Toll: 2}
	states := map[string]render.MapTile{api.FogUnknown: {Fog: api.FogUnknown}}
	for _, fog := range []string{api.FogDiscovered, api.FogSeen, api.FogSight} {
		x := live
		x.Fog = fog
		states[fog] = x
	}
	pngs := map[string][]byte{}
	pics := map[string]*render.Canvas{}
	for fog, tl := range states {
		pics[fog] = draw(tl)
		b, err := pics[fog].PNG()
		if err != nil {
			t.Fatal(err)
		}
		pngs[fog] = b
		if dir := os.Getenv("RENDER_OUT"); dir != "" {
			if err := os.WriteFile(filepath.Join(dir, "map-"+fog+".png"), b, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	for a, pa := range pngs {
		for b, pb := range pngs {
			if a < b && bytes.Equal(pa, pb) {
				t.Errorf("%s and %s draw the same picture", a, b)
			}
		}
	}
	at := func(c *render.Canvas, dx, dy int) color.NRGBA {
		b := c.Img.Bounds()
		return color.NRGBAModel.Convert(c.Img.At(b.Dx()/2+dx, b.Dy()/2+dy)).(color.NRGBA)
	}
	plain, fog, rim := style.Colour("terrain:plain"), style.Colour("fog:unknown"), style.Colour("fog:sight")
	near := func(got, want color.NRGBA) bool {
		d := func(x, y uint8) bool { return int(x)-int(y) <= 2 && int(y)-int(x) <= 2 }
		return d(got.R, want.R) && d(got.G, want.G) && d(got.B, want.B)
	}
	keep := 100 - style.SeenDim
	dim := color.NRGBA{uint8(int64(plain.R) * keep / 100), uint8(int64(plain.G) * keep / 100), uint8(int64(plain.B) * keep / 100), 0xff}
	for fog, want := range map[string]color.NRGBA{api.FogUnknown: fog, api.FogDiscovered: plain, api.FogSeen: dim, api.FogSight: plain} {
		if got := at(pics[fog], 0, 8); !near(got, want) {
			t.Errorf("%s: the tile's ground is %v, want %v", fog, got, want)
		}
	}
	const edge = 21 // the side shared with the east neighbour
	if got := at(pics[api.FogSight], edge, 0); !near(got, rim) {
		t.Errorf("in sight, the edge towards an unseen neighbour is %v, want the rim %v", got, rim)
	}
	for _, fog := range []string{api.FogDiscovered, api.FogSeen} {
		if got := at(pics[fog], edge, 0); near(got, rim) {
			t.Errorf("%s: the tile carries the sight rim", fog)
		}
	}
	bare, err := draw(render.MapTile{Fog: api.FogDiscovered}).PNG()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(bare, pngs[api.FogDiscovered]) {
		t.Error("a tile never seen draws live marks")
	}
	older := states[api.FogSeen]
	older.Age = 3
	aged, err := draw(older).PNG()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(aged, pngs[api.FogSeen]) {
		t.Error("a last-seen tile's age draws nothing")
	}
}
