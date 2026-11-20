package gen

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// What stands on a tile besides a pattern's part.
const (
	PlaceSettlement = "starting-settlement"
	PlaceDungeon    = "dungeon"
	PlaceLandmark   = "landmark"
	SiteOrdinary    = "site"
)

// TileBaseline is one tile as generation leaves it. Never stored.
type TileBaseline struct {
	Hex       Hex
	Elevation int64
	Moisture  int64
	Ore       int64
	Fertility int64
	Terrain   string
	Variant   string // a biome variant (map.biome-variants), or ""
	// An ecotone tile fades into a second biome: Secondary is that biome's
	// terrain, Blend how much of it shows (0 to 50), and Edge the
	// map.ecotones row for the pair, if the sheet has one.
	Secondary string
	Blend     int64
	Edge      string
	River     bool
	Water     string // none, stream, river, ford, coast, bog, lake or sea
	Cover     int64  // 0 to 100
	Region    LatticeID
	HomeDist  int64  // to the nearest starting-settlement lattice point, open or not
	Site      string // a settlement, a pattern's part, a site or a dungeon
	Yielded   bool   // made passable so the spine or a place can be reached
	Ford      bool   // yielded as shallows a corridor wades, not as land
	Landmark  string // a map.landmarks row, a pattern's landmark rule, or ""
}

// Fields are the tile's generated fields by name, as a goal's Discover
// and a Surveyor read them.
func (b TileBaseline) Fields() map[string]int64 {
	return map[string]int64{"ore": b.Ore, "fertility": b.Fertility, "cover": b.Cover, "moisture": b.Moisture, "elevation": b.Elevation}
}

// What water a tile holds (GDD 4.10).
const (
	WaterNone   = "none"
	WaterStream = "stream"
	WaterRiver  = "river"
	WaterFord   = "ford"
	WaterCoast  = "coast"
	WaterBog    = "bog"
	WaterLake   = "lake"
	WaterSea    = "sea"
)

// PatternPoint is one point of a pattern instance with something on it.
type PatternPoint struct {
	Rule     string
	Instance string // stable across chunks: the rule's anchor
	Place    string
	Hex      Hex
	Index    int // which point of the instance, in part order
	Centre   Hex
	Area     string
}

// Settlement is a starting settlement: its place in the opening order
// (0 is nearest the origin), its lattice point and its tile.
type Settlement struct {
	N   int
	ID  LatticeID
	Hex Hex
}

// ChunkBaseline is every tile of one chunk, in ring order from its centre,
// with the pattern points and starting settlements on them.
type ChunkBaseline struct {
	Coord       ChunkCoord
	Centre      Hex
	Tiles       []TileBaseline
	Points      []PatternPoint
	Settlements []Settlement
}

// Tile returns the chunk's tile at h, which must lie in the chunk.
func (c *ChunkBaseline) Tile(h Hex) TileBaseline {
	for _, t := range c.Tiles {
		if t.Hex == h {
			return t
		}
	}
	panic("gen: tile outside its chunk")
}

type params struct {
	chunk                                    int64
	regionSpacing, regionJitter, regionMatch int64
	regionCore, regionFloor, regionCeiling   int64
	spineSpacing, spineJitter                int64
	slack, wall, detour, causeway            int64
	islandReach, islandLink                  int64
	landHop, landMax                         int64
	riverMax, riverSource, riverShare        int64
	along, across                            int64
	homeSpacing, homeJitter, homeClear       int64
	tierStep, tierCeiling                    int64
	sitesMin, sitesMax, dungeonShare         int64
	farMin, farCell, farLo, farHi, farAxes   int64
	variantShare                             int64
	warp, fadeMin, fadeMax                   int64
	continent, seaLevel                      int64
	edgeTiles, edgeCreatures                 int64
	coverSpread, oreMid, oreLift             int64
	fertMid, fertLift, stream                int64
	matMin, matMax, matBiome, matOther       int64
	landmarkShare                            int64
}

