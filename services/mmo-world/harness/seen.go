package harness

import (
	"fmt"
	"io"
	"maps"
	"os"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/history"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// The seen run (GDD 4.17): whether a record per server of the finds its
// characters have seen, in place of the world's, could steer content per
// server while a pin still changes no tile outside its reach. It plays the
// content run's histories with walkers of two servers, A and B, and draws
// every first-reached tile three ways with the pure gen.Content: on the
// world's record, on A's and on B's. Nothing in the sim changes.

func init() { Runs["seen"] = SeenRun }

const (
	// seenWalkers walk out from the first seenWalkers settlements, the
	// first being the history's own explorer; even walkers are A's, odd B's.
	seenWalkers = 4
	seenPairs   = 200 // same-tick pairs placed per history and seed, at most
	novelLeast  = 3   // a server's novelty must be at least 1 region in this many, in every band
	// seenBand is the world's novelty band (GDD 4.17), in tiles.
	seenBand = 40
)

// seenServers are the two servers' names, by walker parity.
var seenServers = [2]string{"A", "B"}

// heldFind is one thing a region holds that a record may not have seen.
type heldFind struct{ kind, key string }

// seenFind is a find as a record keeps it: where it was first seen and when.
type seenFind struct {
	kind string
	tick int64
}

// novel counts a band's regions entered and those holding something new.
type novel struct{ regions, novel int }

// record is a record of first sights: the world's, or one server's.
type record struct {
	keys     map[string]gen.LatticeID
	ticks    map[string]int64
	entered  map[gen.LatticeID]bool
	byRegion map[gen.LatticeID][]seenFind
	bands    map[int64]*novel
}

func newRecord() *record {
	return &record{keys: map[string]gen.LatticeID{}, ticks: map[string]int64{}, entered: map[gen.LatticeID]bool{},
		byRegion: map[gen.LatticeID][]seenFind{}, bands: map[int64]*novel{}}
}

// see enters a region into the record at tick, as the world's finds do
// when a region is first discovered.
func (r *record) see(g *gen.Gen, held []heldFind, id gen.LatticeID, tick int64) {
	if r.entered[id] {
		return
	}
	r.entered[id] = true
	band := g.Region(id).Distance / seenBand * seenBand
	n := r.bands[band]
	if n == nil {
		n = &novel{}
		r.bands[band] = n
	}
	n.regions++
	news := false
	for _, f := range held {
		if _, ok := r.keys[f.key]; ok {
			continue
		}
		r.keys[f.key], r.ticks[f.key] = id, tick
		r.byRegion[id] = append(r.byRegion[id], seenFind{kind: f.kind, tick: tick})
		news = true
	}
	if news {
		n.novel++
	}
}

// tally is the record's finds in the regions round h seen before t, as a
// digest counts the world's, and how many entries it read.
func (r *record) tally(reach []gen.LatticeID, t, most int64) ([]history.Count, int64) {
	found := map[string]int64{}
	var read int64
	for _, id := range reach {
		for _, f := range r.byRegion[id] {
			read++
			if f.tick < t {
				found[f.kind]++
			}
		}
	}
	return history.Tally(found, most), read
}

// reachOf are the regions touching the disc a digest reads round h.
func reachOf(g *gen.Gen, h hex.Hex, radius int64) []gen.LatticeID {
	var out []gen.LatticeID
	for _, at := range hex.DiscAt(h, radius) {
		if id := g.RegionOf(at); !slices.Contains(out, id) {
			out = append(out, id)
		}
	}
	slices.SortFunc(out, gen.CompareIDs)
	return out
}

// heldIn is what a region holds that counts as a find, in the order the
// world records them: far and edge materials, variants, edge creatures,
// biome variants and patterns, all read from the pure scaffold.
func heldIn(g *gen.Gen, id gen.LatticeID) []heldFind {
	base := g.Region(id)
	var out []heldFind
	if base.Far != nil {
		out = append(out, heldFind{"far-material", "far-material:" + base.Far.ID})
	}
	if base.EdgeMaterial != nil {
		out = append(out, heldFind{"edge-material", "edge-material:" + base.EdgeMaterial.ID})
	}
	if base.Variant != "" {
		out = append(out, heldFind{"variant", "variant:" + base.Creature + "." + base.Variant})
	}
	if base.EdgeCreature != "" {
		out = append(out, heldFind{"edge-creature", "edge-creature:" + base.EdgeCreature + "." + base.Edge})
	}
	tiles := g.RegionTiles(id)
	for _, h := range tiles {
		if v := g.Baseline(h).Variant; v != "" {
			out = append(out, heldFind{"biome-variant", "biome-variant:" + v})
		}
	}
	var chunks []gen.ChunkCoord
	for _, h := range tiles {
		if cc := g.ChunkOf(h); !slices.Contains(chunks, cc) {
			chunks = append(chunks, cc)
		}
	}
	var patterns []string
	for _, cc := range chunks {
		for _, p := range g.Chunk(cc).Points {
			if g.RegionOf(p.Hex) == id && !slices.Contains(patterns, p.Instance) {
				patterns = append(patterns, p.Instance)
			}
		}
	}
	slices.Sort(patterns)
	for _, p := range patterns {
		out = append(out, heldFind{"pattern", "pattern:" + p})
	}
	return out
}

// seenVisit is one walker's arrival on a tile.
type seenVisit struct {
	server int
	at     hex.Hex
	tick   int64
}

// seenPlay is a content history walked by seenWalkers walkers.
type seenPlay struct {
	h        *historyRun
	walkers  []*Explorer
	server   map[string]int // walker character id to server
	founding []gen.LatticeID
	visits   []seenVisit
	held     map[gen.LatticeID][]heldFind
}

func newSeenPlay(h *historyRun) *seenPlay {
	p := &seenPlay{h: h, server: map[string]int{}, held: map[gen.LatticeID][]heldFind{}}
	for i := range seenWalkers {
		w := h.ex
		if i > 0 {
			w = NewExplorer(h.g.Settlement(i).Hex, explorerRadius)
		}
		w.Who = fact.Ref{Kind: "character", ID: fmt.Sprintf("c-walker-%d", i)}
		p.server[w.Who.ID] = i % len(seenServers)
		p.walkers = append(p.walkers, w)
	}
	for _, r := range h.s.Regions {
		if r.Discovered {
			p.founding = append(p.founding, r.Lattice)
		}
	}
	return p
}

// days plays n world days as historyRun.days does, every walker walking
// in turn from historyStillDays, the explorer's pins ahead of the first.
func (p *seenPlay) days(n int, before func(*seenPlay) error) error {
	h := p.h
	for range n {
		if before != nil {
			if err := before(p); err != nil {
				return err
			}
		}
		var acts []world.Action
		if day := h.s.Day; day >= historyStillDays {
			if h.pins && (day-historyStillDays)%pinEvery == 0 {
				if err := h.pin(); err != nil {
					return err
				}
			}
			for i, w := range p.walkers {
				for _, a := range w.Day(h.s, explorerPerDay) {
					if a.Kind == world.ActVisit {
						p.visits = append(p.visits, seenVisit{server: i % len(seenServers), at: a.Hex, tick: h.s.Tick + 1})
					}
					acts = append(acts, a)
				}
			}
		}
		if err := h.s.AdvanceDayWith(h.log, acts); err != nil {
			return fmt.Errorf("seen %s seed %d day %d: %w", h.name, h.seed, h.s.Day, err)
		}
	}
	return nil
}

func (p *seenPlay) heldIn(id gen.LatticeID) []heldFind {
	if f, ok := p.held[id]; ok {
		return f
	}
	f := heldIn(p.h.g, id)
	p.held[id] = f
	return f
}

// pinTouched reports whether a visit to h at tick may carry a pin's
// effect: its content was fixed or grounded by a pin, its digest read one,
// or a pin made before the visit covers it.
func pinTouched(c *tile.Content, pins []world.Pin, h hex.Hex, tick int64) bool {
	if c == nil || c.Pin != "" || c.Ground != nil || (c.Digest != nil && len(c.Digest.Pins) > 0) {
		return true
	}
	for _, pin := range pins {
		if pin.Tick < tick && pinCovers(pin, h) {
			return true
		}
	}
	return false
}

// pinCovers is a pin's reach, its ground's ring included.
func pinCovers(p world.Pin, h hex.Hex) bool {
	reach := p.Reach
	if p.Fix.Ground != nil && p.Fix.Ground.Ring {
		reach = max(reach, 1)
	}
	return hex.Distance(p.At, h) <= reach
}

// records are the world's record (every walker, nothing left out) and
// each server's (its own walkers, leaving out every pin-touched visit),
// from the founding and the visits up to the state's tick.
func (p *seenPlay) records(s *world.State) (*record, [2]*record) {
	w := newRecord()
	var own [2]*record
	for i := range own {
		own[i] = newRecord()
	}
	for _, id := range p.founding {
		w.see(p.h.g, p.heldIn(id), id, 0)
		for _, r := range own {
			r.see(p.h.g, p.heldIn(id), id, 0)
		}
	}
	for _, v := range p.visits {
		if v.tick > s.Tick {
			break
		}
		id := p.h.g.RegionOf(v.at)
		w.see(p.h.g, p.heldIn(id), id, v.tick)
		if !pinTouched(s.Content(v.at), p.h.pinsP, v.at, v.tick) {
			own[v.server].see(p.h.g, p.heldIn(id), id, v.tick)
		}
	}
	return w, own
}

// seenDraw is one tile drawn on each server's record.
type seenDraw struct {
	keys  [2]string
	draws [2]*tile.Content
}

// seenResult is what one history and seed showed.
type seenResult struct {
	name string
	seed int

	steer             [2]struct{ tiles, recordDiffers, differ int }
	bands             [2]map[int64]novel
	abTiles, abDiffer int // tiles with a field drawn on A's or B's record, and those whose fields differ
	abKey             int // tiles whose A and B record digests differ
	excluded          int // tiles a pin fixed or grounded, drawn by the pin, not a record
	pairs, pairsSame  int
	natural, natSame  int
	finds             [3]int // in the world's, A's and B's record at the end
	tiles             int
	bad               []string // where the run's world record is not the world's

	// For the pinned history against its pinless twin.
	pins, outside, outsideKey, outsideFields, outsideWorld int
}

// drawnOf is a draw as a tile keeps its drawn fields.
func drawnOf(d gen.Drawn) *tile.Content {
	c := &tile.Content{SiteKind: d.SiteKind, Lead: d.Lead, Stock: d.Stock}
	if d.Dungeon != nil {
		c.Dungeon = &tile.Plan{Kind: d.Dungeon.Kind, Floors: d.Dungeon.Floors}
	}
	return c
}

// analyse draws every tile the walkers first reached on the world's
// record and each server's, and checks that the run's world record is the
// world's own: the same finds, novelty and digests.
func (p *seenPlay) analyse(out *seenResult) map[hex.Hex]seenDraw {
	h := p.h
	g, s := h.g, h.s
	bounds := history.BoundsOf(h.b.MapParams)
	w, own := p.records(s)
	bad := func(f string, a ...any) {
		out.bad = append(out.bad, fmt.Sprintf("%s seed %d: ", h.name, h.seed)+fmt.Sprintf(f, a...))
	}

	worldFinds := map[string]world.Find{}
	for _, f := range s.Finds {
		worldFinds[f.Key] = f
	}
	for key, region := range w.keys {
		f, ok := worldFinds[key]
		if !ok || f.Region != region || f.Tick != w.ticks[key] {
			bad("find %s: the run records %v at %d, the world %+v", key, region, w.ticks[key], f)
		}
	}
	if len(worldFinds) != len(w.keys) {
		bad("the world holds %d finds, the run's world record %d", len(worldFinds), len(w.keys))
	}
	for _, n := range s.Novelty {
		if got := w.bands[n.Band]; got == nil || got.regions != n.Regions || got.novel != n.Novel {
			bad("band %d: the world counts %d regions, %d novel; the run %+v", n.Band, n.Regions, n.Novel, got)
		}
	}
	out.finds = [3]int{len(w.keys), len(own[0].keys), len(own[1].keys)}
	for i, r := range own {
		out.bands[i] = map[int64]novel{}
		for band, n := range r.bands {
			out.bands[i][band] = *n
		}
	}

	draws := map[hex.Hex]seenDraw{}
	for _, t := range h.reached() {
		c := t.Content
		if c.Native {
			continue
		}
		out.tiles++
		if c.Pin != "" || c.Ground != nil {
			out.excluded++
			continue
		}
		if c.Digest == nil || t.Discovered == nil {
			bad("%s holds content with no digest or discoverer", t.Hex.Ref())
			continue
		}
		reach := reachOf(g, t.Hex, bounds.Radius)
		if tw, _ := w.tally(reach, c.Drawn, bounds.KindMost); !slices.Equal(tw, c.Digest.Finds) {
			bad("%s: the world's digest counts finds %v, the run's world record %v", t.Hex.Ref(), c.Digest.Finds, tw)
		}
		site := g.Baseline(t.Hex).Site
		dw := *c.Digest
		onWorld := drawnOf(g.Content(t.Hex, site, dw, dw.Key()))
		if dw.Key() != c.Key || drawnDiffer(onWorld, c) {
			bad("%s: the world record's draw is not the stored one", t.Hex.Ref())
		}
		var sd seenDraw
		for i, r := range own {
			d := dw
			d.Finds, _ = r.tally(reach, c.Drawn, bounds.KindMost)
			sd.keys[i] = d.Key()
			sd.draws[i] = drawnOf(g.Content(t.Hex, site, d, sd.keys[i]))
		}
		draws[t.Hex] = sd
		if x, ok := p.server[t.Discovered.By.ID]; ok {
			st := &out.steer[x]
			if drawnFields(onWorld) > 0 || drawnFields(sd.draws[x]) > 0 {
				st.tiles++
				if sd.keys[x] != c.Key {
					st.recordDiffers++
				}
				if drawnDiffer(onWorld, sd.draws[x]) {
					st.differ++
				}
			}
		}
		if sd.keys[0] != sd.keys[1] {
			out.abKey++
		}
		if drawnFields(sd.draws[0]) > 0 || drawnFields(sd.draws[1]) > 0 {
			out.abTiles++
			if drawnDiffer(sd.draws[0], sd.draws[1]) {
				out.abDiffer++
			}
		}
	}

	// Two commands reaching a tile in one tick: the single writer draws
	// once, on the first command's server's record, so the draw is the same
	// in either order only if both records give the same key.
	cand := slices.SortedFunc(maps.Keys(draws), hex.Compare)
	seed := draw.Int(int64(h.seed))
	for _, i := range h.d.Shuffle(len(cand), "harness.seen", seed, draw.Str(h.name)) {
		if out.pairs == seenPairs {
			break
		}
		out.pairs++
		if d := draws[cand[i]]; d.keys[0] == d.keys[1] {
			out.pairsSame++
		}
	}
	type at struct {
		h    hex.Hex
		tick int64
	}
	by := map[at][2]bool{}
	for _, v := range p.visits {
		k := at{v.at, v.tick}
		b := by[k]
		b[v.server] = true
		by[k] = b
	}
	for k, b := range by {
		c := s.Content(k.h)
		d, ok := draws[k.h]
		if !b[0] || !b[1] || !ok || c.Drawn != k.tick {
			continue
		}
		out.natural++
		if d.keys[0] == d.keys[1] {
			out.natSame++
		}
	}
	return draws
}

// playSeen plays one history and seed with its walkers to the end.
func playSeen(b *sheets.Book, name string, seed int, pins bool) (*seenPlay, error) {
	h, err := newHistory(b, name, seed, pins)
	if err != nil {
		return nil, err
	}
	p := newSeenPlay(h)
	if err := p.days(historyLength, nil); err != nil {
		return nil, err
	}
	return p, nil
}

func seenHistory(b *sheets.Book, name string, seed int) (seenResult, error) {
	out := seenResult{name: name, seed: seed}
	pinned := name == historyPinned
	p, err := playSeen(b, name, seed, pinned)
	if err != nil {
		return out, err
	}
	draws := p.analyse(&out)
	if !pinned {
		return out, nil
	}
	bare, err := playSeen(b, name, seed, false)
	if err != nil {
		return out, err
	}
	var twin seenResult
	bareDraws := bare.analyse(&twin)
	out.bad = append(out.bad, twin.bad...)
	out.pins = len(p.h.pinsP)
	for _, h := range slices.SortedFunc(maps.Keys(draws), hex.Compare) {
		if slices.ContainsFunc(p.h.pinsP, func(pin world.Pin) bool { return pinCovers(pin, h) }) {
			continue
		}
		q, ok := bareDraws[h]
		if !ok {
			out.bad = append(out.bad, fmt.Sprintf("pinned seed %d %s: reached only with pins", seed, h.Ref()))
			continue
		}
		d := draws[h]
		out.outside++
		if d.keys != q.keys {
			out.outsideKey++
		}
		if drawnDiffer(d.draws[0], q.draws[0]) || drawnDiffer(d.draws[1], q.draws[1]) {
			out.outsideFields++
		}
		if p.h.s.Content(h).Key != bare.h.s.Content(h).Key {
			out.outsideWorld++
		}
	}
	return out, nil
}

// seenCostResult is the cost reading: a draw on the world's record and on
// a server's, day 1 against day busyDays.
type seenCostResult struct {
	tiles                     int
	world1, world300          time.Duration
	own1, own300              time.Duration
	visits1, visits300        int64 // most a digest and the record read
	read1, read300            int64 // most record entries read
	bound                     int64
	findsDay1, findsDayBusy   int
	recordDay1, recordDayBusy int
}

// seenCost is busyCost's busy world walked by the seen run's walkers, its
// sample round the first walker's last stand: on every sample tile still
// unreached, DigestAt plus gen.Content is timed on the world's record and
// with server A's record in its place, day 1 against day busyDays, the two
// days in turn tile by tile.
func seenCost(b *sheets.Book) (seenCostResult, error) {
	var out seenCostResult
	h, err := newHistory(warringBook(b), "busy", 0, false)
	if err != nil {
		return out, err
	}
	p := newSeenPlay(h)
	tail := &fact.Tail{}
	h.log = tail
	last := h.ex.steps[min(len(h.ex.steps)-1, (busyDays-historyStillDays)*explorerPerDay)]
	spread := int64(0)
	for hex.DiscSize(spread) < busyTiles {
		spread++
	}
	bounds := history.BoundsOf(b.MapParams)
	// Round where the first walker stands on the last day, so the regions
	// a still unreached sample tile reads are ones A's record has entered.
	sample := hex.DiscAt(last, spread)[:busyTiles]
	area := hex.DiscAt(last, spread+bounds.Radius)
	kinds := []string{"faction.raided", "region.surge"}
	inject := func(p *seenPlay) error {
		tail.Flush()
		day := draw.Int(p.h.s.Day)
		for i := range busyFacts {
			at := area[p.h.d.Below(uint64(len(area)), "harness.busy", day, draw.Int(int64(i)))]
			if err := p.h.note(kinds[i%len(kinds)], at); err != nil {
				return err
			}
		}
		return nil
	}
	if err := p.days(1, inject); err != nil {
		return out, err
	}
	first, err := h.state()
	if err != nil {
		return out, err
	}
	w1, own1 := p.records(first)
	if err := p.days(busyDays-1, inject); err != nil {
		return out, err
	}
	tail.Flush()
	w300, own300 := p.records(h.s)
	out.findsDay1, out.findsDayBusy = len(w1.keys), len(w300.keys)
	out.recordDay1, out.recordDayBusy = len(own1[0].keys), len(own300[0].keys)
	out.bound = bounds.CostBound()
	states := []*world.State{first, h.s}
	recs := []*record{own1[0], own300[0]}
	var worlds, owns [2][]time.Duration
	for _, t := range sample {
		if first.Content(t) != nil || h.s.Content(t) != nil {
			continue
		}
		out.tiles++
		site := h.g.Baseline(t).Site
		var bestWorld, bestOwn [2]time.Duration
		for range busyRounds {
			for i, st := range states {
				now := st.Tick + 1
				start := time.Now()
				d := st.DigestAt(t, now)
				_ = h.g.Content(t, site, d, d.Key())
				if el := time.Since(start); bestWorld[i] == 0 || el < bestWorld[i] {
					bestWorld[i] = el
				}
				start = time.Now()
				d = st.DigestAt(t, now)
				d.Finds, _ = recs[i].tally(reachOf(h.g, t, bounds.Radius), now, bounds.KindMost)
				_ = h.g.Content(t, site, d, d.Key())
				if el := time.Since(start); bestOwn[i] == 0 || el < bestOwn[i] {
					bestOwn[i] = el
				}
			}
		}
		for i, st := range states {
			worlds[i], owns[i] = append(worlds[i], bestWorld[i]), append(owns[i], bestOwn[i])
			_, cost := st.DigestCost(t, st.Tick+1)
			_, read := recs[i].tally(reachOf(h.g, t, bounds.Radius), st.Tick+1, bounds.KindMost)
			if i == 0 {
				out.visits1, out.read1 = max(out.visits1, cost+read), max(out.read1, read)
			} else {
				out.visits300, out.read300 = max(out.visits300, cost+read), max(out.read300, read)
			}
		}
	}
	if out.tiles > 0 {
		for i := range worlds {
			slices.Sort(worlds[i])
			slices.Sort(owns[i])
		}
		out.world1, out.world300 = percentile(worlds[0], 50), percentile(worlds[1], 50)
		out.own1, out.own300 = percentile(owns[0], 50), percentile(owns[1], 50)
	}
	return out, nil
}

// SeenVerdict is the run's answer: each condition, the cost and whether
// to adopt the per-server record.
type SeenVerdict struct {
	Condition1, Condition2 bool
	Why1, Why2             string
	Cost                   string
	CostHolds              bool
}

// Adopt is true only when both conditions and the cost hold.
func (v SeenVerdict) Adopt() bool { return v.Condition1 && v.Condition2 && v.CostHolds }

// Lines are the four verdict lines.
func (v SeenVerdict) Lines() []string {
	cond := func(ok bool, why string) string { return fmt.Sprintf("%s (%s)", either(ok, "holds", "fails"), why) }
	return []string{
		"condition 1: " + cond(v.Condition1, v.Why1),
		"condition 2: " + cond(v.Condition2, v.Why2),
		"cost: " + v.Cost,
		"adopt: " + either(v.Adopt(), "yes", "no"),
	}
}

// SeenRun plays the seen run, writes seen.md under out and prints the
// verdict lines. It measures no target.
func SeenRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	v, err := seenRun(b, out, n)
	if err != nil {
		return nil, err
	}
	return nil, writeLines(os.Stdout, v)
}

