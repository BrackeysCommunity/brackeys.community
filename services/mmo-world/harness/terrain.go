package harness

import (
	"cmp"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// The terrain run (GDD 14.4): terrain pins drawn at random and placed
// through the world's validator, as designers and as admins, with every
// accepted one landed and held to the World targets against a pinless
// twin of the same world.

func init() { Runs["terrain"] = TerrainRun }

const (
	terrainSeeds    = 1000
	terrainPins     = 12 // pins tried per seed
	terrainHomes    = 6  // the starting settlements pins are drawn round
	terrainFarLeast = 2  // a designer's pin stands at least this far from its settlement
	terrainSlotIn   = 4  // 1 pin in this many also fixes an ordinary slot
	terrainLiftIn   = 3  // 1 pin in this many also sets an elevation
)

// terrainDraw is the run's one draw label.
const terrainDraw = "harness.terrain"

var terrainRoles = []string{world.PinDesigner, world.PinAdmin}

// terrainResult is one seed of the terrain run.
type terrainResult struct {
	seed                         int
	tried, accepted              map[string]int // by role
	codes                        map[string]int
	rings, slots, lifts          int // accepted pins with a ring, a slot, an elevation
	landed, patchTiles           int
	tiles, compared, inReach     int // ground tiles compared; content off and in reach
	homes, points, slotsChecked  int
	scaffoldApart                int // targets the scaffold itself joins to no settlement
	chunks                       int // chunks compared in each order
	refusedSame, refusedDigested int
	bad                          []string
}

// terrainWorld is a seed's pinned world, its pinless twin and what the
// run placed on it.
type terrainWorld struct {
	b         *sheets.Book
	seed      int
	g, tg     *gen.Gen
	s, twin   *world.State
	log, tlog *fact.Mem
	area      *gen.Area
	pure      []gen.TileBaseline // the area before any pin
	pins      []world.Pin        // accepted
	homes     []int              // area indices of the settlements within spikeEOut
	pureLabel []int
	keys      keys.Set
}

// TerrainRun places terrain pins on n seeds and writes terrain.md and
// readings.json under out.
func TerrainRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	_, m, err := terrainRun(b, out, n)
	if err != nil {
		return nil, err
	}
	readings := []Measured{m}
	raw, err := json.MarshalIndent(readings, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(out, "readings.json"), append(raw, '\n'), 0o644); err != nil {
		return nil, err
	}
	return readings, nil
}

func terrainRun(b *sheets.Book, out string, n int) ([]terrainResult, Measured, error) {
	if n == 0 {
		n = terrainSeeds
	}
	rs := make([]terrainResult, n)
	if err := runParallel(n, func(i int) error {
		var err error
		rs[i], err = terrainSeed(b, i)
		return err
	}); err != nil {
		return nil, Measured{}, err
	}
	var doc lineDoc
	m := writeTerrain(doc.p, b, rs)
	return rs, m, doc.save(out, "terrain.md")
}

// terrainSeed founds a seed's world and its twin, places the pins and
// checks what they did.
func terrainSeed(b *sheets.Book, seed int) (terrainResult, error) {
	w, err := newTerrainWorld(b, seed)
	if err != nil {
		return terrainResult{}, err
	}
	out := terrainResult{seed: seed, tried: map[string]int{}, accepted: map[string]int{}, codes: map[string]int{}}
	if err := w.place(&out); err != nil {
		return out, err
	}
	if err := w.check(&out); err != nil {
		return out, err
	}
	return out, nil
}

func newTerrainWorld(b *sheets.Book, seed int) (*terrainWorld, error) {
	label := fmt.Sprintf("terrain-%d", seed)
	g, k, err := newGen(b, label)
	if err != nil {
		return nil, err
	}
	s, err := world.New(b, g, k.Roll)
	if err != nil {
		return nil, err
	}
	tg, tk, err := newGen(b, label)
	if err != nil {
		return nil, err
	}
	twin, err := world.New(b, tg, tk.Roll)
	if err != nil {
		return nil, err
	}
	w := &terrainWorld{b: b, seed: seed, g: g, tg: tg, s: s, twin: twin, log: &fact.Mem{}, tlog: &fact.Mem{}, keys: k}
	w.area = g.DiscArea(hex.Hex{}, spikeEOut+spikeEMargin)
	w.pure = slices.Clone(w.area.Tiles)
	for _, i := range w.area.Settlements() {
		if w.area.Tiles[i].Hex.Len() <= spikeEOut {
			w.homes = append(w.homes, i)
		}
	}
	w.pureLabel = areaLabels(g, w.area, w.pure)
	return w, nil
}

