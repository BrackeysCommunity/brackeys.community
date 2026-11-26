package harness

import (
	"bytes"
	"cmp"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sync"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
)

// The map run (GDD 4.11): the live map's load budget on a world of 20,000
// discovered tiles, measured headlessly through mapview and the service's
// map host, and whether the last-seen pass costs follow movement rather
// than map size. It reads the worlds; nothing it measures moves a rule.

func init() { Runs["map"] = MapRun }

// mapScenario is the shape of the run's worlds.
type mapScenario struct {
	disc   int64 // the budget world's discovered disc round settlement 0
	least  int64 // tiles that disc must hold
	chars  int
	guilds int   // each founds one settlement on the ring
	ring   int64 // the guilds' settlements stand this far from settlement 0
	walk   int64 // how far each character sets out
	ticks  int64 // how long the characters walk before the reads
	reads  int   // warm reads timed per payload kind
	// The seen-cost worlds: walkers inside a core of the given radius, on
	// a world of just the core and on one of the whole disc.
	core    int64
	reach   int64 // walkers stay this close to the centre, so their sight stays in the core
	walkers int
	leg     int64 // a walker's beat, in tiles
	day     int64 // ticks the walkers walk
}

// mapFull is the scenario the targets name: at least 20,000 discovered tiles
// round a core of radius 18.
var mapFull = mapScenario{disc: 82, least: 20000, chars: 200, guilds: 12, ring: 40, walk: 12, ticks: sheets.TicksPerDay,
	reads: 100, core: 18, reach: 12, walkers: 50, leg: 4, day: sheets.TicksPerDay}

// The budget the live map loads in (GDD 4.11), for the view below at DPR 1;
// bytes are gzip.
const (
	kB              = 1000
	mapViewWidth    = 1440
	mapViewHeight   = 900
	mapTileSize     = 14 // the tile view's hex corner radius, CSS px
	mapAsked        = api.MapOverlayMaxChunks
	coldRequests    = 4 // style, index, regions and an overlay
	coldBytes       = 150 * kB
	styleBytes      = 4 * kB
	indexBytes      = 16 * kB
	regionsBytes    = 110 * kB
	sightBytes      = 8 * kB
	viewRequests    = 32
	viewBytes       = 300 * kB
	tileChunkBytes  = 10 * kB
	areaChunkBytes  = 5 * kB
	overlayPerChunk = 1 * kB
	overlayFloor    = 2 * kB
	allAreaBytes    = 1000 * kB
	coldBuild       = 400 * time.Millisecond
	warmRead        = 5 * time.Millisecond
	overlayRead     = 30 * time.Millisecond
	// The modelled first draw: the cold build, the first draw's bytes over
	// the link, the round trips, and the client's first frame (bounded by
	// the client test).
	linkBytesPerSecond = 1_250_000
	roundTrips         = 3
	roundTrip          = 80 * time.Millisecond
	clientFrame        = 120 * time.Millisecond
	firstDraw          = 1500 * time.Millisecond
	// The seen cost on the whole disc against the core alone.
	seenRatio = 1.5
	passTries = 5 // each pass is timed this often, the fastest kept
)

// mapDiscord is the Discord id character i was made with.
func mapDiscord(i int) string { return fmt.Sprintf("map-u-%d", i) }

// MapRun measures the live map on n seeds (map-0, map-1, …) and writes
// map.md, map.json, readings.json and the first seed's payloads under
// out/dump.
func MapRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	return mapRun(b, out, n, mapFull)
}

func mapRun(b *sheets.Book, out string, n int, sc mapScenario) ([]Measured, error) {
	if n == 0 {
		n = 1
	}
	// Seeds run one after another: the run times reads, and a busy core
	// would time the neighbours.
	rs := make([]mapResult, n)
	for i := range rs {
		dump := ""
		if i == 0 {
			dump = filepath.Join(out, "dump")
		}
		var err error
		if rs[i], err = mapSeed(b, i, sc, dump); err != nil {
			return nil, err
		}
	}
	var doc lineDoc
	readings := writeMap(doc.p, rs, sc)
	if err := doc.save(out, "map.md"); err != nil {
		return nil, err
	}
	if err := writeJSON(filepath.Join(out, "map.json"), mapNumbers(rs)); err != nil {
		return nil, err
	}
	return readings, writeJSON(filepath.Join(out, "readings.json"), readings)
}

// ServeMap builds seed map-0's budget world and serves its map routes on
// addr, unguarded, for a browser check of the site against it.
func ServeMap(b *sheets.Book, addr string) error {
	w, err := newMapWorld(b, mapLabel(0), mapFull)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "map-0: %d tiles, %d characters (Discord ids %s to %s), serving /v1/map/* on %s\n",
		discoveredTiles(w.g), len(w.chars), mapDiscord(0), mapDiscord(len(w.chars)-1), addr)
	// One read at a time: the game is not guarded for readers at once.
	var mu sync.Mutex
	h := service.MapHandler(w.local.Host())
	one := http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		h.ServeHTTP(rw, r)
	})
	srv := &http.Server{Addr: addr, Handler: one, ReadHeaderTimeout: 10 * time.Second}
	return srv.ListenAndServe()
}

func mapLabel(seed int) string { return fmt.Sprintf("map-%d", seed) }

// mapWorld is the budget world: a disc found round settlement 0, guilds
// with settlements on a ring, and characters who have walked for a while.
type mapWorld struct {
	g     *game.Game
	local *service.Local
	home  hex.Hex
	chars []string
}

// passable reports whether a character can stand on h.
func passable(g *game.Game, h hex.Hex) bool {
	if g.World.RegionAt(h) < 0 {
		return false
	}
	_, ok := g.World.EnterTicks(h, h)
	return ok
}

// nearestPassable is the first passable tile ring by ring round h within
// reach of centre, or h when none is.
func nearestPassable(g *game.Game, h, centre hex.Hex, reach int64, taken func(hex.Hex) bool) hex.Hex {
	for k := range int64(4) {
		for _, x := range hex.Ring(h, k) {
			if hex.Distance(centre, x) <= reach && passable(g, x) && (taken == nil || !taken(x)) {
				return x
			}
		}
	}
	return h
}