// Gen answers for one world. Its caches only remember pure answers, so the
// same tile comes out the same whatever was asked first. The caches are
// never evicted, so a long-lived Gen grows with every area asked about;
// dropping it for a fresh one loses nothing but speed. A Gen is not safe
// for concurrent use.
type Gen struct {
	b       *sheets.Book
	d       *draw.Drawer
	p       params
	ch      chunker
	noise   noiseLayers
	terrain map[string]*sheets.Terrain
	shapes  map[string]*sheets.Shape
	rules   map[string]int

	regions, spine, homes *lattice

	discIndex     map[Hex]int
	raws          tileCache[raw]
	search        corridorSearch
	lattices      noiseCache
	purposes      []string
	paths         map[pathKey][]Hex
	rivers        map[ChunkCoord][]Hex
	ground        map[ChunkCoord]*ground
	chunks        map[ChunkCoord]*ChunkBaseline
	points        map[ChunkCoord][]PatternPoint
	instances     map[string]*instance
	regionOf      tileCache[LatticeID]
	regionInfo    map[LatticeID]*RegionBaseline
	centreTerrain map[LatticeID]string
	weights       map[LatticeID]int64
	isles         map[LatticeID]*island
	links         map[LatticeID][]Hex
	shore         map[Hex]Hex
	landings      map[Hex]map[Hex]Hex // per place afloat, its group's landings; nil when too big
	picks         [regionPasses + 1]tileCache[LatticeID]
	sizes         map[sizeKey]int64
	regionSites   map[LatticeID]map[Hex]string
	marks         map[LatticeID]landmark
	tilesOf       map[LatticeID][]Hex
	nextTo        map[LatticeID][]LatticeID
	far           map[string]*FarMaterial
	homeValid     map[LatticeID]bool
	homeOrder     []LatticeID
	homeRank      map[LatticeID]int
	originAreas   []originArea
}

