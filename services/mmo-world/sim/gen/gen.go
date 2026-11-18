package gen

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/sheets"
)

// What stands on a tile besides a pattern's part.
const (
	PlaceSettlement = "starting-settlement"
	PlaceDungeon    = "dungeon"
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
	Region    LatticeID
	HomeDist  int64  // to the nearest starting-settlement lattice point, open or not
	Site      string // a settlement, a pattern's part, a site or a dungeon
	Yielded   bool   // made passable so the spine or a place can be reached
	Ford      bool   // yielded as shallows a corridor wades, not as land
}

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
}

// Gen answers for one world. Its caches only remember pure answers, so the
// same tile comes out the same whatever was asked first. A Gen is not safe
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
	raws          map[Hex]raw
	lattices      map[latticeKey]int64
	paths         map[pathKey][]Hex
	rivers        map[ChunkCoord][]Hex
	ground        map[ChunkCoord]*ground
	chunks        map[ChunkCoord]*ChunkBaseline
	points        map[ChunkCoord][]PatternPoint
	instances     map[string]*instance
	regionOf      map[Hex]LatticeID
	regionInfo    map[LatticeID]*RegionBaseline
	centreTerrain map[LatticeID]string
	weights       map[LatticeID]int64
	isles         map[LatticeID]*island
	links         map[LatticeID][]Hex
	picks         map[pickKey]LatticeID
	sizes         map[sizeKey]int64
	regionSites   map[LatticeID]map[Hex]string
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
		discIndex: map[Hex]int{}, raws: map[Hex]raw{}, lattices: map[latticeKey]int64{},
		paths: map[pathKey][]Hex{}, rivers: map[ChunkCoord][]Hex{}, ground: map[ChunkCoord]*ground{},
		chunks: map[ChunkCoord]*ChunkBaseline{}, points: map[ChunkCoord][]PatternPoint{},
		instances: map[string]*instance{}, regionOf: map[Hex]LatticeID{},
		regionInfo: map[LatticeID]*RegionBaseline{}, centreTerrain: map[LatticeID]string{}, weights: map[LatticeID]int64{}, isles: map[LatticeID]*island{}, links: map[LatticeID][]Hex{}, picks: map[pickKey]LatticeID{}, sizes: map[sizeKey]int64{}, regionSites: map[LatticeID]map[Hex]string{},
		far: map[string]*FarMaterial{}, homeValid: map[LatticeID]bool{}, homeRank: map[LatticeID]int{},
	}
	pi := func(id string) int64 { return sheets.IntParam(b.MapParams, id) }
	g.p = params{
		chunk:         pi("chunk-radius"),
		regionSpacing: pi("region-spacing"), regionJitter: pi("region-jitter"), regionMatch: pi("region-match-tiles"), regionCore: pi("region-core-tiles"), regionFloor: pi("region-floor-tiles"), regionCeiling: pi("region-ceiling-tiles"),
		spineSpacing: pi("spine-spacing"), spineJitter: pi("spine-jitter"),
		slack: pi("corridor-slack"), wall: pi("corridor-wall-ticks"),
		detour: pi("corridor-detour"), causeway: pi("causeway-every"),
		islandReach: pi("island-reach-cells"), islandLink: pi("island-link-cells"),
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
	for i, h := range Disc(g.p.chunk) {
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

// Baseline is the contract form: one tile from a fresh generator.
func Baseline(b *sheets.Book, key draw.Key, h Hex) (TileBaseline, error) {
	g, err := New(b, key)
	if err != nil {
		return TileBaseline{}, err
	}
	return g.Baseline(h), nil
}

// Chunk is the contract form of (*Gen).Chunk.
func Chunk(b *sheets.Book, key draw.Key, cc ChunkCoord) (*ChunkBaseline, error) {
	g, err := New(b, key)
	if err != nil {
		return nil, err
	}
	return g.Chunk(cc), nil
}

// Patterns is the contract form of (*Gen).Patterns.
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
	return c.Tiles[g.discIndex[Hex{h.Q - c.Centre.Q, h.R - c.Centre.R}]]
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
		site := t.place
		if site == "" {
			site = g.sitesOf(reg)[h]
		}
		c.Tiles[i] = TileBaseline{
			Hex: h, Elevation: r.elevation, Moisture: r.moisture, Ore: r.ore, Fertility: r.fertility,
			Terrain: t.terrain, Variant: g.variant(h, t.terrain), River: t.river,
			Secondary: g.secondTerrain(r), Blend: r.blend, Edge: g.edgeOf(r), Ford: t.ford,
			Region: reg, HomeDist: g.nearestHome(h), Site: site, Yielded: t.yielded,
		}
	}
	g.chunks[cc] = c
	return c
}

// ---- the ground: terrain after yielding, rivers and places ----