// spread is the i-th of n tiles laid out on a sunflower spiral within
// radius of centre, so the tiles cover the disc evenly.
func spread(centre hex.Hex, i, n int, radius int64) hex.Hex {
	golden := math.Pi * (3 - math.Sqrt(5))
	d := float64(radius) * math.Sqrt((float64(i)+0.5)/float64(n)) * math.Sqrt(3)
	a := float64(i) * golden
	return centre.Add(render.PixelToHex(d*math.Cos(a), d*math.Sin(a), 1))
}

func newMapWorld(b *sheets.Book, label string, sc mapScenario) (*mapWorld, error) {
	r, err := game.NewRules(b, keys.Throwaway(label))
	if err != nil {
		return nil, err
	}
	g, err := game.New(r)
	if err != nil {
		return nil, err
	}
	w := &mapWorld{g: g, local: service.NewLocal(g), home: g.Places[0].Hex}
	ctx := context.Background()
	for i := range sc.chars {
		rep, ref, err := w.local.Act(ctx, api.ActionRequest{InteractionID: fmt.Sprintf("map-new-%d", i), DiscordID: mapDiscord(i),
			Kind: api.ActCreate, Option: api.StartKnife})
		if err := actErr(ref, err); err != nil {
			return nil, err
		}
		w.chars = append(w.chars, rep.Character.ID)
	}
	if err := w.local.Advance(); err != nil {
		return nil, err
	}
	by := fact.Ref{Kind: "character", ID: w.chars[0]}
	for _, h := range hex.DiscAt(w.home, sc.disc) {
		if err := g.World.Discover(g.Log, h, by); err != nil {
			return nil, err
		}
	}
	if n := discoveredTiles(g); n < sc.least {
		return nil, fmt.Errorf("%s: the disc of %d holds %d discovered tiles, under %d", label, sc.disc, n, sc.least)
	}
	w.foundGuilds(sc)
	for i, id := range w.chars {
		at := nearestPassable(g, spread(w.home, i, len(w.chars), sc.disc-sc.walk-2), w.home, sc.disc, nil)
		if err := g.Teleport(g.Char(id), at); err != nil {
			return nil, err
		}
	}
	if err := w.local.Advance(); err != nil {
		return nil, err
	}
	if err := w.setOut(ctx, sc); err != nil {
		return nil, err
	}
	for range sc.ticks {
		if err := w.local.Advance(); err != nil {
			return nil, err
		}
	}
	return w, nil
}

func actErr(ref *api.Refusal, err error) error {
	if err != nil {
		return err
	}
	if ref != nil {
		return fmt.Errorf("refused: %s %s", ref.Code, ref.Message)
	}
	return nil
}

func discoveredTiles(g *game.Game) int64 {
	var n int64
	for _, st := range g.World.Tiles {
		if st.Discovered != nil {
			n++
		}
	}
	return n
}

// guildOf is the guild character i joins, or -1: three in four of the
// characters are in one of the guilds.
func guildOf(i int, sc mapScenario) int {
	if k := i % (sc.guilds * 4 / 3); k < sc.guilds {
		return k
	}
	return -1
}

// foundGuilds makes each guild with its members and its settlement on the
// ring, as a founding leaves them (GDD 4.8), without the charter's cost.
func (w *mapWorld) foundGuilds(sc mapScenario) {
	g := w.g
	t := g.Tick()
	ring := hex.Ring(w.home, sc.ring)
	settled := func(h hex.Hex) bool { _, ok := g.SettlementAt(h); return ok }
	for k := range sc.guilds {
		var gd *game.Guild
		for i, id := range w.chars {
			if guildOf(i, sc) != k {
				continue
			}
			c := g.Char(id)
			if gd == nil {
				g.NextGuild++
				gd = &game.Guild{G: guild.New(fmt.Sprintf("g-%d", g.NextGuild), fmt.Sprintf("Map Guild %d", k+1), id, t)}
				gd.G.Server = fmt.Sprintf("map-srv-%d", k)
				g.Guilds = append(g.Guilds, gd)
			}
			gd.G.Join(id, t)
			c.C.Guild = gd.G.ID
		}
		if gd == nil {
			continue
		}
		at := nearestPassable(g, ring[k*len(ring)/sc.guilds], w.home, sc.disc, settled)
		p := &game.Place{N: len(g.Places), Hex: at, Lattice: -1, Name: fmt.Sprintf("Mapstead %d", k+1), Guild: gd.G.ID, Founded: t}
		for _, row := range settle.Charter(g.Rules().Book.Structures) {
			p.Raise(row, t, g.Rules().Settle)
		}
		g.Places = append(g.Places, p)
		g.Market.Trader = append(g.Market.Trader, 0)
	}
}

// setOut sends each character walking to a tile walk away, the direction
// turning from one character to the next.
func (w *mapWorld) setOut(ctx context.Context, sc mapScenario) error {
	for i, id := range w.chars {
		c := w.g.Char(id)
		to := nearestPassable(w.g, c.C.At.Add(hex.Direction(i%hex.Directions).Scale(sc.walk)), w.home, sc.disc, nil)
		o, err := w.local.Options(ctx, id)
		if err != nil {
			return err
		}
		// A refused walk leaves the character where it stands.
		if _, _, err := w.local.Act(ctx, api.ActionRequest{InteractionID: fmt.Sprintf("map-out-%d", i), CharacterID: id, Version: o.Version,
			Kind: api.ActTravel, To: &api.Hex{Q: to.Q, R: to.R}}); err != nil {
			return err
		}
	}
	return nil
}

// The client's camera, ported from packages/mmo-map so the run asks for the
// chunks a browser would.

type mapCamera struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Size float64 `json:"size"`
}

type mapViewport struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

var mapScreen = mapViewport{Width: mapViewWidth, Height: mapViewHeight}

func centreOn(h hex.Hex, size float64) mapCamera {
	p := render.HexCentre(h, 1, render.Pt{})
	return mapCamera{X: p.X, Y: p.Y, Size: size}
}

func clampSize(size float64, v api.MapViewNumbers) float64 {
	return math.Min(float64(v.ZoomMax), math.Max(float64(v.ZoomMin), size))
}