// New makes a generator for the world with this generation key.
func New(b *sheets.Book, key draw.Key) (*Gen, error) {
	g := &Gen{
		b: b, d: draw.NewDrawer(key),
		terrain: sheets.Lookup(b.Terrain), shapes: sheets.Lookup(b.Shapes), rules: map[string]int{},
		discIndex: map[Hex]int{}, raws: newTileCache[raw](), lattices: noiseCache{blocks: map[noiseKey]*[blockArea]int64{}},
		paths: map[pathKey][]Hex{}, rivers: map[ChunkCoord][]Hex{}, ground: map[ChunkCoord]*ground{},
		chunks: map[ChunkCoord]*ChunkBaseline{}, points: map[ChunkCoord][]PatternPoint{},
		instances: map[string]*instance{}, regionOf: newTileCache[LatticeID](),
		regionInfo: map[LatticeID]*RegionBaseline{}, centreTerrain: map[LatticeID]string{}, weights: map[LatticeID]int64{}, isles: map[LatticeID]*island{}, links: map[LatticeID][]Hex{}, sizes: map[sizeKey]int64{}, regionSites: map[LatticeID]map[Hex]string{}, marks: map[LatticeID]landmark{}, tilesOf: map[LatticeID][]Hex{}, nextTo: map[LatticeID][]LatticeID{},
		shore: map[Hex]Hex{}, landings: map[Hex]map[Hex]Hex{},
		far: map[string]*FarMaterial{}, homeValid: map[LatticeID]bool{}, homeRank: map[LatticeID]int{},
	}
	for k := range g.picks {
		g.picks[k] = newTileCache[LatticeID]()
	}
	g.purposes = append([]string(nil), fieldPurposes[:]...)
	for _, v := range b.BiomeVariants {
		g.purposes = append(g.purposes, "variant."+v.ID)
	}
	pi := func(id string) int64 { return sheets.IntParam(b.MapParams, id) }
	g.p = params{
		chunk:         pi("chunk-radius"),
		regionSpacing: pi("region-spacing"), regionJitter: pi("region-jitter"), regionMatch: pi("region-match-tiles"), regionCore: pi("region-core-tiles"), regionFloor: pi("region-floor-tiles"), regionCeiling: pi("region-ceiling-tiles"),
		spineSpacing: pi("spine-spacing"), spineJitter: pi("spine-jitter"),
		slack: pi("corridor-slack"), wall: pi("corridor-wall-ticks"),
		detour: pi("corridor-detour"), causeway: pi("causeway-every"),
		islandReach: pi("island-reach-cells"), islandLink: pi("island-link-cells"),
		landHop: pi("landing-hop"), landMax: pi("landing-group-max"),
		riverMax: pi("river-max-tiles"), riverSource: pi("river-source-elevation"), riverShare: pi("river-chunk-share"),
		along: pi("river-along-ticks"), across: pi("river-across-ticks"),
		homeSpacing: pi("settlement-spacing"), homeJitter: pi("settlement-jitter"), homeClear: pi("settlement-clearance"),
		tierStep: pi("tier-step-tiles"), tierCeiling: pi("tier-ceiling"),
		sitesMin: pi("sites-min"), sitesMax: pi("sites-max"), dungeonShare: pi("dungeon-region-share"),
		farMin: pi("far-material-min-tiles"), farCell: pi("far-material-cell-tiles"),
		farLo: pi("far-budget-min"), farHi: pi("far-budget-max"), farAxes: pi("far-material-axes"),
		variantShare: pi("creature-variant-share"),
		warp:         pi("biome-warp-tiles"), fadeMin: pi("fade-min"), fadeMax: pi("fade-max"), continent: pi("continent-lift"), seaLevel: pi("sea-level"),
		edgeTiles: pi("edge-region-tiles"), edgeCreatures: pi("edge-creature-share"),
		coverSpread: pi("cover-spread"), oreMid: pi("ore-elevation-mid"), oreLift: pi("ore-elevation-lift"),
		fertMid: pi("fertility-moisture-mid"), fertLift: pi("fertility-moisture-lift"), stream: pi("river-stream-tiles"),
		matMin: pi("region-materials-min"), matMax: pi("region-materials-max"),
		matBiome: pi("material-biome-weight"), matOther: pi("material-other-weight"),
		landmarkShare: pi("landmark-region-share"),
	}
	if g.p.homeJitter*halves >= g.p.homeSpacing {
		return nil, fmt.Errorf("gen: settlement-jitter must stay under half the spacing, so nearest-first order is exact")
	}
	if g.p.spineJitter*discSides > g.p.spineSpacing {
		return nil, fmt.Errorf("gen: spine-jitter must stay under a third of the spacing, so every tile has a spine node within the spacing")
	}
	var err error
	if g.noise, err = g.layers(); err != nil {
		return nil, err
	}
	g.ch = chunker{g.p.chunk}
	for i, h := range hex.Disc(g.p.chunk) {
		g.discIndex[h] = i
	}
	g.regions = g.newLattice("region", g.p.regionSpacing, g.p.regionJitter, true)
	g.spine = g.newLattice("spine", g.p.spineSpacing, g.p.spineJitter, true)
	g.spine.prefer = func(h Hex) bool { return g.passable(g.raw(h).terrain) }
	g.homes = g.newLattice("home", g.p.homeSpacing, g.p.homeJitter, false)
	g.homes.prefer = func(h Hex) bool { return g.passable(g.raw(h).terrain) }
	if err := g.checkPatterns(); err != nil {
		return nil, err
	}
	g.originAreas = g.areasAtOrigin()
	return g, nil
}

// Baseline is one tile from a fresh Gen, so no cache state can colour it.
func Baseline(b *sheets.Book, key draw.Key, h Hex) (TileBaseline, error) {
	g, err := New(b, key)
	if err != nil {
		return TileBaseline{}, err
	}
	return g.Baseline(h), nil
}

// Chunk is (*Gen).Chunk on a fresh Gen.
func Chunk(b *sheets.Book, key draw.Key, cc ChunkCoord) (*ChunkBaseline, error) {
	g, err := New(b, key)
	if err != nil {
		return nil, err
	}
	return g.Chunk(cc), nil
}