// place draws up to terrainPins pins and lands every accepted one.
func (w *terrainWorld) place(out *terrainResult) error {
	d := draw.NewDrawer(w.keys.Roll)
	pinPath := sheets.IntParam(w.b.MapParams, "pin-path-tiles")
	check := sheets.IntParam(w.b.LiveOpsParams, "ground-check-tiles")
	var homes []hex.Hex
	for n := range terrainHomes {
		if h := w.g.Settlement(n).Hex; h.Len()+pinPath < spikeEOut || n == 0 {
			homes = append(homes, h)
		}
	}
	limits := sheets.Lookup(w.b.PinLimits)
	who := fact.Ref{Kind: "character", ID: "c-terrain"}
	for r := range terrainPins {
		parts := func(what string) []draw.Part {
			return []draw.Part{draw.Int(int64(w.seed)), draw.Int(int64(r)), draw.Str(what)}
		}
		home := homes[d.Below(uint64(len(homes)), terrainDraw, parts("home")...)]
		role := terrainRoles[d.Below(uint64(len(terrainRoles)), terrainDraw, parts("role")...)]
		by := world.PinBy{Role: role}
		var around []hex.Hex
		if role == world.PinAdmin {
			id := w.g.RegionOf(home)
			around = slices.Clone(w.g.RegionTiles(id))
			by = world.PinBy{Role: role, Server: fmt.Sprintf("server-%d", r), Char: fmt.Sprintf("c-admin-%d", r), Label: fmt.Sprintf("Server %d", r), Region: &id}
		} else {
			around = slices.DeleteFunc(hex.DiscAt(home, pinPath), func(h hex.Hex) bool { return hex.Distance(home, h) < terrainFarLeast })
		}
		// A console offers only a free, passable tile to stand a pin on;
		// its ring and everything past the tile are the validator's.
		free := slices.DeleteFunc(around, func(h hex.Hex) bool {
			tb := w.g.Baseline(h)
			return tb.Site != "" || tb.Landmark != "" || !w.g.Passable(tb.Terrain)
		})
		if len(free) == 0 {
			continue
		}
		at := free[d.Below(uint64(len(free)), terrainDraw, parts("tile")...)]
		ter := w.b.Terrain[d.Below(uint64(len(w.b.Terrain)), terrainDraw, parts("terrain")...)].ID
		fix := tile.Fix{Ground: &tile.GroundFix{Terrain: ter, Ring: d.Below(2, terrainDraw, parts("ring")...) == 0}}
		if d.Below(terrainLiftIn, terrainDraw, parts("lift")...) == 0 {
			fix.Ground.Elevation = d.Between(1, w.g.ElevationMax(), terrainDraw, parts("elevation")...)
		}
		if d.Below(terrainSlotIn, terrainDraw, parts("slot")...) == 0 {
			fix.Site = gen.SiteOrdinary
		}
		reach := d.Between(1, limits[role].ReachMax, terrainDraw, parts("reach")...)

		out.tried[role]++
		before, err := world.Digest(w.s, w.log)
		if err != nil {
			return err
		}
		p, err := w.s.Reserve(w.log, at, reach, fix, by)
		if err != nil {
			if err := tallyRefusal(out.codes, err); err != nil {
				return err
			}
			after, err := world.Digest(w.s, w.log)
			if err != nil {
				return err
			}
			out.refusedDigested++
			if after == before {
				out.refusedSame++
			} else {
				out.bad = append(out.bad, fmt.Sprintf("seed %d: a refused pin on %s changed the world", w.seed, at.Ref()))
			}
			continue
		}
		out.accepted[role]++
		if fix.Ground.Ring {
			out.rings++
		}
		if fix.Site != "" {
			out.slots++
		}
		if fix.Ground.Elevation > 0 {
			out.lifts++
		}
		w.pins = append(w.pins, *p)

		// Land the patch, and reach the scaffold's slots round it that a
		// settlement walks to, so their drawn entrances are checked too.
		var acts []world.Action
		for _, h := range terrainPatch(*p) {
			acts = append(acts, world.Action{Kind: world.ActDiscover, Hex: h, By: who})
		}
		for _, h := range hex.DiscAt(p.At, check) {
			i := w.area.Index(h)
			if i < 0 || h.Len() > spikeEOut || w.pure[i].Site == "" || w.s.Content(h) != nil || !w.joinedHome(w.pureLabel, i) {
				continue
			}
			acts = append(acts, world.Action{Kind: world.ActDiscover, Hex: h, By: who})
		}
		if _, _, err := world.Advance(w.s, w.log, acts, w.s.Tick+1); err != nil {
			return err
		}
		if _, _, err := world.Advance(w.twin, w.tlog, acts, w.twin.Tick+1); err != nil {
			return err
		}
	}
	return nil
}