// mapLevel is the level a hex corner radius draws at.
func mapLevel(size float64, v api.MapViewNumbers) string {
	switch {
	case size < float64(v.ZoomArea):
		return api.LevelRegion
	case size < float64(v.ZoomTile):
		return api.LevelArea
	}
	return api.LevelTile
}

// fitRegions is the camera that fits every discovered tile in the view.
func fitRegions(r api.MapRegions, view mapViewport, v api.MapViewNumbers) mapCamera {
	left, top, right, bottom := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	take := func(h api.Hex) {
		p := render.HexCentre(hex.Hex{Q: h.Q, R: h.R}, 1, render.Pt{})
		x, y := p.X, p.Y
		left, right = math.Min(left, x), math.Max(right, x)
		top, bottom = math.Min(top, y), math.Max(bottom, y)
	}
	for _, row := range r.Rows {
		first, last := -1, -1
		for i, slot := range row.Slots {
			if slot < 0 {
				continue
			}
			if first < 0 {
				first = i
			}
			last = i
		}
		if first < 0 {
			continue
		}
		take(api.Hex{Q: row.Q + int64(first), R: row.R})
		take(api.Hex{Q: row.Q + int64(last), R: row.R})
	}
	for _, p := range r.Places {
		take(api.Hex{Q: p.Q, R: p.R})
	}
	if left > right {
		return mapCamera{Size: clampSize(float64(v.ZoomMin), v)}
	}
	width, height := right-left+math.Sqrt(3), bottom-top+2
	size := clampSize(math.Min(view.Width/width, view.Height/height), v)
	return mapCamera{X: (left + right) / 2, Y: (top + bottom) / 2, Size: size}
}

// chunksInView are the chunks a view touches, nearest its centre first,
// capped at most (no cap when negative): a chunk lies inside a circle of
// √3·radius + 1 world px round its centre.
func chunksInView(index api.MapIndex, c mapCamera, view mapViewport, most int) []api.MapChunkRef {
	hw, hh := view.Width/2/c.Size, view.Height/2/c.Size
	left, top, right, bottom := c.X-hw, c.Y-hh, c.X+hw, c.Y+hh
	reach := math.Sqrt(3)*float64(index.ChunkRadius) + 1
	type hit struct {
		ref api.MapChunkRef
		d   float64
	}
	var hits []hit
	for _, ref := range index.Chunks {
		p := render.HexCentre(hex.Hex{Q: ref.Centre.Q, R: ref.Centre.R}, 1, render.Pt{})
		x, y := p.X, p.Y
		ox, oy := x-math.Min(math.Max(x, left), right), y-math.Min(math.Max(y, top), bottom)
		if ox*ox+oy*oy > reach*reach {
			continue
		}
		dx, dy := x-c.X, y-c.Y
		hits = append(hits, hit{ref, dx*dx + dy*dy})
	}
	slices.SortStableFunc(hits, func(x, y hit) int {
		return cmp.Or(cmp.Compare(x.d, y.d), cmp.Compare(x.ref.A, y.ref.A), cmp.Compare(x.ref.B, y.ref.B))
	})
	if most >= 0 && len(hits) > most {
		hits = hits[:most]
	}
	out := make([]api.MapChunkRef, len(hits))
	for i, h := range hits {
		out[i] = h.ref
	}
	return out
}

func chunkName(a, b int64) string { return fmt.Sprintf("%d.%d", a, b) }

// payload is one reply as the wire carries it.
type payload struct {
	raw  []byte
	gzip int
}

func encode(v any) (payload, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return payload{}, err
	}
	var buf bytes.Buffer
	z := gzip.NewWriter(&buf)
	if _, err := z.Write(raw); err != nil {
		return payload{}, err
	}
	if err := z.Close(); err != nil {
		return payload{}, err
	}
	return payload{raw: raw, gzip: buf.Len()}, nil
}

// p95 is the 95th percentile of some timings.
func p95(ds []time.Duration) time.Duration {
	s := slices.Clone(ds)
	slices.Sort(s)
	return q(s, 0.95)
}

// mapResult is one seed's readings.
type mapResult struct {
	Seed        int     `json:"seed"`
	Tiles       int64   `json:"tiles"`
	Chunks      int     `json:"chunks"`
	Characters  int     `json:"characters"`
	Guilds      int     `json:"guilds"`
	SeenTiles   int     `json:"seenTiles"` // last-seen tiles over every character's tile view
	ColdBuildMs float64 `json:"coldBuildMs"`
	WarmBuildMs float64 `json:"warmBuildMs"`
	// Warm reads through the host, encoded, p95.
	IndexReadMs   float64 `json:"indexReadMs"`
	RegionsReadMs float64 `json:"regionsReadMs"`
	ChunkReadMs   float64 `json:"chunkReadMs"`
	OverlayMs     float64 `json:"overlayMs"`      // the tile views' overlays, p95
	SightMs       float64 `json:"sightOverlayMs"` // the region views' overlays, p95
	// Bytes, gzip.
	StyleBytes     int      `json:"styleBytes"`
	IndexBytes     int      `json:"indexBytes"`
	RegionsBytes   int      `json:"regionsBytes"`
	SightBytes     int      `json:"sightOverlayBytes"` // the largest region view overlay
	TileChunkMax   int      `json:"tileChunkMax"`
	AreaChunkMax   int      `json:"areaChunkMax"`
	AreaAll        int      `json:"areaAllBytes"`
	TileAll        int      `json:"tileAllBytes"`
	RegionsRaw     int      `json:"regionsRawBytes"`
	ColdRequests   int      `json:"coldRequests"`
	ColdBytes      int      `json:"coldBytes"`
	FitLevel       string   `json:"fitLevel"`
	FitSize        float64  `json:"fitSize"`
	FitChunks      int      `json:"fitChunks"`        // in view at the fitted camera, though the region level asks for none
	ViewRequests   int      `json:"viewRequests"`     // the worst tile view
	ViewBytes      int      `json:"viewBytes"`        // the worst tile view
	ViewChunksMost int      `json:"viewChunksMost"`   // chunks in the busiest tile view
	OverlayOver    int      `json:"overlayOverBytes"` // the worst overlay against its per-chunk bound; ≤ 0 holds
	ModelledMs     float64  `json:"modelledMs"`       // the first draw before the client's frame
	Seen           passCost `json:"seen"`
	Holds          bool     `json:"holds"`
	Misses         []string `json:"misses,omitempty"`
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }

