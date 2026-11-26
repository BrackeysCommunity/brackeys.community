package harness

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/hex"
)

// mapQuick is a world of 2,107 tiles, small enough for a test.
var mapQuick = mapScenario{disc: 26, least: 2000, chars: 24, guilds: 3, ring: 12, walk: 5, ticks: 24, reads: 20,
	core: 9, reach: 5, walkers: 8, leg: 3, day: 36}

func TestMapRunQuick(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	out := t.TempDir()
	readings, err := mapRun(b, out, 1, mapQuick)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(readings))
	for i, m := range readings {
		ids[i] = m.Target
	}
	if !slices.Equal(ids, []string{"map-load-budget", "map-seen-cost"}) {
		t.Fatalf("readings %v", ids)
	}
	raw, err := os.ReadFile(filepath.Join(out, "map.json"))
	if err != nil {
		t.Fatal(err)
	}
	var got mapJSON
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	r := got.Seeds[0]
	if r.Tiles < mapQuick.least || r.Characters != mapQuick.chars || r.Guilds != mapQuick.guilds {
		t.Fatalf("the world: %d tiles, %d characters, %d guilds", r.Tiles, r.Characters, r.Guilds)
	}
	if r.ColdRequests != coldRequests || r.ColdBytes != r.StyleBytes+r.IndexBytes+r.RegionsBytes+r.SightBytes {
		t.Fatalf("the first draw: %d requests, %d bytes", r.ColdRequests, r.ColdBytes)
	}
	// Sizes scale with the world, so a small one is well inside them.
	for name, ok := range map[string]bool{
		"first draw": r.ColdBytes <= coldBytes, "tile view": r.ViewBytes <= viewBytes && r.ViewRequests <= viewRequests,
		"tile chunk": r.TileChunkMax <= tileChunkBytes, "area chunk": r.AreaChunkMax <= areaChunkBytes,
		"overlay": r.OverlayOver <= 0, "every area chunk": r.AreaAll <= allAreaBytes,
	} {
		if !ok {
			t.Errorf("%s over its bound: %+v", name, r)
		}
	}
	if r.ModelledMs <= ms(roundTrips*roundTrip) || got.ModelledMs != r.ModelledMs {
		t.Fatalf("the modelled first draw: %.1f ms, map.json %.1f ms", r.ModelledMs, got.ModelledMs)
	}
	s := r.Seen
	if s.SmallTiles != hex.DiscSize(mapQuick.core) || s.BigTiles != hex.DiscSize(mapQuick.disc) {
		t.Fatalf("the seen-cost worlds: %d and %d tiles", s.SmallTiles, s.BigTiles)
	}
	if s.Moves == 0 || s.SmallRecords == 0 || s.Apart != 0 {
		t.Fatalf("the walk: %d tiles walked, %d records, %d walker-ticks apart", s.Moves, s.SmallRecords, s.Apart)
	}
	if s.recordRatio() > seenRatio {
		t.Fatalf("records %d on the disc against %d on the core", s.BigRecords, s.SmallRecords)
	}

	dump := filepath.Join(out, "dump")
	for _, name := range []string{"style.json", "index.json", "regions.json", "overlay-sight.json", "overlay-tile.json", "view.json"} {
		if _, err := os.Stat(filepath.Join(dump, name)); err != nil {
			t.Fatal(err)
		}
	}
	for _, level := range []string{api.LevelArea, api.LevelTile} {
		files, err := filepath.Glob(filepath.Join(dump, "chunks", level, "*.json"))
		if err != nil || len(files) != r.Chunks {
			t.Fatalf("%d %s chunks dumped of %d: %v", len(files), level, r.Chunks, err)
		}
	}
	var view dumpView
	raw, err = os.ReadFile(filepath.Join(dump, "view.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &view); err != nil {
		t.Fatal(err)
	}
	if view.Tile.Character == "" || len(view.Tile.Chunks) == 0 || len(view.Tile.Asked) > mapAsked || view.Tile.Camera.Size != mapTileSize {
		t.Fatalf("the tile view: %+v", view.Tile)
	}
}

func TestMapChunksInView(t *testing.T) {
	index := api.MapIndex{ChunkRadius: 2}
	for a := int64(-3); a <= 3; a++ {
		for b := int64(-3); b <= 3; b++ {
			// The world's lattice: A·(2n+1, −n) + B·(n, n+1).
			index.Chunks = append(index.Chunks, api.MapChunkRef{A: a, B: b, Centre: api.Hex{Q: 5*a + 2*b, R: -2*a + 3*b}})
		}
	}
	at := centreOn(hex.Hex{Q: 7, R: 1}, mapTileSize)
	in := chunksInView(index, at, mapScreen, -1)
	if len(in) == 0 || in[0].A != 1 || in[0].B != 1 {
		t.Fatalf("nearest first: %+v", in)
	}
	if got := chunksInView(index, at, mapScreen, 3); !slices.Equal(got, in[:3]) {
		t.Fatalf("at most 3: %+v", got)
	}
	far := centreOn(hex.Hex{Q: 400, R: 0}, mapTileSize)
	if got := chunksInView(index, far, mapScreen, -1); len(got) != 0 {
		t.Fatalf("a view far off: %+v", got)
	}
	wide := mapCamera{Size: 1}
	if got := chunksInView(index, wide, mapScreen, -1); len(got) != len(index.Chunks) {
		t.Fatalf("a view over everything: %d of %d", len(got), len(index.Chunks))
	}
}