// Patterns is (*Gen).Patterns on a fresh Gen.
func Patterns(b *sheets.Book, key draw.Key, cc ChunkCoord) ([]PatternPoint, error) {
	g, err := New(b, key)
	if err != nil {
		return nil, err
	}
	return g.Patterns(cc), nil
}

func (g *Gen) ChunkOf(h Hex) ChunkCoord      { return g.ch.Of(h) }
func (g *Gen) ChunkCentre(cc ChunkCoord) Hex { return g.ch.Centre(cc) }
func (g *Gen) ChunkRadius() int64            { return g.p.chunk }

// Baseline is one tile: its chunk's answer for it.
func (g *Gen) Baseline(h Hex) TileBaseline {
	c := g.Chunk(g.ch.Of(h))
	return c.Tiles[g.discIndex[Hex{Q: h.Q - c.Centre.Q, R: h.R - c.Centre.R}]]
}

// Chunk is every tile of one chunk.
func (g *Gen) Chunk(cc ChunkCoord) *ChunkBaseline {
	if c, ok := g.chunks[cc]; ok {
		return c
	}
	gr := g.groundOf(cc)
	c := &ChunkBaseline{Coord: cc, Centre: gr.centre, Points: gr.points, Settlements: gr.homes}
	c.Tiles = make([]TileBaseline, len(gr.tiles))
	for i, t := range gr.tiles {
		h := gr.centre.Add(gr.offsets[i])
		r := g.raw(h)
		reg := g.region(h)
		site, mark := t.place, t.landmark
		if site == "" {
			site = g.sitesOf(reg)[h]
		}
		if mark == "" && g.landmarkOf(reg).at == h {
			mark = g.landmarkOf(reg).id
		}
		c.Tiles[i] = TileBaseline{
			Hex: h, Elevation: r.elevation, Moisture: r.moisture, Ore: r.ore, Fertility: r.fertility,
			Terrain: t.terrain, Variant: g.variant(h, t.terrain), River: t.river,
			Secondary: g.secondTerrain(r), Blend: r.blend, Edge: g.edgeOf(r), Ford: t.ford,
			Region: reg, HomeDist: g.nearestHome(h), Site: site, Yielded: t.yielded,
			Water: g.water(r, t), Cover: g.cover(h, t.terrain), Landmark: mark,
		}
	}
	g.chunks[cc] = c
	return c
}

// ---- the ground: terrain after yielding, rivers and places ----

type groundTile struct {
	terrain  string
	yielded  bool
	river    bool
	stream   bool // a river this near its source
	place    string
	landmark string // a pattern's landmark rule
	ford     bool   // a corridor over water: shallows, not land
}

// water is what water a tile holds, from its ground and raw terrain.
func (g *Gen) water(r raw, t groundTile) string {
	switch {
	case t.ford:
		return WaterFord
	case t.river && t.stream:
		return WaterStream
	case t.river:
		return WaterRiver
	case !g.passable(t.terrain) && r.sunk && g.terrain[t.terrain].Wet():
		return WaterSea
	case !g.passable(t.terrain) && g.terrain[t.terrain].Wet():
		return WaterLake
	case t.terrain == r.terrain && g.terrain[t.terrain].Wet() && g.terrain[t.terrain].EnterTicks <= 1:
		return WaterCoast
	case g.terrain[t.terrain].Wet():
		return WaterBog
	}
	return WaterNone
}

type ground struct {
	centre  Hex
	offsets []Hex
	tiles   []groundTile
	points  []PatternPoint
	homes   []Settlement
}