// terrainPatch is the tiles a terrain pin's ground covers.
func terrainPatch(p world.Pin) []hex.Hex {
	if !p.Fix.Ground.Ring {
		return []hex.Hex{p.At}
	}
	return append([]hex.Hex{p.At}, hex.Ring(p.At, 1)...)
}

// joinedHome reports whether tile i shares a label with a settlement.
func (w *terrainWorld) joinedHome(label []int, i int) bool {
	return label[i] >= 0 && slices.ContainsFunc(w.homes, func(h int) bool { return label[h] == label[i] })
}

// breaks notes a broken target on a tile.
type breaks func(h hex.Hex, f string, a ...any)

func (w *terrainWorld) breaks(out *terrainResult) breaks {
	return func(h hex.Hex, f string, a ...any) {
		out.bad = append(out.bad, fmt.Sprintf("seed %d %s: %s", w.seed, h.Ref(), fmt.Sprintf(f, a...)))
	}
}

// check holds the landed pins to the World targets.
func (w *terrainWorld) check(out *terrainResult) error {
	bad := w.breaks(out)
	for _, p := range w.pins {
		w.landed(p, out, bad)
	}
	over := w.ground(out, bad)
	w.reach(over, out, bad)
	if err := w.twinContent(out, bad); err != nil {
		return err
	}
	return w.chunkOrder(out, bad)
}

// patches is every accepted pin's ground by tile.
func (w *terrainWorld) patches() map[hex.Hex]gen.Ground {
	out := map[hex.Hex]gen.Ground{}
	for _, p := range w.pins {
		for _, h := range terrainPatch(p) {
			out[h] = gen.Ground{Terrain: p.Fix.Ground.Terrain, Elevation: p.Fix.Ground.Elevation}
		}
	}
	return out
}

// ground reads the disc as the world does: off the patches every tile
// must read the pure scaffold, and on them the scaffold with the pin's
// ground laid over it.
func (w *terrainWorld) ground(out *terrainResult, bad breaks) []gen.TileBaseline {
	patches := w.patches()
	out.patchTiles = len(patches)
	over := make([]gen.TileBaseline, len(w.pure))
	for i, pure := range w.pure {
		h := pure.Hex
		over[i] = w.s.Baseline(h)
		out.tiles++
		if gr, on := patches[h]; on {
			if want := w.g.GroundTile(h, gr); over[i] != want {
				bad(h, "reads %+v under its ground, not %+v", over[i], want)
			}
			continue
		}
		if over[i] != pure {
			bad(h, "off every patch, reads %+v, not the scaffold's %+v", over[i], pure)
		}
	}
	for _, h := range slices.SortedFunc(maps.Keys(patches), hex.Compare) {
		if w.area.Index(h) < 0 {
			bad(h, "a patch tile outside the walked disc")
		}
	}
	return over
}