func mapSeed(b *sheets.Book, seed int, sc mapScenario, dump string) (mapResult, error) {
	label := mapLabel(seed)
	w, err := newMapWorld(b, label, sc)
	if err != nil {
		return mapResult{}, err
	}
	res := mapResult{Seed: seed, Characters: len(w.chars)}
	for _, gd := range w.g.Guilds {
		if len(gd.G.Members) > 0 {
			res.Guilds++
		}
	}
	if err := w.measure(&res, sc, dump); err != nil {
		return res, err
	}
	if res.Seen, err = measureSeen(b, label, sc); err != nil {
		return res, err
	}
	res.judge()
	return res, nil
}

// measure reads the budget world as the clients would and writes what it
// read to dump, when one is named.
func (w *mapWorld) measure(res *mapResult, sc mapScenario, dump string) error {
	ctx := context.Background()
	host := w.local.Host()
	st, err := host.MapStyle(ctx)
	if err != nil {
		return err
	}
	runtime.GC()
	start := time.Now()
	mapview.Build(w.g, "map", 0, st.Rev)
	res.ColdBuildMs = ms(time.Since(start))
	runtime.GC()
	start = time.Now()
	mapview.Build(w.g, "map", 0, st.Rev)
	res.WarmBuildMs = ms(time.Since(start))

	index, err := host.MapIndex(ctx)
	if err != nil {
		return err
	}
	regions, err := host.MapRegions(ctx)
	if err != nil {
		return err
	}
	res.Tiles, res.Chunks = index.Tiles, len(index.Chunks)
	files := map[string]payload{}
	put := func(name string, v any) (payload, error) {
		p, err := encode(v)
		files[name] = p
		return p, err
	}
	stp, err := put("style.json", st)
	if err != nil {
		return err
	}
	ixp, err := put("index.json", index)
	if err != nil {
		return err
	}
	rgp, err := put("regions.json", regions)
	if err != nil {
		return err
	}
	res.StyleBytes, res.IndexBytes, res.RegionsBytes, res.RegionsRaw = stp.gzip, ixp.gzip, rgp.gzip, len(rgp.raw)
	tileBytes := map[string]int{}
	for _, ref := range index.Chunks {
		for _, level := range []string{api.LevelArea, api.LevelTile} {
			c, ref2, err := host.MapChunk(ctx, ref.A, ref.B, level)
			if err := actErr(ref2, err); err != nil {
				return err
			}
			p, err := put(filepath.Join("chunks", level, chunkName(ref.A, ref.B)+".json"), c)
			if err != nil {
				return err
			}
			if level == api.LevelArea {
				res.AreaChunkMax, res.AreaAll = max(res.AreaChunkMax, p.gzip), res.AreaAll+p.gzip
			} else {
				res.TileChunkMax, res.TileAll = max(res.TileChunkMax, p.gzip), res.TileAll+p.gzip
				tileBytes[chunkName(ref.A, ref.B)] = p.gzip
			}
		}
	}
	if err := w.timeReads(res, sc, index); err != nil {
		return err
	}

	fit := fitRegions(regions, mapScreen, st.View)
	res.FitLevel, res.FitSize = mapLevel(fit.Size, st.View), fit.Size
	fitIn := chunksInView(index, fit, mapScreen, -1)
	res.FitChunks = len(fitIn)
	var sights, views []time.Duration
	var worstSight, worstView string
	var sightBody, viewBody api.MapOverlay
	var viewCam mapCamera
	var viewIn, viewAsked []api.MapChunkRef
	for _, id := range w.chars {
		start := time.Now()
		o, ref, err := host.MapOverlay(ctx, id, api.MapOverlayQuery{Sight: true})
		if err := actErr(ref, err); err != nil {
			return err
		}
		p, err := encode(o)
		if err != nil {
			return err
		}
		sights = append(sights, time.Since(start))
		if p.gzip > res.SightBytes || worstSight == "" {
			res.SightBytes, worstSight, sightBody = p.gzip, id, o
		}

		cam := centreOn(w.g.Char(id).C.At, mapTileSize)
		in := chunksInView(index, cam, mapScreen, -1)
		asked := in[:min(len(in), mapAsked)]
		qy := api.MapOverlayQuery{Chunks: make([]api.MapChunkID, len(asked))}
		for i, c := range asked {
			qy.Chunks[i] = api.MapChunkID{A: c.A, B: c.B}
		}
		start = time.Now()
		o, ref, err = host.MapOverlay(ctx, id, qy)
		if err := actErr(ref, err); err != nil {
			return err
		}
		p, err = encode(o)
		if err != nil {
			return err
		}
		views = append(views, time.Since(start))
		for _, t := range o.Tiles {
			if t.Fog == api.FogSeen {
				res.SeenTiles++
			}
		}
		total := p.gzip
		for _, c := range in {
			total += tileBytes[chunkName(c.A, c.B)]
		}
		res.ViewRequests = max(res.ViewRequests, len(in)+1)
		res.ViewChunksMost = max(res.ViewChunksMost, len(in))
		over := p.gzip - (overlayPerChunk*len(asked) + overlayFloor)
		if worstView == "" || over > res.OverlayOver {
			res.OverlayOver = over
		}
		if worstView == "" || total > res.ViewBytes {
			res.ViewBytes, worstView, viewBody, viewCam, viewIn, viewAsked = total, id, o, cam, in, asked
		}
	}
	res.SightMs, res.OverlayMs = ms(p95(sights)), ms(p95(views))
	res.ColdRequests = coldRequests
	res.ColdBytes = res.StyleBytes + res.IndexBytes + res.RegionsBytes + res.SightBytes
	wire := time.Duration(float64(res.ColdBytes) / linkBytesPerSecond * float64(time.Second))
	res.ModelledMs = res.ColdBuildMs + ms(wire) + ms(roundTrips*roundTrip)
	if dump == "" {
		return nil
	}
	if _, err := put("overlay-sight.json", sightBody); err != nil {
		return err
	}
	if _, err := put("overlay-tile.json", viewBody); err != nil {
		return err
	}
	ids := func(refs []api.MapChunkRef) []string {
		out := make([]string, len(refs))
		for i, r := range refs {
			out[i] = chunkName(r.A, r.B)
		}
		return out
	}
	if _, err := put("view.json", dumpView{View: mapScreen,
		Region: dumpCamera{Character: worstSight, Camera: fit, Chunks: ids(fitIn)},
		Tile:   dumpCamera{Character: worstView, Camera: viewCam, Chunks: ids(viewIn), Asked: ids(viewAsked)}}); err != nil {
		return err
	}
	return writeDump(dump, files)
}