func (g *Gen) groundOf(cc ChunkCoord) *ground {
	if gr, ok := g.ground[cc]; ok {
		return gr
	}
	centre := g.ch.Centre(cc)
	gr := &ground{centre: centre, offsets: hex.Disc(g.p.chunk)}
	gr.tiles = make([]groundTile, len(gr.offsets))
	in := func(h Hex) (int, bool) {
		i, ok := g.discIndex[Hex{Q: h.Q - centre.Q, R: h.R - centre.R}]
		return i, ok
	}
	// Places: starting settlements, then pattern points.
	for _, s := range g.homesNear(centre, g.p.chunk) {
		if i, ok := in(s.Hex); ok {
			gr.tiles[i].place = PlaceSettlement
			gr.homes = append(gr.homes, s)
		}
	}
	gr.points = g.Patterns(cc)
	for _, p := range gr.points {
		i, _ := in(p.Hex)
		gr.tiles[i].place = p.Place
		if p.Place == PlaceLandmark {
			gr.tiles[i].landmark = p.Rule
		}
	}
	// Corridors: spine edges near the chunk, island links, and each place's
	// way to its landing.
	corridor := make([]bool, len(gr.tiles))
	island := make([]bool, len(gr.tiles))
	mark := func(path []Hex) {
		for _, h := range path {
			if i, ok := in(h); ok {
				corridor[i] = true
			}
		}
		for _, h := range g.islands(path) {
			if i, ok := in(h); ok {
				island[i] = true
			}
		}
	}
	// A corridor tile lies within half its limit plus half its length of
	// either end, and an island one tile beyond.
	edge := g.p.spineSpacing + halves*g.p.spineJitter
	edgeReach := (g.limit(edge)+edge)/halves + 1 + g.p.chunk
	for _, id := range g.spine.Near(centre, edgeReach) {
		for k := range len(latticeSteps) / halves {
			to := g.step(id, k)
			if g.spineSkips(id, to) || g.spineSpared(id, k) {
				continue
			}
			mark(g.path(g.spine.At(id), g.spine.At(to)))
		}
	}
	// A place links to a spine node at most three spacings off.
	far := discSides * g.p.spineSpacing
	placeReach := (g.limit(far)+far)/halves + 1 + g.p.chunk
	// An island link starts at one of its nodes and runs at most the link
	// reach plus a node's jitter.
	var linked []LatticeID
	link := g.p.islandLink*g.p.spineSpacing + g.p.spineJitter
	for _, id := range g.spine.Near(centre, (g.limit(link)+link)/halves+1+g.p.chunk) {
		if in, ok := g.islandOf(id); ok && !slices.Contains(linked, in.root) {
			linked = append(linked, in.root)
			mark(g.islandLinkOf(in))
		}
	}
	for _, l := range g.placesNear(centre, placeReach) {
		mark(g.path(l.from, l.to))
	}
	// Rivers from every source close enough to reach the chunk.
	river := make([]bool, len(gr.tiles))
	stream := make([]bool, len(gr.tiles))
	for i := range stream {
		stream[i] = true
	}
	for _, src := range g.ch.Near(centre, g.p.riverMax+g.p.chunk) {
		for k, h := range g.river(src) {
			if i, ok := in(h); ok {
				river[i] = true
				stream[i] = stream[i] && int64(k) < g.p.stream
			}
		}
	}
	for i, off := range gr.offsets {
		r := g.raw(centre.Add(off))
		t := &gr.tiles[i]
		t.terrain = r.terrain
		if !g.passable(r.terrain) && (corridor[i] || island[i] || t.place != "") {
			t.terrain, t.yielded = g.passableNear(r.elevation), true
			t.ford = corridor[i] && !island[i] && t.place == "" && g.wet(centre.Add(off))
		}
		t.river = river[i] && g.passable(t.terrain)
		t.stream = t.river && stream[i]
	}
	g.ground[cc] = gr
	return gr
}

// groundAt is a tile's terrain after yielding, and what stands on it.
func (g *Gen) groundAt(h Hex) groundTile {
	gr := g.groundOf(g.ch.Of(h))
	return gr.tiles[g.discIndex[Hex{Q: h.Q - gr.centre.Q, R: h.R - gr.centre.R}]]
}

// spineSkips leaves out a spine edge with an end in water; islands and
// places afloat get their own links (islandLink, landing).
func (g *Gen) spineSkips(a, b LatticeID) bool {
	return g.wet(g.spine.At(a)) || g.wet(g.spine.At(b))
}