// reach walks the disc over ground: every starting settlement and pattern
// point the pure scaffold joins to a settlement stays joined to it, and
// every pinned slot or drawn entrance joins one. Passability is the same
// both ways, so one labelling answers a walk from every settlement.
func (w *terrainWorld) reach(over []gen.TileBaseline, out *terrainResult, bad breaks) {
	overLabel := areaLabels(w.g, w.area, over)
	targets := slices.Clone(w.homes)
	out.homes += len(w.homes)
	for _, pt := range w.area.Points {
		if pt.Hex.Len() <= spikeEOut {
			targets = append(targets, w.area.Index(pt.Hex))
			out.points++
		}
	}
	slots := map[int]bool{}
	for _, t := range w.s.Tiles {
		if c := t.Content; c != nil && t.Hex.Len() <= spikeEOut && (c.Site != "" || (c.Dungeon != nil && !c.Native)) {
			if i := w.area.Index(t.Hex); i >= 0 && !slots[i] {
				slots[i] = true
				targets = append(targets, i)
				out.slotsChecked++
			}
		}
	}
	for _, x := range targets {
		parted, joined := 0, false
		for _, hi := range w.homes {
			oj := overLabel[x] >= 0 && overLabel[x] == overLabel[hi]
			if w.pureLabel[x] >= 0 && w.pureLabel[x] == w.pureLabel[hi] && !oj {
				parted++
			}
			joined = joined || oj
		}
		switch {
		case parted > 0:
			bad(w.pure[x].Hex, "the pins part it from %d starting settlements the scaffold joins it to", parted)
		case !joined && slots[x]:
			bad(w.pure[x].Hex, "a slot or entrance no starting settlement walks to")
		case !joined:
			out.scaffoldApart++
		}
	}
}

// landed checks a pin's patch stored its ground, and its own tile the pin.
func (w *terrainWorld) landed(p world.Pin, out *terrainResult, bad breaks) {
	ok := true
	for _, h := range terrainPatch(p) {
		c := w.s.Content(h)
		if c == nil || c.Ground == nil || c.Ground.Terrain != p.Fix.Ground.Terrain || c.Ground.Elevation != p.Fix.Ground.Elevation || c.Pin != p.ID {
			bad(h, "%s's ground did not land: %+v", p.ID, c)
			ok = false
		}
	}
	if c := w.s.Content(p.At); c != nil && p.Fix.Site != "" && c.Site != p.Fix.Site {
		bad(p.At, "%s fixed slot %q, the tile holds %q", p.ID, p.Fix.Site, c.Site)
		ok = false
	}
	if ok {
		out.landed++
	}
}

// twinContent compares every reached tile's content with the pinless
// twin's: the same off every pin's reach, the same digest apart from its
// pins inside it, and the patches left to landed.
func (w *terrainWorld) twinContent(out *terrainResult, bad breaks) error {
	ground := w.patches()
	reached := map[hex.Hex]bool{}
	for _, t := range w.s.Tiles {
		c := t.Content
		if c == nil {
			continue
		}
		reached[t.Hex] = true
		if _, on := ground[t.Hex]; on {
			continue
		}
		twin := w.twin.Content(t.Hex)
		covered := false
		for _, p := range w.pins {
			if hex.Distance(p.At, t.Hex) <= p.Reach && (p.By.Region == nil || w.g.RegionOf(t.Hex) == *p.By.Region) && p.Tick < c.Drawn {
				covered = true
			}
		}
		if covered {
			out.inReach++
			if why := onlyPins(c, twin, w.pins); why != "" {
				bad(t.Hex, "in a pin's reach: %s", why)
			}
			continue
		}
		out.compared++
		if twin == nil {
			bad(t.Hex, "reached only with pins")
			continue
		}
		a, err := canon.Digest(c)
		if err != nil {
			return err
		}
		b, err := canon.Digest(twin)
		if err != nil {
			return err
		}
		if a != b {
			bad(t.Hex, "outside every pin's reach, its content differs from the pinless twin's")
		}
	}
	for _, t := range w.twin.Tiles {
		if t.Content != nil && !reached[t.Hex] {
			bad(t.Hex, "reached only without pins")
		}
	}
	return nil
}