// dumpView is the cameras the run asked for chunks by, for the client test
// to ask again with packages/mmo-map's own chunksInView.
type dumpView struct {
	View   mapViewport `json:"view"`
	Region dumpCamera  `json:"region"`
	Tile   dumpCamera  `json:"tile"`
}

type dumpCamera struct {
	Character string    `json:"character"`
	Camera    mapCamera `json:"camera"`
	Chunks    []string  `json:"chunks"`          // in view, nearest first
	Asked     []string  `json:"asked,omitempty"` // the overlay's, at most api.MapOverlayMaxChunks
}

func writeDump(dir string, files map[string]payload) error {
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	for name, p := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, p.raw, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func writeJSON(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o644)
}

// timeReads times warm reads through the host, each encoded as the wire
// would carry it.
func (w *mapWorld) timeReads(res *mapResult, sc mapScenario, index api.MapIndex) error {
	ctx := context.Background()
	host := w.local.Host()
	timed := func(n int, read func(i int) (any, error)) (time.Duration, error) {
		ds := make([]time.Duration, 0, n)
		for i := range n {
			start := time.Now()
			v, err := read(i)
			if err != nil {
				return 0, err
			}
			if _, err := json.Marshal(v); err != nil {
				return 0, err
			}
			ds = append(ds, time.Since(start))
		}
		return p95(ds), nil
	}
	d, err := timed(sc.reads, func(int) (any, error) { return host.MapIndex(ctx) })
	if err != nil {
		return err
	}
	res.IndexReadMs = ms(d)
	if d, err = timed(sc.reads, func(int) (any, error) { return host.MapRegions(ctx) }); err != nil {
		return err
	}
	res.RegionsReadMs = ms(d)
	levels := []string{api.LevelArea, api.LevelTile}
	n := max(sc.reads, len(index.Chunks)*len(levels))
	d, err = timed(n, func(i int) (any, error) {
		ref := index.Chunks[i/len(levels)%len(index.Chunks)]
		c, refused, err := host.MapChunk(ctx, ref.A, ref.B, levels[i%len(levels)])
		return c, actErr(refused, err)
	})
	res.ChunkReadMs = ms(d)
	return err
}

// judge holds a seed's readings to the budget.
func (r *mapResult) judge() {
	var miss []string
	check := func(ok bool, f string, a ...any) {
		if !ok {
			miss = append(miss, fmt.Sprintf(f, a...))
		}
	}
	check(r.ColdRequests <= coldRequests, "first draw: %d requests", r.ColdRequests)
	check(r.ColdBytes <= coldBytes, "first draw: %d bytes", r.ColdBytes)
	check(r.StyleBytes <= styleBytes, "style: %d bytes", r.StyleBytes)
	check(r.IndexBytes <= indexBytes, "index: %d bytes", r.IndexBytes)
	check(r.RegionsBytes <= regionsBytes, "regions: %d bytes", r.RegionsBytes)
	check(r.SightBytes <= sightBytes, "region view overlay: %d bytes", r.SightBytes)
	check(r.ViewRequests <= viewRequests, "tile view: %d requests", r.ViewRequests)
	check(r.ViewBytes <= viewBytes, "tile view: %d bytes", r.ViewBytes)
	check(r.TileChunkMax <= tileChunkBytes, "tile chunk: %d bytes", r.TileChunkMax)
	check(r.AreaChunkMax <= areaChunkBytes, "area chunk: %d bytes", r.AreaChunkMax)
	check(r.OverlayOver <= 0, "tile view overlay: %d bytes over its bound", r.OverlayOver)
	check(r.AreaAll <= allAreaBytes, "every area chunk: %d bytes", r.AreaAll)
	check(r.ColdBuildMs <= ms(coldBuild), "cold build: %.1f ms", r.ColdBuildMs)
	reads := max(r.IndexReadMs, r.RegionsReadMs, r.ChunkReadMs)
	check(reads <= ms(warmRead), "warm read p95: %.2f ms", reads)
	check(r.OverlayMs <= ms(overlayRead) && r.SightMs <= ms(overlayRead), "overlay p95: %.2f ms, %.2f ms by sight", r.OverlayMs, r.SightMs)
	check(r.ModelledMs+ms(clientFrame) <= ms(firstDraw), "modelled first draw: %.0f ms before the client's frame", r.ModelledMs)
	r.Holds, r.Misses = len(miss) == 0, miss
}

// passCost is the same walkers on the same paths over one world day on a
// world of just the core and on one of the whole disc.
type passCost struct {
	SmallTiles   int64   `json:"smallTiles"`
	BigTiles     int64   `json:"bigTiles"`
	SmallRecords int     `json:"smallRecords"`
	BigRecords   int     `json:"bigRecords"`
	SmallPassMs  float64 `json:"smallPassMs"`
	BigPassMs    float64 `json:"bigPassMs"`
	Changes      int     `json:"changes"` // keys written on the big world
	Moves        int     `json:"moves"`   // tiles walked on the big world
	Apart        int     `json:"apart"`   // walker-ticks the two worlds disagree where a walker stands
}

func (s passCost) recordRatio() float64 { return ratio(s.BigRecords, s.SmallRecords) }
func (s passCost) passRatio() float64   { return s.BigPassMs / math.Max(s.SmallPassMs, 1e-3) }
func (s passCost) holds() bool {
	return s.Apart == 0 && s.recordRatio() <= seenRatio && s.passRatio() <= seenRatio
}

func ratio(a, b int) float64 {
	if b == 0 {
		if a == 0 {
			return 1
		}
		return math.Inf(1)
	}
	return float64(a) / float64(b)
}