// spineSpared: a spine edge that crosses water is left out when one of
// its two triangles joins its ends anyway, by an edge over land and an
// edge whose crossing is shorter (or as short, with the lower id). Edges
// are only ever spared for better ones, so the ends stay joined, and a
// strait the spine meets along its length is crossed once, not by every
// edge.
func (g *Gen) spineSpared(a LatticeID, k int) bool {
	b := g.step(a, k)
	wet := g.crossing(a, b)
	if wet == 0 {
		return false
	}
	n := len(latticeSteps)
	for _, side := range [...]int{(k + 1) % n, (k + n - 1) % n} {
		c := g.step(a, side)
		if !g.dry(c) {
			continue
		}
		ac, cb := g.crossing(a, c), g.crossing(c, b)
		if ac > 0 && cb > 0 {
			continue
		}
		other, rest := edge{c, b}, cb
		if ac > 0 {
			other, rest = edge{a, c}, ac
		}
		if rest < wet || (rest == wet && compareEdge(other, edge{a, b}) < 0) {
			return true
		}
	}
	return false
}

// crossing counts the tiles of water on a spine edge's corridor.
func (g *Gen) crossing(a, b LatticeID) int64 {
	var n int64
	for _, h := range g.path(g.spine.At(a), g.spine.At(b)) {
		if g.wet(h) {
			n++
		}
	}
	return n
}

// edge is a spine edge between two lattice points, either way round.
type edge struct{ a, b LatticeID }

func (e edge) sorted() edge {
	if CompareIDs(e.b, e.a) < 0 {
		return edge{e.b, e.a}
	}
	return e
}

func compareEdge(e, f edge) int {
	e, f = e.sorted(), f.sorted()
	if c := CompareIDs(e.a, f.a); c != 0 {
		return c
	}
	return CompareIDs(e.b, f.b)
}

func (g *Gen) dry(id LatticeID) bool { return !g.wet(g.spine.At(id)) }

func (g *Gen) step(id LatticeID, k int) LatticeID {
	return LatticeID{id.I + latticeSteps[k].I, id.J + latticeSteps[k].J}
}

// island is a dry component of the spine lattice (dry nodes joined
// through dry neighbours) of at most as many nodes as a disc of
// island-reach-cells holds: land the spine cannot reach over land. Its
// root is its lowest node. A bigger component is mainland. The answer is
// the component's own, so every node of it gets the same one.
type island struct {
	root  LatticeID
	nodes []LatticeID
}

func (g *Gen) islandOf(id LatticeID) (*island, bool) {
	if in, ok := g.isles[id]; ok {
		return in, in != nil
	}
	if !g.dry(id) {
		g.isles[id] = nil
		return nil, false
	}
	limit := int(hex.DiscSize(g.p.islandReach))
	nodes := []LatticeID{id}
	seen := map[LatticeID]bool{id: true}
	for k := 0; k < len(nodes) && len(nodes) <= limit; k++ {
		for d := range latticeSteps {
			if n := g.step(nodes[k], d); g.dry(n) && !seen[n] {
				seen[n] = true
				nodes = append(nodes, n)
			}
		}
	}
	// Every node reached is in the same component, so all share the answer.
	var in *island
	if len(nodes) <= limit {
		in = &island{root: nodes[0], nodes: nodes}
		for _, n := range nodes {
			if n.I < in.root.I || (n.I == in.root.I && n.J < in.root.J) {
				in.root = n
			}
		}
	}
	for _, n := range nodes {
		g.isles[n] = in
	}
	return in, in != nil
}