// chunkOrder is spike E's chunk-order digest of the pinned world's Gen:
// every chunk must match the twin's Gen generating them in order and a
// fresh Gen generating them in reverse. The first spikeEOrderAll seeds
// compare every chunk of the disc; the rest the chunks round each pin
// and spikeEOrderPick drawn others.
func (w *terrainWorld) chunkOrder(out *terrainResult, bad breaks) error {
	all := chunksIn(w.g, spikeEOut+spikeEMargin)
	cs := all
	if w.seed >= spikeEOrderAll {
		near := map[gen.ChunkCoord]bool{}
		for _, p := range w.pins {
			for _, h := range hex.DiscAt(p.At, 2*w.g.ChunkRadius()) {
				near[w.g.ChunkOf(h)] = true
			}
		}
		d := draw.NewDrawer(w.keys.Roll)
		order := d.Shuffle(len(all), terrainDraw, draw.Int(int64(w.seed)), draw.Str("chunks"))
		for _, k := range order[:min(spikeEOrderPick, len(order))] {
			near[all[k]] = true
		}
		cs = slices.SortedFunc(maps.Keys(near), compareChunks)
	}
	fresh, err := gen.New(w.b, w.keys.Generation)
	if err != nil {
		return err
	}
	sum := func(g *gen.Gen, cc gen.ChunkCoord) (canon.Sum, error) { return canon.Digest(g.Chunk(cc)) }
	want := make([]canon.Sum, len(cs))
	for i, cc := range cs {
		if want[i], err = sum(w.g, cc); err != nil {
			return err
		}
	}
	for i, cc := range cs {
		got, err := sum(w.tg, cc)
		if err != nil {
			return err
		}
		if got != want[i] {
			bad(w.g.ChunkCentre(cc), "chunk %v differs from the pinless twin's, generated in order", cc)
		}
	}
	for i := len(cs) - 1; i >= 0; i-- {
		got, err := sum(fresh, cs[i])
		if err != nil {
			return err
		}
		if got != want[i] {
			bad(w.g.ChunkCentre(cs[i]), "chunk %v differs from a fresh Gen's, generated in reverse", cs[i])
		}
	}
	out.chunks = len(cs)
	return nil
}

func compareChunks(a, b gen.ChunkCoord) int {
	return cmp.Or(cmp.Compare(a.A, b.A), cmp.Compare(a.B, b.B))
}

// areaLabels labels each passable tile of the area by what joins it there,
// and the rest -1.
func areaLabels(g *gen.Gen, a *gen.Area, tiles []gen.TileBaseline) []int {
	label := make([]int, len(tiles))
	for i := range label {
		label[i] = -1
	}
	for i := range tiles {
		if label[i] >= 0 || !g.Passable(tiles[i].Terrain) {
			continue
		}
		label[i] = i
		queue := []int{i}
		for len(queue) > 0 {
			k := queue[0]
			queue = queue[1:]
			for _, n := range tiles[k].Hex.Neighbours() {
				if j := a.Index(n); j >= 0 && label[j] < 0 && g.Passable(tiles[j].Terrain) {
					label[j] = i
					queue = append(queue, j)
				}
			}
		}
	}
	return label
}