// seenWorld is one world of the seen-cost walk and its pass.
type seenWorld struct {
	g       *game.Game
	walkers []string
	beat    []int // where each walker is on its path
	back    []bool
	prev    map[mapview.Holder]mapview.Key
	seen    mapview.MemSeen
	records int
	changes int
	pass    time.Duration
}

func newSeenWorld(b *sheets.Book, label string, sc mapScenario, disc int64) (*seenWorld, error) {
	r, err := game.NewRules(b, keys.Throwaway(label))
	if err != nil {
		return nil, err
	}
	g, err := game.New(r)
	if err != nil {
		return nil, err
	}
	w := &seenWorld{g: g, prev: map[mapview.Holder]mapview.Key{}}
	for i := range sc.walkers {
		res, err := g.Act(game.Command{Key: fmt.Sprintf("map-walker-%d", i), Kind: game.Create})
		if err != nil {
			return nil, err
		}
		w.walkers = append(w.walkers, res.Char.C.ID)
	}
	if _, err := g.Advance(); err != nil {
		return nil, err
	}
	home := g.Places[0].Hex
	by := fact.Ref{Kind: "character", ID: w.walkers[0]}
	// The core first, in the same order on both worlds, then the rest.
	for _, far := range []bool{false, true} {
		for _, h := range hex.DiscAt(home, disc) {
			if (hex.Distance(home, h) > sc.core) != far {
				continue
			}
			if err := g.World.Discover(g.Log, h, by); err != nil {
				return nil, err
			}
		}
	}
	w.beat, w.back = make([]int, len(w.walkers)), make([]bool, len(w.walkers))
	return w, nil
}

// seenPaths are the walkers' beats inside the core: from a start spread
// over it, up to leg tiles on, turning where the ground will not carry
// them; the same on both worlds, since their terrain is.
func seenPaths(g *game.Game, sc mapScenario) [][]hex.Hex {
	home := g.Places[0].Hex
	out := make([][]hex.Hex, sc.walkers)
	for i := range out {
		at := nearestPassable(g, spread(home, i, sc.walkers, sc.reach-sc.leg), home, sc.reach, nil)
		path := []hex.Hex{at}
		for range sc.leg {
			last := path[len(path)-1]
			for k := range hex.Directions {
				n := last.Neighbour((i + k) % hex.Directions)
				if hex.Distance(home, n) <= sc.reach && passable(g, n) && !slices.Contains(path, n) {
					path = append(path, n)
					break
				}
			}
		}
		out[i] = path
	}
	return out
}

// place stands each walker at the start of its path and keys every holder.
func (w *seenWorld) place(paths [][]hex.Hex, p mapview.Params) error {
	for i, id := range w.walkers {
		if err := w.g.Teleport(w.g.Char(id), paths[i][0]); err != nil {
			return err
		}
	}
	if _, err := w.g.Advance(); err != nil {
		return err
	}
	changes, gone := mapview.Pass(w.g, w.prev, nil, p)
	w.keep(changes, gone)
	return nil
}

// free is whether walker i stands on its beat with nothing holding it.
func (w *seenWorld) free(paths [][]hex.Hex, i int) bool {
	c := w.g.Char(w.walkers[i])
	return c.Long == nil && c.Fight == nil && len(paths[i]) >= 2 && c.C.At == paths[i][w.beat[i]]
}

// step moves each walker for which may(i) holds one tile along its beat,
// there and back, then advances the tick.
func (w *seenWorld) step(paths [][]hex.Hex, t int64, may func(i int) bool) (int, error) {
	moves := 0
	for i, id := range w.walkers {
		c := w.g.Char(id)
		path := paths[i]
		if !may(i) {
			continue
		}
		next := w.beat[i] + 1
		if w.back[i] {
			next = w.beat[i] - 1
		}
		if next < 0 || next >= len(path) {
			w.back[i] = !w.back[i]
			next = 2*w.beat[i] - next
		}
		cmd := game.Command{Key: fmt.Sprintf("map-step-%d-%d", t, i), Char: id, Kind: game.Step, Dir: c.C.At.DirectionTo(path[next])}
		if _, err := w.g.Act(cmd); err != nil {
			if refused(err) {
				continue
			}
			return 0, err
		}
		w.beat[i] = next
		moves++
	}
	_, err := w.g.Advance()
	return moves, err
}

// timePass runs the pass passTries times and keeps the fastest; the pass
// is pure, so each run's changes are the same.
func (w *seenWorld) timePass(p mapview.Params) ([]mapview.Change, []mapview.Holder, time.Duration) {
	var changes []mapview.Change
	var gone []mapview.Holder
	best := time.Duration(math.MaxInt64)
	for range passTries {
		start := time.Now()
		changes, gone = mapview.Pass(w.g, w.prev, nil, p)
		best = min(best, time.Since(start))
	}
	return changes, gone, best
}

func (w *seenWorld) keep(changes []mapview.Change, gone []mapview.Holder) {
	w.seen.Apply(changes, gone)
	for _, c := range changes {
		w.prev[c.Holder] = c.Key
		w.records += len(c.Seen)
	}
	w.changes += len(changes)
	for _, h := range gone {
		delete(w.prev, h)
	}
}