// islandLink is the corridor that joins an island to the land beyond it:
// between the closest pair of an island node and a mainland node within
// island-link-cells of it, or failing a mainland node, of a node of
// another island; it crosses at the narrowest place it can.
func (g *Gen) islandLink(in *island) []Hex {
	reach := g.p.islandLink * g.p.spineSpacing
	var from, to Hex
	bestD, bestMain, found := int64(0), false, false
	for _, a := range in.nodes {
		ha := g.spine.At(a)
		for _, b := range g.spine.Near(ha, reach) {
			if !g.dry(b) || slices.Contains(in.nodes, b) {
				continue
			}
			_, isl := g.islandOf(b)
			hb := g.spine.At(b)
			d := hex.Distance(ha, hb)
			if !found || (!isl && !bestMain) || (!isl == bestMain && d < bestD) {
				from, to, bestD, bestMain, found = ha, hb, d, !isl, true
			}
		}
	}
	if !found {
		return nil
	}
	return g.path(from, to)
}

func (g *Gen) islandLinkOf(in *island) []Hex {
	if p, ok := g.links[in.root]; ok {
		return p
	}
	p := g.islandLink(in)
	g.links[in.root] = p
	return p
}

// spineNode is the nearest dry spine node to h within three spacings,
// or failing that the nearest node.
func (g *Gen) spineNode(h Hex) Hex {
	if n, ok := g.shore[h]; ok {
		return n
	}
	best, bestD, found := Hex{}, int64(0), false
	for _, id := range g.spine.Near(h, discSides*g.p.spineSpacing) {
		if n := g.spine.At(id); g.dry(id) && (!found || hex.Distance(n, h) < bestD) {
			best, bestD, found = n, hex.Distance(n, h), true
		}
	}
	if !found {
		best = g.spine.At(g.spine.Nearest(h))
	}
	g.shore[h] = best
	return best
}

// placesNear lists the corridors of the settlements and pattern points
// within reach: each runs from the place to where landing joins it.
func (g *Gen) placesNear(h Hex, reach int64) []pathKey {
	var out []pathKey
	for _, p := range g.placeTiles(h, reach) {
		out = append(out, pathKey{p, g.landing(p)})
	}
	return out
}

// placeTiles lists the tiles of settlements and pattern points within
// reach, once each.
func (g *Gen) placeTiles(h Hex, reach int64) []Hex {
	var out []Hex
	for _, s := range g.homesNear(h, reach) {
		out = append(out, s.Hex)
	}
	for _, cc := range g.ch.Near(h, reach) {
		for _, p := range g.Patterns(cc) {
			if hex.Distance(p.Hex, h) <= reach {
				out = append(out, p.Hex)
			}
		}
	}
	return out
}

// landing is where a place's corridor ends. A place on land runs to its
// spine node. Places afloat, in water or cut off from their node by it, within
// landing-hop of each other form a group; its places join one at a time,
// nearest first, each to the nearest of its own spine node, a place on
// land beside the group, or a place already joined. So the group reaches
// the shore by one crossing between them, not one each.
func (g *Gen) landing(h Hex) Hex {
	if !g.afloat(h) {
		return g.spineNode(h)
	}
	links, ok := g.landings[h]
	if !ok {
		links = g.landGroup(h)
	}
	if to, ok := links[h]; ok {
		return to
	}
	return g.spineNode(h)
}

// afloat: a place in water, or one whose own way to its spine node
// would cross water.
func (g *Gen) afloat(h Hex) bool {
	if g.wet(h) {
		return true
	}
	return slices.ContainsFunc(g.path(h, g.spineNode(h)), g.wet)
}

// landGroup finds h's group and links it. A group over landing-group-max
// is found too big from whichever of its places the search starts, so
// every place gets the same answer.
func (g *Gen) landGroup(h Hex) map[Hex]Hex {
	group, beside := []Hex{h}, []Hex(nil)
	for k := 0; k < len(group) && int64(len(group)) <= g.p.landMax; k++ {
		for _, p := range g.placeTiles(group[k], g.p.landHop) {
			switch {
			case slices.Contains(group, p) || slices.Contains(beside, p):
			case g.afloat(p):
				group = append(group, p)
			default:
				beside = append(beside, p)
			}
		}
	}
	var links map[Hex]Hex
	if int64(len(group)) <= g.p.landMax {
		links = g.linkGroup(group, beside)
	}
	for _, p := range group {
		g.landings[p] = links
	}
	return links
}

