package mapview_test

import (
	"encoding/json"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/world"
)

const (
	baseWorldID     = "w-mapview"
	baseTickSeconds = 600
	baseStyleRev    = "style-rev"
	baseDisc        = 12
	// baseFar is how far east of home the lone discovered tile lies.
	baseFar = 40
)

// baseWorld is a game with one character, whose guild runs the first
// settlement, and a disc of discovered tiles round it plus one lone tile
// far off on the same row.
type baseWorld struct {
	g    *game.Game
	c    *game.Char
	home hex.Hex
	lone hex.Hex
}

func baseRules(t *testing.T) *game.Rules {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := game.NewRules(b, keys.Throwaway("mapview-base"))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func newBaseWorld(t *testing.T) *baseWorld {
	t.Helper()
	g, err := game.New(baseRules(t))
	if err != nil {
		t.Fatal(err)
	}
	res, err := g.Act(game.Command{Key: "a", Kind: game.Create, Server: "srv-1", Note: "Tinkers"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	m := &baseWorld{g: g, c: res.Char, home: g.Places[0].Hex}
	for _, h := range hex.DiscAt(m.home, baseDisc) {
		m.discover(t, h)
	}
	m.lone = m.home.Add(hex.Direction(0).Scale(baseFar))
	m.discover(t, m.lone)
	return m
}

func (m *baseWorld) discover(t *testing.T, h hex.Hex) {
	t.Helper()
	if err := m.g.World.Discover(m.g.Log, h, fact.Ref{Kind: "character", ID: m.c.C.ID}); err != nil {
		t.Fatal(err)
	}
}

func (m *baseWorld) found(h hex.Hex) bool {
	st := m.g.World.Tile(h)
	return st != nil && st.Discovered != nil
}

func (m *baseWorld) build() *mapview.Base {
	return mapview.Build(m.g, baseWorldID, baseTickSeconds, baseStyleRev)
}

func (m *baseWorld) discovered() []hex.Hex {
	var out []hex.Hex
	for _, st := range m.g.World.Tiles {
		if st.Discovered != nil {
			out = append(out, st.Hex)
		}
	}
	return out
}

// baseChunks are every chunk payload the index names, at both levels.
func baseChunks(t *testing.T, b *mapview.Base) []api.MapChunk {
	t.Helper()
	var out []api.MapChunk
	for _, ref := range b.Index.Chunks {
		for _, level := range []string{api.LevelArea, api.LevelTile} {
			c, ok := b.Chunk(ref.A, ref.B, level)
			if !ok {
				t.Fatalf("index names chunk %d.%d but it has no %s payload", ref.A, ref.B, level)
			}
			out = append(out, c)
		}
	}
	return out
}

func baseCellHex(c api.MapCell) hex.Hex { return hex.Hex{Q: c.Q, R: c.R} }

func TestBaseDiscoveredOnly(t *testing.T) {
	m := newBaseWorld(t)
	g := m.g
	// A settlement on a tile nobody found: neither it, its name nor its
	// tile may show anywhere.
	hidden := m.home.Add(hex.Direction(3).Scale(baseFar))
	if m.found(hidden) {
		t.Fatal("the hidden tile is discovered")
	}
	g.Places = append(g.Places, &game.Place{N: len(g.Places), Hex: hidden, Lattice: -1, Name: "Nowhere Hidden", Guild: "g-1"})
	b := m.build()

	want := m.discovered()
	gn := g.World.Gen()
	perLevel := map[string]map[hex.Hex]int{api.LevelArea: {}, api.LevelTile: {}}
	for _, c := range baseChunks(t, b) {
		refs := map[string]bool{}
		for _, cell := range c.Cells {
			h := baseCellHex(cell)
			if !m.found(h) {
				t.Fatalf("chunk %d.%d %s holds undiscovered %v", c.A, c.B, c.Level, h)
			}
			if gn.ChunkOf(h) != (gen.ChunkCoord{A: c.A, B: c.B}) {
				t.Fatalf("%v is in chunk %d.%d, not its own", h, c.A, c.B)
			}
			perLevel[c.Level][h]++
			for _, ref := range []string{cell.Region, cell.PlaceRef, cell.Guild} {
				if ref != "" {
					refs[ref] = true
				}
			}
		}
		for ref := range c.Names {
			if !refs[ref] {
				t.Fatalf("chunk %d.%d %s names %s, which none of its cells carries", c.A, c.B, c.Level, ref)
			}
		}
	}
	for level, seen := range perLevel {
		if len(seen) != len(want) {
			t.Fatalf("%s level holds %d tiles, want %d", level, len(seen), len(want))
		}
		for h, n := range seen {
			if n != 1 {
				t.Fatalf("%s level holds %v %d times", level, h, n)
			}
		}
	}
	if b.Index.Tiles != int64(len(want)) {
		t.Fatalf("index counts %d tiles, want %d", b.Index.Tiles, len(want))
	}

	cc := gn.ChunkOf(hidden)
	for _, level := range []string{api.LevelArea, api.LevelTile, api.LevelRegion} {
		if _, ok := b.Chunk(cc.A, cc.B, level); ok {
			t.Fatalf("an undiscovered chunk has a %s payload", level)
		}
	}
	if slices.ContainsFunc(b.Index.Chunks, func(r api.MapChunkRef) bool { return r.A == cc.A && r.B == cc.B }) {
		t.Fatal("the index names an undiscovered chunk")
	}

	rowSeen := map[hex.Hex]bool{}
	for _, row := range b.Regions.Rows {
		if len(row.Slots) == 0 || row.Slots[0] < 0 || row.Slots[len(row.Slots)-1] < 0 {
			t.Fatalf("row %+v starts or ends on a gap", row)
		}
		for i, s := range row.Slots {
			h := hex.Hex{Q: row.Q + int64(i), R: row.R}
			switch {
			case s < 0 && m.found(h):
				t.Fatalf("discovered %v reads as a gap", h)
			case s >= 0 && !m.found(h):
				t.Fatalf("undiscovered %v has region slot %d", h, s)
			case s >= int64(len(b.Regions.Regions)):
				t.Fatalf("slot %d past the regions", s)
			case s >= 0:
				if b.Regions.Regions[s].Ref != world.RegionRef(g.World.RegionAt(h)) {
					t.Fatalf("%v's slot names %s", h, b.Regions.Regions[s].Ref)
				}
				rowSeen[h] = true
			}
		}
	}
	if len(rowSeen) != len(want) {
		t.Fatalf("rows hold %d tiles, want %d", len(rowSeen), len(want))
	}
	counted := map[string]int64{}
	for _, h := range want {
		counted[world.RegionRef(g.World.RegionAt(h))]++
	}
	for _, r := range b.Regions.Regions {
		if !m.found(hex.Hex{Q: r.Anchor.Q, R: r.Anchor.R}) {
			t.Fatalf("region %s anchors on an undiscovered tile", r.Ref)
		}
		if r.Tiles == 0 || r.Tiles != counted[r.Ref] {
			t.Fatalf("region %s counts %d tiles, want %d", r.Ref, r.Tiles, counted[r.Ref])
		}
	}
	if len(b.Regions.Regions) != len(counted) {
		t.Fatalf("%d regions, want %d", len(b.Regions.Regions), len(counted))
	}
	for _, d := range b.Regions.Places {
		if !m.found(hex.Hex{Q: d.Q, R: d.R}) {
			t.Fatalf("a dot on undiscovered %d,%d", d.Q, d.R)
		}
	}
	if !m.found(hex.Hex{Q: b.Index.Home.Q, R: b.Index.Home.R}) {
		t.Fatal("home is undiscovered")
	}

	hiddenRef := "settlement:" + strconv.Itoa(len(g.Places)-1)
	for _, v := range append([]any{b.Index, b.Regions}, baseAnys(baseChunks(t, b))...) {
		body, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		if s := string(body); strings.Contains(s, hiddenRef) || strings.Contains(s, "Nowhere Hidden") {
			t.Fatalf("a payload names the undiscovered settlement: %.200s", s)
		}
	}
}

func baseAnys[T any](xs []T) []any {
	out := make([]any, len(xs))
	for i, x := range xs {
		out[i] = x
	}
	return out
}

func TestBaseLevels(t *testing.T) {
	m := newBaseWorld(t)
	b := m.build()
	tileCells := map[hex.Hex]api.MapCell{}
	for _, ref := range b.Index.Chunks {
		c, _ := b.Chunk(ref.A, ref.B, api.LevelTile)
		for _, cell := range c.Cells {
			tileCells[baseCellHex(cell)] = cell
		}
	}
	for _, ref := range b.Index.Chunks {
		c, _ := b.Chunk(ref.A, ref.B, api.LevelArea)
		if c.Level != api.LevelArea {
			t.Fatalf("an area payload says %q", c.Level)
		}
		for _, cell := range c.Cells {
			tileOnly := api.MapCell{PlaceRef: cell.PlaceRef, Guild: cell.Guild, Site: cell.Site, SiteKind: cell.SiteKind,
				Landmark: cell.Landmark, RoadName: cell.RoadName, Structures: cell.Structures, Found: cell.Found}
			if !reflect.DeepEqual(tileOnly, api.MapCell{}) {
				t.Fatalf("area cell %v carries tile fields: %+v", baseCellHex(cell), tileOnly)
			}
			full := tileCells[baseCellHex(cell)]
			areaPart := api.MapCell{Q: full.Q, R: full.R, Terrain: full.Terrain, Secondary: full.Secondary, Blend: full.Blend,
				Water: full.Water, Region: full.Region, Edge: full.Edge, Road: full.Road, Place: full.Place}
			if !reflect.DeepEqual(areaPart, cell) {
				t.Fatalf("area cell %+v differs from its tile cell %+v", cell, full)
			}
			if cell.Terrain == "" || cell.Region == "" {
				t.Fatalf("area cell %v has no terrain or region", baseCellHex(cell))
			}
		}
		for ref := range c.Names {
			if !strings.HasPrefix(ref, "r-") {
				t.Fatalf("an area payload names %s, which only tile cells carry", ref)
			}
		}
	}
	home := tileCells[m.home]
	if home.Site != gen.PlaceSettlement || home.Place != api.PlaceSettlement || home.PlaceRef != "settlement:0" || home.Guild != "guild:g-1" {
		t.Fatalf("home's tile cell: %+v", home)
	}
	if home.Found != m.g.World.Tile(m.home).Discovered.Tick {
		t.Fatalf("home found %d", home.Found)
	}
	hc, _ := b.Chunk(m.g.World.Gen().ChunkOf(m.home).A, m.g.World.Gen().ChunkOf(m.home).B, api.LevelTile)
	if hc.Names["guild:g-1"] != "Tinkers" || hc.Names["settlement:0"] != m.g.PlaceName(m.home) || hc.Names[home.Region] == "" {
		t.Fatalf("home chunk's names: %v", hc.Names)
	}
	if b.Index.World != baseWorldID || b.Index.TickSeconds != baseTickSeconds || b.Index.Style != baseStyleRev || b.Index.ChunkRadius != m.g.World.Gen().ChunkRadius() ||
		b.Index.TicksPerDay == 0 || b.Index.Tick != m.g.Tick() || b.Index.Home != (api.Hex{Q: m.home.Q, R: m.home.R}) || b.Index.Regions != b.Regions.Rev {
		t.Fatalf("index: %+v", b.Index)
	}
	if !slices.IsSortedFunc(b.Index.Chunks, func(x, y api.MapChunkRef) int {
		if x.A != y.A {
			return int(x.A - y.A)
		}
		return int(x.B - y.B)
	}) {
		t.Fatal("index chunks are not sorted by (a, b)")
	}
	for _, ref := range b.Index.Chunks {
		c, _ := b.Chunk(ref.A, ref.B, api.LevelTile)
		if !slices.IsSortedFunc(c.Cells, func(x, y api.MapCell) int {
			if x.R != y.R {
				return int(x.R - y.R)
			}
			return int(x.Q - y.Q)
		}) {
			t.Fatalf("chunk %d.%d's cells are not sorted by (r, q)", ref.A, ref.B)
		}
		centre := m.g.World.Gen().ChunkCentre(gen.ChunkCoord{A: ref.A, B: ref.B})
		if ref.Centre != (api.Hex{Q: centre.Q, R: centre.R}) || ref.Tiles != int64(len(c.Cells)) {
			t.Fatalf("chunk ref %+v", ref)
		}
	}
}

func TestBaseRevStable(t *testing.T) {
	m := newBaseWorld(t)
	b1, b2 := m.build(), m.build()
	if !reflect.DeepEqual(b1.Index, b2.Index) || !reflect.DeepEqual(b1.Regions, b2.Regions) {
		t.Fatal("the same game built two different bases")
	}
	for _, ref := range b1.Index.Chunks {
		for _, level := range []string{api.LevelArea, api.LevelTile} {
			c, _ := b1.Chunk(ref.A, ref.B, level)
			if c.Rev != mapview.Rev(c) {
				t.Fatalf("chunk %d.%d %s rev %s is not its content's", ref.A, ref.B, level, c.Rev)
			}
		}
	}
	if b1.Regions.Rev != mapview.Rev(b1.Regions) {
		t.Fatal("the regions' rev is not their content's")
	}

	// A road on one inside tile changes only its own chunk's payloads.
	at := m.home.Add(hex.Direction(1).Scale(2))
	m.g.World.Tile(at).Road = world.RoadTrack
	b3 := m.build()
	if b3.Regions.Rev != b1.Regions.Rev {
		t.Fatal("a road moved the regions' rev")
	}
	changed := m.g.World.Gen().ChunkOf(at)
	if len(b3.Index.Chunks) != len(b1.Index.Chunks) {
		t.Fatal("a road changed the chunk list")
	}
	for i, ref := range b3.Index.Chunks {
		old := b1.Index.Chunks[i]
		moved := ref.Area != old.Area || ref.Tile != old.Tile
		mine := ref.A == changed.A && ref.B == changed.B
		if mine && (ref.Area == old.Area || ref.Tile == old.Tile) {
			t.Fatalf("the road's chunk kept a rev: %+v then %+v", old, ref)
		}
		if !mine && moved {
			t.Fatalf("chunk %d.%d moved with a road in %d.%d", ref.A, ref.B, changed.A, changed.B)
		}
	}

	// A new tile moves the regions and the chunks whose edges it touches.
	next := m.home.Add(hex.Direction(0).Scale(baseDisc + 1))
	m.discover(t, next)
	b4 := m.build()
	if b4.Regions.Rev == b3.Regions.Rev || b4.Index.Tiles != b3.Index.Tiles+1 {
		t.Fatal("a new tile moved neither the regions nor the count")
	}
}

func TestBaseIsPure(t *testing.T) {
	m := newBaseWorld(t)
	before, err := m.g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	stored := len(m.g.World.Tiles)
	snap, err := json.Marshal(m.g)
	if err != nil {
		t.Fatal(err)
	}
	m.build()
	unknown := m.home.Add(hex.Direction(4).Scale(baseFar))
	mapview.CellAt(m.g, unknown, api.LevelTile)
	mapview.Cell(m.g, unknown, api.LevelTile)
	mapview.Cell(m.g, m.home, api.LevelTile)
	after, err := m.g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("building the base moved the digest: %s then %s", before, after)
	}
	if len(m.g.World.Tiles) != stored {
		t.Fatal("building the base stored a tile")
	}
	again, _ := json.Marshal(m.g)
	if string(again) != string(snap) {
		t.Fatal("building the base changed the game's state")
	}
}

func TestBaseEmpty(t *testing.T) {
	g, err := game.New(baseRules(t))
	if err != nil {
		t.Fatal(err)
	}
	b := mapview.Build(g, baseWorldID, baseTickSeconds, baseStyleRev)
	if b.Index.Tiles != 0 || len(b.Index.Chunks) != 0 || len(b.Regions.Rows) != 0 || len(b.Regions.Regions) != 0 || b.Index.Home != (api.Hex{}) {
		t.Fatalf("a world with nothing found: %+v %+v", b.Index, b.Regions)
	}
	body, _ := json.Marshal(b.Index)
	if !strings.Contains(string(body), `"chunks":[]`) {
		t.Fatalf("an empty index's chunks are not []: %s", body)
	}
}