// measureSeen walks the same walkers on both worlds tick by tick and times
// each pass, the two worlds' passes interleaved so a busy core slows both.
func measureSeen(b *sheets.Book, label string, sc mapScenario) (passCost, error) {
	small, err := newSeenWorld(b, label, sc, sc.core)
	if err != nil {
		return passCost{}, err
	}
	big, err := newSeenWorld(b, label, sc, sc.disc)
	if err != nil {
		return passCost{}, err
	}
	p := mapview.ParamsOf(b)
	paths := seenPaths(small.g, sc)
	worlds := []*seenWorld{small, big}
	for _, w := range worlds {
		if err := w.place(paths, p); err != nil {
			return passCost{}, err
		}
	}
	// The walk counts only what the day writes.
	for _, w := range worlds {
		w.records, w.changes = 0, 0
	}
	out := passCost{SmallTiles: discoveredTiles(small.g), BigTiles: discoveredTiles(big.g)}
	// A walker steps only when it is free on both worlds: an encounter
	// draws on the world's state, so one world may hold a walker the other
	// does not, and the paths must stay the same.
	for t := range sc.day {
		both := make([]bool, len(small.walkers))
		for i := range both {
			both[i] = small.free(paths, i) && big.free(paths, i)
		}
		for _, w := range worlds {
			moves, err := w.step(paths, t, func(i int) bool { return both[i] })
			if err != nil {
				return out, err
			}
			if w == big {
				out.Moves += moves
			}
		}
		runtime.GC()
		for _, w := range worlds {
			changes, gone, took := w.timePass(p)
			w.pass += took
			w.keep(changes, gone)
		}
		for i := range small.walkers {
			if small.g.Char(small.walkers[i]).C.At != big.g.Char(big.walkers[i]).C.At {
				out.Apart++
			}
		}
	}
	out.SmallRecords, out.BigRecords = small.records, big.records
	out.SmallPassMs, out.BigPassMs = ms(small.pass), ms(big.pass)
	out.Changes = big.changes
	if small.seen.Count() == 0 && big.seen.Count() == 0 && out.Moves > 0 {
		return out, errors.New("the walkers moved and nothing left their sight")
	}
	return out, nil
}

// mapJSON is map.json: each seed, and the worst modelled first draw before
// the client's frame, which the proof adds.
type mapJSON struct {
	Seeds          []mapResult `json:"seeds"`
	ModelledMs     float64     `json:"modelledMs"`
	ClientBudgetMs float64     `json:"clientBudgetMs"`
	FirstDrawMs    float64     `json:"firstDrawMs"`
}

func mapNumbers(rs []mapResult) mapJSON {
	out := mapJSON{Seeds: rs, ClientBudgetMs: ms(clientFrame), FirstDrawMs: ms(firstDraw)}
	for _, r := range rs {
		out.ModelledMs = math.Max(out.ModelledMs, r.ModelledMs)
	}
	return out
}

func kb(n int) string { return fmt.Sprintf("%.1f KB", float64(n)/kB) }