func (g *Gen) linkGroup(group, joined []Hex) map[Hex]Hex {
	links := make(map[Hex]Hex, len(group))
	nearer := func(h, to, j Hex, d int64) (Hex, int64) {
		if dj := hex.Distance(h, j); dj < d || (dj == d && j.Less(to)) {
			return j, dj
		}
		return to, d
	}
	for len(group) > 0 {
		best, bestTo, bestD := 0, Hex{}, int64(-1)
		for k, h := range group {
			to := g.spineNode(h)
			d := hex.Distance(h, to)
			for _, j := range joined {
				to, d = nearer(h, to, j, d)
			}
			if bestD < 0 || d < bestD || (d == bestD && h.Less(group[best])) {
				best, bestTo, bestD = k, to, d
			}
		}
		links[group[best]] = bestTo
		joined = append(joined, group[best])
		group = slices.Delete(group, best, best+1)
	}
	return links
}

// ---- corridors ----

type pathKey struct{ from, to Hex }

// limit is how long a corridor between ends this far apart may wander:
// corridor-detour percent of the straight walk, plus the slack.
func (g *Gen) limit(d int64) int64 { return fixed.PercentFloor(d, g.p.detour) + g.p.slack }

// islands are the stops along a corridor's long crossings: every
// causeway-every tiles of a run over water, the tile and its neighbours
// rise as an island, so a long crossing reads as a chain of islands and
// short fords, not a ribbon.
func (g *Gen) islands(path []Hex) []Hex {
	var out []Hex
	run := int64(0)
	for _, h := range path {
		if !g.wet(h) {
			run = 0
			continue
		}
		run++
		if run%g.p.causeway == 0 {
			out = append(out, hex.DiscAt(h, 1)...)
		}
	}
	return out
}

// path is the cheapest walk from a to b inside the ellipse of tiles whose
// two distances to the ends add up to at most the limit. A tile that must
// yield costs the wall, more than any route over land inside the ellipse,
// so a corridor never crosses water or peaks when a way round fits, and
// otherwise crosses with the fewest yielded tiles: at the narrowest place.
// It reads only raw terrain.
func (g *Gen) path(a, b Hex) []Hex {
	key := pathKey{a, b}
	if b.Less(a) {
		key = pathKey{b, a}
	}
	if p, ok := g.paths[key]; ok {
		return p
	}
	out := g.search.run(g, key.from, key.to, g.limit(hex.Distance(key.from, key.to)))
	g.paths[key] = out
	return out
}

// ---- rivers ----

// river runs from a chunk's highest tile, if it is high enough and the
// seed says so, downhill for at most river-max-tiles, ending at deep water.
// Rivers never read each other, so each is known from its own chunk.
func (g *Gen) river(cc ChunkCoord) []Hex {
	if r, ok := g.rivers[cc]; ok {
		return r
	}
	centre := g.ch.Centre(cc)
	top := centre
	for _, off := range hex.Disc(g.p.chunk) {
		h := centre.Add(off)
		if e, te := g.raw(h).elevation, g.raw(top).elevation; e > te || (e == te && h.Less(top)) {
			top = h
		}
	}
	var out []Hex
	if g.raw(top).elevation >= g.p.riverSource &&
		g.d.Percent(g.p.riverShare, "river.source", draw.Int(cc.A), draw.Int(cc.B)) {
		visited := []Hex{top}
		cur := top
		for range g.p.riverMax {
			next, found := Hex{}, false
			for d := range nDirs {
				n := cur.Neighbour(d)
				if slices.Contains(visited, n) {
					continue
				}
				if !found || g.raw(n).elevation < g.raw(next).elevation {
					next, found = n, true
				}
			}
			if !found || g.wet(next) {
				break
			}
			visited = append(visited, next)
			out = append(out, next)
			cur = next
		}
	}
	g.rivers[cc] = out
	return out
}

// wet is open water a river ends in: impassable and wet.
func (g *Gen) wet(h Hex) bool {
	t := g.terrain[g.raw(h).terrain]
	return !t.Passable && t.Wet()
}
