package mapview

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// Base is the shared map at one tick.
type Base struct {
	Tick    int64
	Index   api.MapIndex
	Regions api.MapRegions
	chunks  map[chunkLevel]api.MapChunk
}

type chunkLevel struct {
	at    gen.ChunkCoord
	level string
}

// chunkLevels are the levels a chunk payload is built at.
var chunkLevels = [...]string{api.LevelArea, api.LevelTile}

// Build makes the base from a held game: every discovered chunk at area and
// tile level, the regions and the index. style is the rev of the style.
func Build(g *game.Game, world string, tickSeconds int64, style string) *Base {
	r := newReader(g)
	var tiles []hex.Hex
	for _, st := range g.World.Tiles {
		if st.Discovered != nil {
			tiles = append(tiles, st.Hex)
		}
	}
	slices.SortFunc(tiles, byRQ)
	gn := g.World.Gen()
	byChunk := map[gen.ChunkCoord][]hex.Hex{}
	for _, h := range tiles {
		cc := gn.ChunkOf(h)
		byChunk[cc] = append(byChunk[cc], h)
	}
	b := &Base{Tick: g.Tick(), chunks: make(map[chunkLevel]api.MapChunk, len(byChunk)*len(chunkLevels))}
	b.Regions = r.regionsOf(world, tiles)
	b.Index = api.MapIndex{World: world, Tick: g.Tick(), TicksPerDay: sheets.TicksPerDay, TickSeconds: tickSeconds,
		ChunkRadius: gn.ChunkRadius(), Tiles: int64(len(tiles)), Style: style, Regions: b.Regions.Rev,
		Chunks: make([]api.MapChunkRef, 0, len(byChunk))}
	if len(g.Places) > 0 && r.discovered(g.Places[0].Hex) {
		home := g.Places[0].Hex
		b.Index.Home = api.Hex{Q: home.Q, R: home.R}
	}
	for cc, hs := range byChunk {
		centre := gn.ChunkCentre(cc)
		ref := api.MapChunkRef{A: cc.A, B: cc.B, Centre: api.Hex{Q: centre.Q, R: centre.R}, Tiles: int64(len(hs))}
		for _, level := range chunkLevels {
			c := r.chunk(world, cc, level, hs)
			b.chunks[chunkLevel{cc, level}] = c
			if level == api.LevelArea {
				ref.Area = c.Rev
			} else {
				ref.Tile = c.Rev
			}
		}
		b.Index.Chunks = append(b.Index.Chunks, ref)
	}
	slices.SortFunc(b.Index.Chunks, func(x, y api.MapChunkRef) int { return cmp.Or(cmp.Compare(x.A, y.A), cmp.Compare(x.B, y.B)) })
	return b
}

// Chunk is one chunk's payload; false for a chunk with no discovered tile.
func (b *Base) Chunk(a, bb int64, level string) (api.MapChunk, bool) {
	c, ok := b.chunks[chunkLevel{gen.ChunkCoord{A: a, B: bb}, level}]
	return c, ok
}

func byRQ(x, y hex.Hex) int { return cmp.Or(cmp.Compare(x.R, y.R), cmp.Compare(x.Q, y.Q)) }

// chunk is one chunk's payload from its discovered tiles, sorted by (r, q),
// with the written names of the refs its cells carry.
func (r *reader) chunk(world string, cc gen.ChunkCoord, level string, tiles []hex.Hex) api.MapChunk {
	out := api.MapChunk{World: world, A: cc.A, B: cc.B, Level: level, Cells: make([]api.MapCell, len(tiles))}
	names := map[string]string{}
	for i, h := range tiles {
		c := r.cell(h, level)
		out.Cells[i] = c
		r.nameRefs(c, names)
	}
	if len(names) > 0 {
		out.Names = names
	}
	out.Rev = Rev(out)
	return out
}

// nameRefs adds the written names of a cell's region, place and guild,
// with server "" as the public reads show them.
func (r *reader) nameRefs(c api.MapCell, names map[string]string) {
	g := r.g
	if c.Region != "" {
		if _, ok := names[c.Region]; !ok {
			if i := g.World.RegionAt(hex.Hex{Q: c.Q, R: c.R}); i >= 0 {
				names[c.Region] = r.regionName(i)
			}
		}
	}
	if c.PlaceRef != "" {
		if _, ok := names[c.PlaceRef]; !ok {
			names[c.PlaceRef] = g.PlaceName(g.Places[r.places[hex.Hex{Q: c.Q, R: c.R}].n].Hex)
		}
	}
	if c.Guild != "" {
		if _, ok := names[c.Guild]; !ok {
			if gd := g.GuildOf(r.places[hex.Hex{Q: c.Q, R: c.R}].guild); gd != nil && gd.G.Name != "" {
				names[c.Guild] = gd.G.Name
			}
		}
	}
}