// writeMap writes map.md and returns the two readings, each the worst
// seed's.
func writeMap(p func(string, ...any), rs []mapResult, sc mapScenario) []Measured {
	worst := func(f func(mapResult) float64) mapResult {
		return slices.MaxFunc(rs, func(a, b mapResult) int { return cmp.Compare(f(a), f(b)) })
	}
	maxOf := func(f func(mapResult) float64) float64 { return f(worst(f)) }
	p("# Map run")
	p("")
	p("The live map's load budget (GDD 4.11) on %d seed(s) (`map-0` …): each a fresh world with every tile of the radius-%d disc round settlement 0 discovered, %d characters walking a world day from spots spread over it, and %d guilds of three in four of them, each with a settlement on the ring %d tiles out. Read through `service.NewLocal(g).Host()` as the clients would, for a %d×%d CSS-px view; bytes are gzip at the default level. The client's frames are timed by `packages/mmo-map/test/budget.test.ts` on `dump/` (`MMO_MAP_DUMP`), which the proof adds to the modelled first draw.",
		len(rs), sc.disc, sc.chars, sc.guilds, sc.ring, mapViewWidth, mapViewHeight)
	p("")
	p("| Seed | Tiles | Chunks | Characters | Guilds | Last-seen tiles in their tile views |")
	p("| --- | --- | --- | --- | --- | --- |")
	for _, r := range rs {
		p("| map-%d | %s | %d | %d | %d | %d |", r.Seed, comma(r.Tiles), r.Chunks, r.Characters, r.Guilds, r.SeenTiles)
	}
	p("")
	p("## The budget (worst seed)")
	p("")
	p("| Bound | Reading | Limit | Holds |")
	p("| --- | --- | --- | --- |")
	row := func(name, reading, limit string, ok bool) {
		p("| %s | %s | %s | %s |", name, reading, limit, holds(ok))
	}
	f := func(v func(mapResult) float64) float64 { return maxOf(v) }
	b := func(v func(mapResult) int) int { return int(maxOf(func(r mapResult) float64 { return float64(v(r)) })) }
	row("(a) first draw, requests", fmt.Sprint(b(func(r mapResult) int { return r.ColdRequests })), fmt.Sprint(coldRequests), b(func(r mapResult) int { return r.ColdRequests }) <= coldRequests)
	row("(a) first draw, bytes", kb(b(func(r mapResult) int { return r.ColdBytes })), kb(coldBytes), b(func(r mapResult) int { return r.ColdBytes }) <= coldBytes)
	row("(a) style", kb(b(func(r mapResult) int { return r.StyleBytes })), kb(styleBytes), b(func(r mapResult) int { return r.StyleBytes }) <= styleBytes)
	row("(a) index", kb(b(func(r mapResult) int { return r.IndexBytes })), kb(indexBytes), b(func(r mapResult) int { return r.IndexBytes }) <= indexBytes)
	row("(a) regions", kb(b(func(r mapResult) int { return r.RegionsBytes })), kb(regionsBytes), b(func(r mapResult) int { return r.RegionsBytes }) <= regionsBytes)
	row("(a) overlay by sight, the largest of every character's", kb(b(func(r mapResult) int { return r.SightBytes })), kb(sightBytes), b(func(r mapResult) int { return r.SightBytes }) <= sightBytes)
	row("(b) tile view at s = 14, requests (the busiest character's)", fmt.Sprint(b(func(r mapResult) int { return r.ViewRequests })), fmt.Sprint(viewRequests), b(func(r mapResult) int { return r.ViewRequests }) <= viewRequests)
	row("(b) tile view, bytes (the heaviest)", kb(b(func(r mapResult) int { return r.ViewBytes })), kb(viewBytes), b(func(r mapResult) int { return r.ViewBytes }) <= viewBytes)
	row("(b) each tile chunk", kb(b(func(r mapResult) int { return r.TileChunkMax })), kb(tileChunkBytes), b(func(r mapResult) int { return r.TileChunkMax }) <= tileChunkBytes)
	row("(b) each area chunk", kb(b(func(r mapResult) int { return r.AreaChunkMax })), kb(areaChunkBytes), b(func(r mapResult) int { return r.AreaChunkMax }) <= areaChunkBytes)
	row("(b) overlay against 1 KB per chunk asked + 2 KB", fmt.Sprintf("%+d bytes", b(func(r mapResult) int { return r.OverlayOver })), "≤ 0", b(func(r mapResult) int { return r.OverlayOver }) <= 0)
	row("(c) every chunk at area level", kb(b(func(r mapResult) int { return r.AreaAll })), kb(allAreaBytes), b(func(r mapResult) int { return r.AreaAll }) <= allAreaBytes)
	row("(d) base build, cold", fmt.Sprintf("%.1f ms (warm %.1f ms)", f(func(r mapResult) float64 { return r.ColdBuildMs }), f(func(r mapResult) float64 { return r.WarmBuildMs })), millis(coldBuild), f(func(r mapResult) float64 { return r.ColdBuildMs }) <= ms(coldBuild))
	reads := f(func(r mapResult) float64 { return max(r.IndexReadMs, r.RegionsReadMs, r.ChunkReadMs) })
	row("(d) warm read p95 (index, regions, chunk, encoded)", fmt.Sprintf("%.2f, %.2f, %.2f ms", f(func(r mapResult) float64 { return r.IndexReadMs }), f(func(r mapResult) float64 { return r.RegionsReadMs }), f(func(r mapResult) float64 { return r.ChunkReadMs })), millis(warmRead), reads <= ms(warmRead))
	over := f(func(r mapResult) float64 { return max(r.OverlayMs, r.SightMs) })
	row(fmt.Sprintf("(d) overlay p95 in memory, %d tile views and %d by sight", sc.chars, sc.chars), fmt.Sprintf("%.2f ms, %.2f ms", f(func(r mapResult) float64 { return r.OverlayMs }), f(func(r mapResult) float64 { return r.SightMs })), millis(overlayRead), over <= ms(overlayRead))
	model := f(func(r mapResult) float64 { return r.ModelledMs })
	row("(f) modelled first draw before the client's frame", fmt.Sprintf("%.0f ms", model), fmt.Sprintf("%.0f ms less the client's %.0f", ms(firstDraw), ms(clientFrame)), model+ms(clientFrame) <= ms(firstDraw))
	p("")
	w0 := rs[0]
	p("On map-0 the fitted world view draws at the %s level (s = %.2f) and touches %d chunks, which the region level never asks for; the busiest tile view holds %d chunks. (a) and (b) are what a cold browser fetches. The overlay over HTTP with Postgres is the service's test; the client's frames, (e), are the client test's.",
		w0.FitLevel, w0.FitSize, w0.FitChunks, w0.ViewChunksMost)
	budgetOK := !slices.ContainsFunc(rs, func(r mapResult) bool { return !r.Holds })
	for _, r := range rs {
		for _, m := range r.Misses {
			p("- map-%d misses: %s", r.Seed, m)
		}
	}
	p("")
	p("## The last-seen pass against map size")
	p("")
	p("The same %d walkers on the same paths (each a beat of up to %d tiles within %d of settlement 0, stepped whenever free on both worlds) inside a core of radius %d, over %d ticks, on a world with just the core discovered and on one with the whole radius-%d disc; after each tick the pass runs over every holder, timed %d times and the fastest kept, the two worlds interleaved.",
		sc.walkers, sc.leg, sc.reach, sc.core, sc.day, sc.disc, passTries)
	p("")
	p("| Seed | Tiles, core / disc | Records written | Pass ms | Tiles walked | Keys written | Paths apart |")
	p("| --- | --- | --- | --- | --- | --- | --- |")
	for _, r := range rs {
		s := r.Seen
		p("| map-%d | %s / %s | %d / %d (%.2fx) | %.2f / %.2f (%.2fx) | %d | %d | %d |", r.Seed, comma(s.SmallTiles), comma(s.BigTiles),
			s.SmallRecords, s.BigRecords, s.recordRatio(), s.SmallPassMs, s.BigPassMs, s.passRatio(), s.Moves, s.Changes, s.Apart)
	}
	worstSeen := slices.MaxFunc(rs, func(a, b mapResult) int {
		return cmp.Compare(math.Max(a.Seen.recordRatio(), a.Seen.passRatio()), math.Max(b.Seen.recordRatio(), b.Seen.passRatio()))
	}).Seen
	seenOK := !slices.ContainsFunc(rs, func(r mapResult) bool { return !r.Seen.holds() })
	p("")
	p("Holds: %s.", holds(seenOK))

	wb := worst(func(r mapResult) float64 { return float64(r.ViewBytes) })
	budget := Measured{Target: "map-load-budget", Holds: budgetOK, Value: fmt.Sprintf(
		"first draw %d requests, %s (style %s, index %s, regions %s, overlay %s); tile view %d requests, %s; chunks ≤ %s tile, ≤ %s area, %s all area; build %.0f ms cold; reads p95 %.2f ms, overlay %.2f ms; modelled %.0f ms + the client's frame",
		b(func(r mapResult) int { return r.ColdRequests }), kb(b(func(r mapResult) int { return r.ColdBytes })),
		kb(b(func(r mapResult) int { return r.StyleBytes })), kb(b(func(r mapResult) int { return r.IndexBytes })),
		kb(b(func(r mapResult) int { return r.RegionsBytes })), kb(b(func(r mapResult) int { return r.SightBytes })),
		b(func(r mapResult) int { return r.ViewRequests }), kb(wb.ViewBytes), kb(b(func(r mapResult) int { return r.TileChunkMax })),
		kb(b(func(r mapResult) int { return r.AreaChunkMax })), kb(b(func(r mapResult) int { return r.AreaAll })),
		f(func(r mapResult) float64 { return r.ColdBuildMs }), reads, over, model)}
	seen := Measured{Target: "map-seen-cost", Holds: seenOK, Value: fmt.Sprintf(
		"records %d at %s tiles against %d at %s (%.2fx); pass %.2f ms against %.2f ms (%.2fx); paths apart %d",
		worstSeen.BigRecords, comma(worstSeen.BigTiles), worstSeen.SmallRecords, comma(worstSeen.SmallTiles), worstSeen.recordRatio(),
		worstSeen.BigPassMs, worstSeen.SmallPassMs, worstSeen.passRatio(), worstSeen.Apart)}
	return []Measured{budget, seen}
}
