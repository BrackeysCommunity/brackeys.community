package gen_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/history"
	"jams.team/mmo-world/sim/keys"
)

var overlayChunks = []gen.ChunkCoord{{A: 0, B: 0}, {A: 1, B: 0}, {A: -1, B: 1}}

func chunkSums(t *testing.T, g *gen.Gen) []string {
	t.Helper()
	var out []string
	for _, cc := range overlayChunks {
		d, err := canon.Digest(g.Chunk(cc))
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, d.String())
	}
	return out
}

// An empty overlay is the pure generator: the same routes and chunks as New,
// from a fresh key or as a twin of a Gen that has laid elsewhere first.
func TestOverlayRoutes(t *testing.T) {
	b := book(t)
	key := keys.Throwaway("overlay").Generation
	pure := newGen(t, b, "overlay")
	want := chunkSums(t, pure)
	if len(pure.Routes().Paths) == 0 {
		t.Fatal("laying chunks laid no corridors")
	}
	empty, err := gen.Overlay(b, key, nil)
	if err != nil {
		t.Fatal(err)
	}
	used := newGen(t, b, "overlay")
	used.Chunk(gen.ChunkCoord{A: 4, B: -3})
	twin, err := used.Twin(map[gen.Hex]gen.Ground{})
	if err != nil {
		t.Fatal(err)
	}
	for name, g := range map[string]*gen.Gen{"overlay": empty, "twin": twin} {
		got := chunkSums(t, g)
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%s: chunk %v differs from New's", name, overlayChunks[i])
			}
		}
		if !g.Routes().Equal(pure.Routes()) {
			t.Fatalf("%s: routes differ from New's", name)
		}
	}
	if twin.Routes().Equal(used.Routes()) {
		t.Fatal("a twin shares its routes with the Gen it was made from")
	}

	// A patch reads as its ground in the overlay, as GroundTile lays it on
	// the pure Gen, and never reaches the Gen it was twinned from.
	var at gen.Hex
	found := false
	for _, x := range pure.Chunk(gen.ChunkCoord{}).Tiles {
		if pure.Passable(x.Terrain) && x.Terrain != "forest" && x.Site == "" && !x.Yielded && !x.River && x.Secondary == "" && x.Elevation < pure.ElevationMax() {
			at, found = x.Hex, true
			break
		}
	}
	if !found {
		t.Fatal("no open tile in the centre chunk")
	}
	gr := gen.Ground{Terrain: "forest", Elevation: pure.Baseline(at).Elevation + 1}
	before, raw := pure.Baseline(at), pure.RawTerrain(at)
	laid, err := pure.Twin(map[gen.Hex]gen.Ground{at: gr})
	if err != nil {
		t.Fatal(err)
	}
	o, g := laid.Baseline(at), pure.GroundTile(at, gr)
	if o.Terrain != gr.Terrain || o.Elevation != gr.Elevation {
		t.Fatalf("the overlay reads %s at %d, not its ground", o.Terrain, o.Elevation)
	}
	if !o.Yielded && !o.River && (g.Terrain != o.Terrain || g.Elevation != o.Elevation || g.Water != o.Water || g.Cover != o.Cover) {
		t.Fatalf("GroundTile %+v and the overlay %+v disagree", g, o)
	}
	if g.Variant != "" || g.Secondary != "" || g.Edge != "" || g.River || g.Ford || g.Yielded || g.Region != before.Region || g.Moisture != before.Moisture {
		t.Fatalf("GroundTile kept or lost the wrong fields: %+v", g)
	}
	if pure.Baseline(at) != before || pure.RawTerrain(at) != raw {
		t.Fatal("a twin's ground reached the Gen it was made from")
	}
	for _, h := range hex.Ring(at, 1) {
		if laid.RawTerrain(h) != pure.RawTerrain(h) {
			t.Fatalf("ground on %s moved %s's raw terrain", at.Ref(), h.Ref())
		}
	}

	if _, err := pure.Twin(map[gen.Hex]gen.Ground{at: {Terrain: "no-such"}}); err == nil {
		t.Fatal("a twin took a terrain the sheets do not hold")
	}
	if _, err := pure.Twin(map[gen.Hex]gen.Ground{at: {Terrain: "forest", Elevation: pure.ElevationMax() + 1}}); err == nil {
		t.Fatal("a twin took an elevation past the noise")
	}
}

// ContentOn with a tile's own baseline draws what Content does; with
// another terrain it draws that terrain's lead.
func TestContentOn(t *testing.T) {
	b := book(t)
	g := newGen(t, b, "content-on")
	for _, x := range g.Chunk(gen.ChunkCoord{}).Tiles {
		if x.Site != "" {
			continue
		}
		d := g.Content(x.Hex, "", history.Digest{}, "k")
		if got := g.ContentOn(x.Hex, x, "", history.Digest{}, "k"); got.Lead != d.Lead || got.SiteKind != d.SiteKind || len(got.Stock) != len(d.Stock) {
			t.Fatalf("ContentOn on %s's own baseline drew %+v, not %+v", x.Hex.Ref(), got, d)
		}
		for _, ter := range []string{"forest", "marsh", "mountain"} {
			gt := g.GroundTile(x.Hex, gen.Ground{Terrain: ter})
			rows := g.ArchetypesOf(ter)
			lead := g.ContentOn(x.Hex, gt, "", history.Digest{}, "k").Lead
			if (len(rows) == 0) != (lead == "") || (lead != "" && !slices.Contains(rows, lead)) {
				t.Fatalf("a lead of %q on %s ground", lead, ter)
			}
		}
		return
	}
	t.Fatal("no open tile in the centre chunk")
}