// writeTerrain writes the report and the target's reading.
func writeTerrain(p func(string, ...any), b *sheets.Book, rs []terrainResult) Measured {
	var (
		tried, accepted                           = map[string]int{}, map[string]int{}
		codes                                     = map[string]int{}
		rings, slots, lifts, landed, patchTiles   int
		tiles, compared, inReach, chunks, refused int
		homes, points, slotsChecked, apart, same  int
		bad                                       []string
		allTried, allAccepted, worldGuard, seeds  int
	)
	for _, r := range rs {
		sumCodes(tried, r.tried)
		sumCodes(accepted, r.accepted)
		sumCodes(codes, r.codes)
		rings, slots, lifts, landed, patchTiles = rings+r.rings, slots+r.slots, lifts+r.lifts, landed+r.landed, patchTiles+r.patchTiles
		tiles, compared, inReach, chunks = tiles+r.tiles, compared+r.compared, inReach+r.inReach, chunks+r.chunks
		homes, points, slotsChecked, apart = homes+r.homes, points+r.points, slotsChecked+r.slotsChecked, apart+r.scaffoldApart
		refused, same = refused+r.refusedDigested, same+r.refusedSame
		bad = append(bad, r.bad...)
		seeds++
	}
	allTried, allAccepted = total(tried), total(accepted)
	worldGuard = codes[world.CodePinWorld]
	if worldGuard > 0 {
		bad = append(bad, fmt.Sprintf("the pin-world guard fired %d times", worldGuard))
	}
	ok := len(bad) == 0 && allAccepted > 0 && landed == allAccepted
	text := ""
	for _, t := range b.Targets {
		if t.ID == "terrain-pins-hold" {
			text = t.Text
		}
	}
	value := fmt.Sprintf("%s of %s pins accepted on %d seeds, %d landed (refused: %s); %d broke a target", comma(int64(allAccepted)), comma(int64(allTried)), seeds, landed, codeList(codes), len(bad))

	p("# Terrain run")
	p("")
	p("Terrain pins (GDD 14.4) on %d seeds under throwaway keys `terrain-<seed>`. Each seed tries %d pins drawn under `%s`: a designer's on a tile %d to `pin-path-tiles` steps from one of the first %d starting settlements, or an admin's anywhere in that settlement's region, of its own server, the tile drawn among those holding no slot or landmark on passable ground, as a console offers; a `map.terrain` row, with its ring half the time, an elevation 1 time in %d and an ordinary slot 1 time in %d; a reach up to the role's. Every pin goes through `world.State.Reserve`, whose validator re-lays the touched chunks and refuses what would move a corridor or part the ground. A refusal must leave the world's digest as it was. An accepted pin is landed at once by reaching its patch, and with it every scaffold slot within `ground-check-tiles` that a settlement walks to.", seeds, terrainPins, terrainDraw, terrainFarLeast, terrainHomes, terrainLiftIn, terrainSlotIn)
	p("")
	p("A pinless twin of each world, under the same key, takes the same reaches. Then, over the disc of radius %d round the origin (targets within %d):", spikeEOut+spikeEMargin, spikeEOut)
	p("")
	p("- **ground**: every tile off the patches reads (`World.Baseline`) the pure scaffold the disc held before any pin, and every patch tile the scaffold with the pin's ground over it;")
	p("- **reachability**: an overlay-aware walk joins every starting settlement and pattern point the pure scaffold joins to a starting settlement, from every one of them, and every pinned slot and drawn entrance joins one;")
	p("- **content**: every reached tile off the patches stores what the twin stores, or, inside a pin made before its draw, the same digest apart from its pins;")
	p("- **chunk order**: spike E's chunk digests of the pinned world's Gen match the twin's Gen generating them in order (after its own reaches) and a fresh Gen generating them in reverse (every chunk of the disc on the first %d seeds, then the chunks round each pin and %d drawn others).", spikeEOrderAll, spikeEOrderPick)
	p("")
	p("| Target | Reading | Holds |")
	p("| --- | --- | --- |")
	p("| %s | %s | %s |", cmp.Or(text, "terrain-pins-hold"), value, holds(ok))
	p("")
	p("## Pins")
	p("")
	p("| Role | Tried | Accepted |")
	p("| --- | --- | --- |")
	for _, role := range terrainRoles {
		p("| %s | %s | %s |", role, comma(int64(tried[role])), comma(int64(accepted[role])))
	}
	p("")
	p("Accepted with a ring %s, with a slot %s, with an elevation %s; %s patch tiles landed. %s refusals left the world's digest as it was, of %s.", comma(int64(rings)), comma(int64(slots)), comma(int64(lifts)), comma(int64(patchTiles)), comma(int64(same)), comma(int64(refused)))
	p("")
	p("| Refused | Pins |")
	p("| --- | --- |")
	for _, c := range slices.Sorted(maps.Keys(codes)) {
		p("| `%s` | %s |", c, comma(int64(codes[c])))
	}
	p("")
	p("## Checks")
	p("")
	p("| Check | Compared |")
	p("| --- | --- |")
	p("| Ground tiles | %s |", comma(int64(tiles)))
	p("| Starting settlements, pattern points, pinned slots and drawn entrances | %s, %s, %s |", comma(int64(homes)), comma(int64(points)), comma(int64(slotsChecked)))
	p("| Targets the pure scaffold joins to no settlement (left to the World run) | %s |", comma(int64(apart)))
	p("| Reached tiles off every pin's reach, and inside one | %s, %s |", comma(int64(compared)), comma(int64(inReach)))
	p("| Chunks, in each of two orders | %s |", comma(int64(chunks)))
	listBad(p, "Broken", bad)
	if len(bad) == 0 {
		p("")
		p("Nothing broke.")
	}
	return Measured{Target: "terrain-pins-hold", Value: value, Holds: ok}
}

// codeList is refusal counts as "code n, …", by code.
func codeList(codes map[string]int) string {
	if len(codes) == 0 {
		return "none"
	}
	var out string
	for i, c := range slices.Sorted(maps.Keys(codes)) {
		if i > 0 {
			out += ", "
		}
		out += fmt.Sprintf("%s %d", c, codes[c])
	}
	return out
}