type groundTile struct {
	terrain string
	yielded bool
	river   bool
	place   string
	ford    bool // a corridor over water: shallows, not land
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
	gr := &ground{centre: centre, offsets: Disc(g.p.chunk)}
	gr.tiles = make([]groundTile, len(gr.offsets))
	in := func(h Hex) (int, bool) {
		i, ok := g.discIndex[Hex{h.Q - centre.Q, h.R - centre.R}]
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
	}
	// Corridors: the spine's edges near the chunk, and every place's way to
	// its nearest spine node.
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
		for _, step := range latticeSteps[:len(latticeSteps)/halves] {
			to := LatticeID{id.I + step.I, id.J + step.J}
			if g.spineSkips(id, to) {
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
	for _, h := range g.placesNear(centre, placeReach) {
		mark(g.path(h, g.spineNode(h)))
	}
	// Rivers from every source close enough to reach the chunk.
	river := make([]bool, len(gr.tiles))
	for _, src := range g.ch.Near(centre, g.p.riverMax+g.p.chunk) {
		for _, h := range g.river(src) {
			if i, ok := in(h); ok {
				river[i] = true
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
	}
	g.ground[cc] = gr
	return gr
}

// groundAt is a tile's terrain after yielding, and what stands on it.
func (g *Gen) groundAt(h Hex) groundTile {
	gr := g.groundOf(g.ch.Of(h))
	return gr.tiles[g.discIndex[Hex{h.Q - gr.centre.Q, h.R - gr.centre.R}]]
}

// spineSkips: the spine runs over land. An edge with an end in water is
// left out; a corridor between two dry nodes still crosses a strait at
// its narrowest when no way round fits. Islands get their own link
// (islandLink), and places in water link to the nearest dry node, so
// seas are not crossed by a lattice of corridors.
func (g *Gen) spineSkips(a, b LatticeID) bool {
	return g.wet(g.spine.At(a)) || g.wet(g.spine.At(b))
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
	limit := int(DiscSize(g.p.islandReach))
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
			d := Distance(ha, hb)
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
	best, bestD, found := Hex{}, int64(0), false
	for _, id := range g.spine.Near(h, discSides*g.p.spineSpacing) {
		if n := g.spine.At(id); g.dry(id) && (!found || Distance(n, h) < bestD) {
			best, bestD, found = n, Distance(n, h), true
		}
	}
	if !found {
		return g.spine.At(g.spine.Nearest(h))
	}
	return best
}

// placesNear lists the tiles of settlements and pattern points within reach.
func (g *Gen) placesNear(h Hex, reach int64) []Hex {
	var out []Hex
	for _, s := range g.homesNear(h, reach) {
		out = append(out, s.Hex)
	}
	for _, cc := range g.ch.Near(h, reach) {
		for _, p := range g.Patterns(cc) {
			if Distance(p.Hex, h) <= reach {
				out = append(out, p.Hex)
			}
		}
	}
	return out
}

// ---- corridors ----

type pathKey struct{ from, to Hex }

// limit is how long a corridor between ends this far apart may wander:
// corridor-detour percent of the straight walk, plus the slack.
func (g *Gen) limit(d int64) int64 { return d*g.p.detour/percent + g.p.slack }

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
			out = append(out, DiscAt(h, 1)...)
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
	from, to := key.from, key.to
	limit := g.limit(Distance(from, to))
	// A*: every step costs at least one tick, so the hex distance left is
	// a lower bound on the cost left.
	cost := map[Hex]int64{from: 0}
	prev := map[Hex]Hex{}
	pq := &queue{}
	pq.push(item{from, Distance(from, to)})
	for pq.Len() > 0 {
		it := pq.pop()
		if it.at == to {
			break
		}
		if it.cost-Distance(it.at, to) > cost[it.at] {
			continue
		}
		for d := range directions {
			n := it.at.Neighbour(d)
			if Distance(n, from)+Distance(n, to) > limit {
				continue
			}
			step := g.p.wall
			if r := g.raw(n); g.passable(r.terrain) {
				step = g.terrain[r.terrain].EnterTicks
			}
			c := cost[it.at] + step
			if old, seen := cost[n]; !seen || c < old {
				cost[n], prev[n] = c, it.at
				pq.push(item{n, c + Distance(n, to)})
			}
		}
	}
	out := []Hex{to}
	for h := to; h != from; {
		h = prev[h]
		out = append(out, h)
	}
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
	for _, off := range Disc(g.p.chunk) {
		h := centre.Add(off)
		if e, te := g.raw(h).elevation, g.raw(top).elevation; e > te || (e == te && h.Less(top)) {
			top = h
		}
	}
	var out []Hex
	if g.raw(top).elevation >= g.p.riverSource &&
		int64(g.d.Below(percent, "river.source", draw.Int(cc.A), draw.Int(cc.B))) < g.p.riverShare {
		visited := []Hex{top}
		cur := top
		for range g.p.riverMax {
			next, found := Hex{}, false
			for d := range directions {
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
	return !t.Passable && slices.Contains(t.Tags, "wet")
}

// ---- a small priority queue over hexes ----

type item struct {
	at   Hex
	cost int64
}
type queue []item

func (q queue) Len() int { return len(q) }
func (q queue) less(i, j int) bool {
	if q[i].cost != q[j].cost {
		return q[i].cost < q[j].cost
	}
	return q[i].at.Less(q[j].at)
}

func (q *queue) push(x item) {
	*q = append(*q, x)
	i := len(*q) - 1
	for i > 0 {
		p := (i - 1) / halves
		if !q.less(i, p) {
			break
		}
		(*q)[i], (*q)[p] = (*q)[p], (*q)[i]
		i = p
	}
}

func (q *queue) pop() item {
	old := *q
	top := old[0]
	n := len(old) - 1
	old[0] = old[n]
	*q = old[:n]
	i := 0
	for {
		l, r, m := halves*i+1, halves*i+halves, i
		if l < n && q.less(l, m) {
			m = l
		}
		if r < n && q.less(r, m) {
			m = r
		}
		if m == i {
			return top
		}
		(*q)[i], (*q)[m] = (*q)[m], (*q)[i]
		i = m
	}
}