func seenRun(b *sheets.Book, out string, n int) (SeenVerdict, error) {
	if n == 0 {
		n = contentSeeds
	}
	books := historyBooks(b)
	results := make([]seenResult, len(historyNames)*n)
	if err := runParallel(len(results), func(i int) error {
		name := historyNames[i/n]
		var err error
		results[i], err = seenHistory(books[name], name, i%n)
		return err
	}); err != nil {
		return SeenVerdict{}, err
	}
	cost, err := seenCost(b)
	if err != nil {
		return SeenVerdict{}, err
	}
	var doc lineDoc
	v := writeSeen(doc.p, results, cost, n)
	if err := doc.save(out, "seen.md"); err != nil {
		return v, err
	}
	return v, nil
}

// writeSeen writes the report and judges it.
func writeSeen(p func(string, ...any), rs []seenResult, cost seenCostResult, n int) SeenVerdict {
	var bad []string
	for _, r := range rs {
		bad = append(bad, r.bad...)
	}
	p("# Seen run")
	p("")
	p("Whether a record per server of what its characters have seen could steer content drawn from history (GDD 4.17) while a pin changes no tile outside its reach (GDD 14.4). The content run's four histories, %d seeds each, under their keys `content-<history>-<seed>`, are walked by %d walkers from the first %d settlements, %d tiles a day each from day %d, the first being the history's own explorer (the pinned history's pins go ahead of it). Even walkers are server A's, odd ones B's.", n, seenWalkers, seenWalkers, explorerPerDay, historyStillDays)
	p("")
	p("A record holds each find (a far or edge material, a variant, an edge creature, a biome variant, a pattern) from the first time one of its walkers enters a region holding it, as the world's finds do from a region's first discovery; the founding region is in every record. The world's record takes every walker. A server's takes only its own, and leaves out every visit that could carry a pin: a tile a pin fixed or grounded, a tile whose stored digest read a pin, and a tile in the reach of a pin made before the visit. Every first-reached tile is drawn three ways with the pure `gen.Content`: on its stored digest (the world's record), and on that digest with its finds replaced by A's or B's tally over the same regions and window. Tiles a pin fixed are drawn by the pin, not a record, and are left out (%d).", sumBy(rs, func(r seenResult) int { return r.excluded }))
	p("")
	p("The run's world record is checked against the world's own: the same finds at the same ticks, the same novelty per band, the same finds in every stored digest, and the world record's draw equal to the stored one.")
	listBad(p, "Off", bad)
	if len(bad) == 0 {
		p("")
		p("It matches on every tile and find.")
	}

	// (a) steering share.
	p("")
	p("## (a) Steering: a server's own record against the world's")
	p("")
	p("For each server, the tiles its walkers first reached whose draw on either record sets a field: how many have a record digest of their own, and how many draw a different site kind, lead, stock or dungeon on the server's record than on the world's. Condition 1 needs %d%% in each (content-differs' threshold).", differsTarget)
	p("")
	p("| History | Server | Tiles | Own record differs | Drawn fields differ | Share |")
	p("| --- | --- | --- | --- | --- | --- |")
	var steerAll [2]struct{ tiles, rec, differ int }
	for _, name := range historyNames {
		for x := range seenServers {
			var t, rec, d int
			for _, r := range byName(rs, name) {
				t, rec, d = t+r.steer[x].tiles, rec+r.steer[x].recordDiffers, d+r.steer[x].differ
			}
			steerAll[x].tiles, steerAll[x].rec, steerAll[x].differ = steerAll[x].tiles+t, steerAll[x].rec+rec, steerAll[x].differ+d
			p("| %s | %s | %s | %s | %s | %.1f%% |", name, seenServers[x], comma(int64(t)), comma(int64(rec)), comma(int64(d)), pct(d, t))
		}
	}
	for x := range seenServers {
		s := steerAll[x]
		p("| all | %s | %s | %s | %s | **%.1f%%** |", seenServers[x], comma(int64(s.tiles)), comma(int64(s.rec)), comma(int64(s.differ)), pct(s.differ, s.tiles))
	}

	// (b) novelty.
	p("")
	p("## (b) Novelty per server and band")
	p("")
	p("The regions each server's record entered, by band of %d tiles from the origin, and those holding something its record had not seen. Condition 1 needs at least 1 in %d in every band. At the end of every history, the world's record holds %s finds, A's %s and B's %s.", seenBand, novelLeast,
		comma(int64(sumBy(rs, func(r seenResult) int { return r.finds[0] }))), comma(int64(sumBy(rs, func(r seenResult) int { return r.finds[1] }))), comma(int64(sumBy(rs, func(r seenResult) int { return r.finds[2] }))))
	p("")
	p("| Server | Band | Regions | Held something new | Share |")
	p("| --- | --- | --- | --- | --- |")
	var bands [2]map[int64]novel
	novelOK := true
	var novelWhy []string
	for x := range seenServers {
		bands[x] = map[int64]novel{}
		for _, r := range rs {
			for band, nv := range r.bands[x] {
				b := bands[x][band]
				b.regions, b.novel = b.regions+nv.regions, b.novel+nv.novel
				bands[x][band] = b
			}
		}
		for _, band := range slices.Sorted(maps.Keys(bands[x])) {
			nv := bands[x][band]
			ok := nv.novel*novelLeast >= nv.regions
			if !ok {
				novelOK = false
				novelWhy = append(novelWhy, fmt.Sprintf("%s band %d at %.1f%%", seenServers[x], band, pct(nv.novel, nv.regions)))
			}
			p("| %s | %d–%d | %s | %s | %.1f%% |", seenServers[x], band, band+seenBand-1, comma(int64(nv.regions)), comma(int64(nv.novel)), pct(nv.novel, nv.regions))
		}
	}

	// (c) A against B.
	p("")
	p("## (c) Two servers in one world")
	p("")
	p("Every tile drawn on A's record and on B's: of those whose draw on either sets a field, the share whose drawn fields differ; and of every tile, how many have different record digests.")
	p("")
	p("| History | Tiles with a field | Drawn fields differ | Share | Tiles | Record digests differ |")
	p("| --- | --- | --- | --- | --- | --- |")
	var abT, abD, allT, abK int
	for _, name := range historyNames {
		var t, d, all, k int
		for _, r := range byName(rs, name) {
			t, d, all, k = t+r.abTiles, d+r.abDiffer, all+r.tiles-r.excluded, k+r.abKey
		}
		abT, abD, allT, abK = abT+t, abD+d, allT+all, abK+k
		p("| %s | %s | %s | %.1f%% | %s | %s |", name, comma(int64(t)), comma(int64(d)), pct(d, t), comma(int64(all)), comma(int64(k)))
	}
	p("| all | %s | %s | **%.1f%%** | %s | %s |", comma(int64(abT)), comma(int64(abD)), pct(abD, abT), comma(int64(allT)), comma(int64(abK)))

	// (d) a pin's reach.
	var pins, outside, outKey, outFields, outWorld int
	for _, r := range byName(rs, historyPinned) {
		pins, outside, outKey, outFields, outWorld = pins+r.pins, outside+r.outside, outKey+r.outsideKey, outFields+r.outsideFields, outWorld+r.outsideWorld
	}
	p("")
	p("## (d) A pin stays in its reach, on the servers' records")
	p("")
	p("The pinned history against its pinless twin, the same walkers under the same key. Every tile both reached outside the reach of every pin is drawn on A's and B's record in each. Leaving pin-touched visits out of a record changes when the record first sees a region, so the twin, with nothing to leave out, can read a different record far from any pin. Condition 2 needs 0 tiles whose record digest differs.")
	p("")
	p("| Pins reserved | Tiles outside every pin | A's or B's record digest differs | Drawn fields differ | The world's stored key differs |")
	p("| --- | --- | --- | --- | --- |")
	p("| %s | %s | **%s** | %s | %s |", comma(int64(pins)), comma(int64(outside)), comma(int64(outKey)), comma(int64(outFields)), comma(int64(outWorld)))

	// (e) the order rule.
	var pairs, same, nat, natSame int
	for _, r := range rs {
		pairs, same, nat, natSame = pairs+r.pairs, same+r.pairsSame, nat+r.natural, natSame+r.natSame
	}
	p("")
	p("## (e) Two servers reaching a tile in one tick")
	p("")
	p("A tile has one stored draw, made by the first command of the tick that reaches it (GDD 4.17 \"One draw\"). On a server's record it is the first command's server's record, so the draw is the same in either order only where A's and B's records give the same digest. Up to %d tiles per history and seed, drawn under `harness.seen`, are taken as reached by an A and a B walker in the tick they were first reached, and drawn in either order; the walkers' own same-tick arrivals are counted beside them.", seenPairs)
	p("")
	p("| Pairs placed | Same in either order | Share | Same-tick arrivals of both servers | Same in either order |")
	p("| --- | --- | --- | --- | --- |")
	p("| %s | %s | **%.1f%%** | %d | %d |", comma(int64(pairs)), comma(int64(same)), pct(same, pairs), nat, natSame)

	// (f) cost.
	ratio := func(a, b time.Duration) float64 {
		if a == 0 {
			return 0
		}
		return 100 * float64(b) / float64(a)
	}
	p("")
	p("## (f) What it costs a digest")
	p("")
	p("busyCost's busy world (the warring history under `content-busy-0`, %s located heavy facts a day round the sample) walked by the same walkers to day %d. The sample is the disc of %d tiles round where the first walker (A's) stands on day %d, so a tile still unreached there reads regions A's record has entered. On every such tile, `DigestAt` plus `gen.Content` is timed on day 1's snapshot and day %d's, the least of %d tries each: on the world's record, and with server A's record's tally (the regions in reach recomputed, which a sim build would share with the digest) in its place. The world holds %d finds on day 1 and %d on day %d; A's record %d and %d. A record is a find list per region per server, so it grows with the regions a server has entered, not with the world's age.", comma(busyFacts), busyDays, busyTiles, busyDays, busyDays, busyRounds, cost.findsDay1, cost.findsDayBusy, busyDays, cost.recordDay1, cost.recordDayBusy)
	p("")
	p("| Day | World record (median) | Server's record (median) | Visits, digest and record (most) | Record entries read (most) |")
	p("| --- | --- | --- | --- | --- |")
	p("| 1 | %s | %s | %d | %d |", micros(cost.world1), micros(cost.own1), cost.visits1, cost.read1)
	p("| %d | %s | %s | %d | %d |", busyDays, micros(cost.world300), micros(cost.own300), cost.visits300, cost.read300)
	p("")
	p("Sample tiles timed: %d. The digest's bound is %d visits.", cost.tiles, cost.bound)

	// The verdict.
	v := SeenVerdict{}
	reconOff := ""
	if len(bad) > 0 {
		reconOff = fmt.Sprintf("; the run's world record is off in %d places", len(bad))
	}
	steerOK := true
	var steerWhy []string
	for x := range seenServers {
		s := steerAll[x]
		if s.tiles == 0 || s.differ*100 < differsTarget*s.tiles {
			steerOK = false
		}
		steerWhy = append(steerWhy, fmt.Sprintf("%s steers %.1f%%", seenServers[x], pct(s.differ, s.tiles)))
	}
	v.Condition1 = steerOK && novelOK && len(bad) == 0
	v.Why1 = fmt.Sprintf("%s, at least %d%% needed; novelty %s", strings.Join(steerWhy, ", "), differsTarget,
		either(novelOK, fmt.Sprintf("at least 1 in %d in every band", novelLeast), "under 1 in "+fmt.Sprint(novelLeast)+" in "+strings.Join(novelWhy, ", "))) + reconOff
	v.Condition2 = outKey == 0 && same == pairs && natSame == nat && pairs > 0 && len(bad) == 0
	v.Why2 = fmt.Sprintf("%s of %s tiles outside every pin's reach read a different record with pins than without; %s of %s same-tick pairs draw the same in either order (%.1f%%)",
		comma(int64(outKey)), comma(int64(outside)), comma(int64(same+natSame)), comma(int64(pairs+nat)), pct(same+natSame, pairs+nat)) + reconOff
	v.CostHolds = cost.tiles > 0 && cost.own300*100 <= cost.own1*costFlat && cost.visits300 <= cost.bound
	v.Cost = fmt.Sprintf("%s day 1 / %s day %d on a server's record (%.0f%%, at most %d%%; the world's record %s / %s), %d visits at most against a bound of %d: %s",
		micros(cost.own1), micros(cost.own300), busyDays, ratio(cost.own1, cost.own300), costFlat, micros(cost.world1), micros(cost.world300),
		cost.visits300, cost.bound, either(v.CostHolds, "holds", "fails"))
	p("")
	p("## Verdict")
	p("")
	p("Condition 1, a per-server record can steer content per server: each server's steering share at least %d%% and its novelty at least 1 in %d in every band. Condition 2, a pin changes no tile outside its reach: 0 tiles in (d), and every same-tick pair in (e) the same in either order. The cost: day %d's median within %d%% of day 1's. Adopted only if all three hold.", differsTarget, novelLeast, busyDays, costFlat)
	p("")
	for _, l := range v.Lines() {
		p("- %s", l)
	}
	return v
}

// byName are the results of one history.
func byName(rs []seenResult, name string) []seenResult {
	return slices.DeleteFunc(slices.Clone(rs), func(r seenResult) bool { return r.name != name })
}

func sumBy(rs []seenResult, get func(seenResult) int) int {
	n := 0
	for _, r := range rs {
		n += get(r)
	}
	return n
}

// writeLines writes the verdict lines, one a line.
func writeLines(w io.Writer, v SeenVerdict) error {
	for _, l := range v.Lines() {
		if _, err := fmt.Fprintln(w, l); err != nil {
			return err
		}
	}
	return nil
}
