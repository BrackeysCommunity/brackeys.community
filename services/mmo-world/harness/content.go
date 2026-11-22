package harness

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/history"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// The content run's targets and shape (GDD 4.17, 14.4).
const (
	contentSeeds       = 40  // seeds per history
	sweepPerSeed       = 25  // pin-sweep seeds per history seed: 1,000 at the default
	differsTarget      = 60  // per cent of S (see differs) whose drawn fields differ, in every history
	costFlat           = 150 // per cent of day 1's median a draw on day busyDays may cost
	reachWalk          = 200 // tiles a walk from the first settlement may take
	sweepReachMost     = 12  // the sweep's pins reach 1 to this
	busyDays           = 300
	busyFacts          = 2000 // located heavy facts noted a day in the busy world
	busyTiles          = 500
	busyRounds         = 3 // timings per tile and day, the least kept
	dungeonFloorsLeast = 3
	dungeonFloorsMost  = 7
	waysTagsMost       = 3
	badShown           = 10 // failures listed per row, at most
)

// historyResult is what one history and seed showed.
type historyResult struct {
	name string
	seed int

	replays   bool
	replayWhy string
	tiles     int // reached by the end
	facts     int
	weekMin   int // raids and betrayals in the quietest whole week
	over      int // per cent of awake regions over the overrun line at the end

	sample, candidates, differ, keyDiffer, saturated int
	differBad                                        []string

	pins, landed, holding int
	codes                 map[string]int
	compared, before      int
	outside, exempt       int
	pinBad                []string

	reachTargets int
	reachBad     []string
	scaffoldLost []string // drawn entrances on scaffold slots no walk reaches

	plans, forks int
	dungeonBad   []string
	siteKinds    map[string]int
	dungeonKinds map[string]int
	bands        map[string]int
	leadRegion   int // reached tiles whose lead is their region's creature
	leads        int
}

// drawnFields counts what a draw set on a tile: its site kind, lead, each
// material's stock and its dungeon.
func drawnFields(c *tile.Content) int {
	n := len(c.Stock)
	for _, set := range []bool{c.SiteKind != "", c.Lead != "", c.Dungeon != nil} {
		if set {
			n++
		}
	}
	return n
}

// drawnDiffer reports whether two contents differ in a drawn field; the
// key and digest do not count.
func drawnDiffer(a, b *tile.Content) bool {
	if a.SiteKind != b.SiteKind || a.Lead != b.Lead || !maps.Equal(a.Stock, b.Stock) {
		return true
	}
	if (a.Dungeon == nil) != (b.Dungeon == nil) {
		return true
	}
	return a.Dungeon != nil && (a.Dungeon.Kind != b.Dungeon.Kind || a.Dungeon.Floors != b.Dungeon.Floors)
}

// playWhole plays a history from day 0 to the end of its length.
func playWhole(b *sheets.Book, name string, seed int, pins bool) (*historyRun, error) {
	h, err := newHistory(b, name, seed, pins)
	if err != nil {
		return nil, err
	}
	if err := h.days(historyLength, nil); err != nil {
		return nil, err
	}
	return h, nil
}

func playHistory(b *sheets.Book, name string, seed int) (historyResult, error) {
	out := historyResult{name: name, seed: seed, codes: map[string]int{},
		siteKinds: map[string]int{}, dungeonKinds: map[string]int{}, bands: map[string]int{}}
	a, err := newHistory(b, name, seed, name == historyPinned)
	if err != nil {
		return out, err
	}
	if err := a.days(twinDay, nil); err != nil {
		return out, err
	}
	twin, err := a.fork()
	if err != nil {
		return out, err
	}
	split := a.s.Tick
	if err := a.days(twinDays, nil); err != nil {
		return out, err
	}
	if err := differs(a, twin, split, &out); err != nil {
		return out, err
	}
	if err := a.days(historyLength-int(a.s.Day), nil); err != nil {
		return out, err
	}

	again, err := playWhole(b, name, seed, name == historyPinned)
	if err != nil {
		return out, err
	}
	if err := replays(a, again, &out); err != nil {
		return out, err
	}

	if name == historyPinned {
		bare, err := playWhole(b, name, seed, false)
		if err != nil {
			return out, err
		}
		if err := staysInReach(a, bare, &out); err != nil {
			return out, err
		}
	}

	out.tiles, out.facts = len(a.reached()), a.log.Len()
	if w := weekly(a.log, historyLength); len(w) > 0 {
		out.weekMin = slices.Min(w)
	}
	out.over = overShare(a.s, a.b)
	historyReach(a, &out)
	historyDungeons(a, &out)
	drew(a, &out)
	return out, nil
}

// twinKinds are the heavy kinds the twin may note near a tile. Each tile
// gets the one the first history's digest of it holds fewest of: a kind
// already at history-kind-most adds nothing to a digest by design, so
// noting it would not make the neighbourhoods differ.
var twinKinds = []string{"faction.raided", "faction.besieged", "region.unrest", "character.down"}

// differs runs the twin from the split with one heavy fact noted 1 to
// history-radius tiles from each sampled tile (S: up to twinSample tiles
// first reached after the split whose draw sets a field) just before the
// explorer reaches it, and compares their drawn fields with the first
// history's. A tile whose digest holds every twin kind at the cap is left
// out of S and counted.
func differs(a, twin *historyRun, split int64, out *historyResult) error {
	end := a.s.Tick
	var cand []*tile.State
	for _, t := range a.reached() {
		if c := t.Content; c.Drawn > split && c.Drawn <= end && drawnFields(c) > 0 {
			cand = append(cand, t)
		}
	}
	out.candidates = len(cand)
	seed := draw.Int(int64(a.seed))
	var sample []*tile.State
	for _, i := range a.d.Shuffle(len(cand), "harness.sample", seed, draw.Str(a.name)) {
		if len(sample) == twinSample {
			break
		}
		sample = append(sample, cand[i])
	}
	bounds := history.BoundsOf(a.b.MapParams)
	full := map[hex.Hex]bool{}
	err := twin.days(twinDays, func(h *historyRun) error {
		for _, t := range sample {
			d := t.Content.Drawn
			if d <= h.s.Tick || d > h.s.Tick+sheets.TicksPerDay {
				continue
			}
			x := t.Hex
			var window history.Digest
			if t.Content.Digest != nil {
				window = *t.Content.Digest
			}
			kind := twinKinds[0]
			for _, k := range twinKinds[1:] {
				if window.Count(k) < window.Count(kind) {
					kind = k
				}
			}
			if window.Count(kind) >= bounds.KindMost {
				full[x] = true
				continue
			}
			dist := h.d.Between(1, bounds.Radius, "harness.sample", seed, draw.Int(x.Q), draw.Int(x.R), draw.Str("dist"))
			ring := hex.Ring(x, dist)
			at := ring[h.d.Below(uint64(len(ring)), "harness.sample", seed, draw.Int(x.Q), draw.Int(x.R), draw.Str("at"))]
			if err := h.note(kind, at); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, t := range sample {
		if full[t.Hex] {
			out.saturated++
			continue
		}
		out.sample++
		c := twin.s.Content(t.Hex)
		if c == nil {
			out.differBad = append(out.differBad, fmt.Sprintf("%s seed %d: %s unreached in the twin", a.name, a.seed, t.Hex.Ref()))
			continue
		}
		if c.Key != t.Content.Key {
			out.keyDiffer++
		}
		if drawnDiffer(t.Content, c) {
			out.differ++
		}
	}
	return nil
}

// replays compares two plays of one history from scratch: every tile's
// content and the world digests.
func replays(a, again *historyRun, out *historyResult) error {
	ca, err := a.contentDigests()
	if err != nil {
		return err
	}
	cb, err := again.contentDigests()
	if err != nil {
		return err
	}
	da, err := world.Digest(a.s, a.log)
	if err != nil {
		return err
	}
	db, err := world.Digest(again.s, again.log)
	if err != nil {
		return err
	}
	out.replays = maps.Equal(ca, cb) && da == db
	if !out.replays {
		out.replayWhy = fmt.Sprintf("%s seed %d: %d and %d tiles, world %s against %s", a.name, a.seed, len(ca), len(cb), da.String()[:12], db.String()[:12])
	}
	return nil
}

// staysInReach holds the pinned history against its pinless twin: a tile
// may differ only if a pin made before it was reached covers it, and every
// landed pin's tile holds its fix.
func staysInReach(p, bare *historyRun, out *historyResult) error {
	out.pins = len(p.pinsP)
	maps.Copy(out.codes, p.codes)
	cp, err := p.contentDigests()
	if err != nil {
		return err
	}
	cq, err := bare.contentDigests()
	if err != nil {
		return err
	}
	where := func(h hex.Hex, why string) {
		out.pinBad = append(out.pinBad, fmt.Sprintf("pinned seed %d %s: %s", p.seed, h.Ref(), why))
	}
	for _, h := range slices.SortedFunc(maps.Keys(cp), hex.Compare) {
		c := p.s.Content(h)
		covered, exempt := false, false
		for _, pin := range p.pinsP {
			if hex.Distance(pin.At, h) <= pin.Reach {
				covered = true
				exempt = exempt || pin.Tick < c.Drawn
			}
		}
		if exempt {
			out.exempt++
			if why := onlyPins(c, bare.s.Content(h), p.pinsP); why != "" {
				where(h, why)
			}
			continue
		}
		out.compared++
		if covered {
			out.before++
		} else {
			out.outside++
		}
		if cq[h] != cp[h] {
			where(h, either(covered, "reached before the pins covering it, but changed", "outside every pin's reach, but changed"))
		}
	}
	for h := range cq {
		if _, ok := cp[h]; !ok {
			where(h, "reached only without pins")
		}
	}
	for _, pin := range p.pinsP {
		c := p.s.Content(pin.At)
		if c == nil {
			continue
		}
		out.landed++
		if why := fixHeld(p, pin, c); why != "" {
			where(pin.At, why)
			continue
		}
		out.holding++
	}
	return nil
}

// onlyPins says how a tile drawn inside pins' reach differs from its
// pinless twin other than through the pins its digest read, or "": the
// digest apart from its pins must be the twin's, and every pin it read
// one that was made before the draw and covers the tile.
func onlyPins(c, twin *tile.Content, pins []world.Pin) string {
	if twin == nil {
		return "reached only with pins"
	}
	if c.Digest == nil || twin.Digest == nil {
		return "no digest stored"
	}
	a, b := *c.Digest, *twin.Digest
	if len(b.Pins) > 0 {
		return fmt.Sprintf("the pinless twin read pins %v", b.Pins)
	}
	a.Pins = nil
	if da, db := mustDigest(a), mustDigest(b); da != db {
		return "the digest differs apart from its pins"
	}
	for _, id := range c.Digest.Pins {
		i := slices.IndexFunc(pins, func(p world.Pin) bool { return p.ID == id })
		if i < 0 || pins[i].Tick >= c.Drawn {
			return fmt.Sprintf("read %s, which was not made before the draw", id)
		}
	}
	return ""
}

// mustDigest is a value's canonical digest; the harness's own values
// always encode.
func mustDigest(v any) string {
	d, err := canon.Digest(v)
	if err != nil {
		panic(err)
	}
	return d.String()
}

// fixHeld says how a landed pin's tile breaks its fix, or "".
func fixHeld(h *historyRun, pin world.Pin, c *tile.Content) string {
	f, b := pin.Fix, h.g.Baseline(pin.At)
	switch {
	case c.Pin != pin.ID:
		return fmt.Sprintf("landed as %q, not %s", c.Pin, pin.ID)
	case f.SiteKind != "" && c.SiteKind != f.SiteKind:
		return fmt.Sprintf("site kind %q, fixed %q", c.SiteKind, f.SiteKind)
	case f.Lead != "" && c.Lead != f.Lead:
		return fmt.Sprintf("lead %q, fixed %q", c.Lead, f.Lead)
	case f.Site != "" && cmp.Or(c.Site, b.Site) != f.Site:
		return fmt.Sprintf("slot %q, fixed %q", cmp.Or(c.Site, b.Site), f.Site)
	case f.Site == gen.PlaceDungeon && c.Dungeon == nil:
		return "a dungeon slot with no plan"
	case f.Dungeon != "" && (c.Dungeon == nil || c.Dungeon.Kind != f.Dungeon):
		return fmt.Sprintf("dungeon %+v, fixed %q", c.Dungeon, f.Dungeon)
	}
	if f.Stock != "" {
		units, _ := h.g.StockUnits(f.Stock)
		mats := h.g.Region(b.Region).Materials
		if len(c.Stock) != len(mats) {
			return fmt.Sprintf("stock %v for %d materials", c.Stock, len(mats))
		}
		for m, v := range c.Stock {
			if v != units {
				return fmt.Sprintf("%s stock %d, fixed %s (%d)", m, v, f.Stock, units)
			}
		}
	}
	return ""
}

// historyReach walks from the first settlement to every pinned slot and
// drawn dungeon entrance over baseline passability. A target on a scaffold
// slot no walk reaches is counted apart in scaffoldLost: the scaffold put it
// there, not a draw.
func historyReach(h *historyRun, out *historyResult) {
	var targets []hex.Hex
	for _, t := range h.reached() {
		if c := t.Content; c.Site != "" || (c.Dungeon != nil && !c.Native) {
			targets = append(targets, t.Hex)
		}
	}
	out.reachTargets = len(targets)
	found := walkTo(h.g, h.home, targets, reachWalk)
	for _, t := range targets {
		if found[t] {
			continue
		}
		where := fmt.Sprintf("%s seed %d: %s %s", h.name, h.seed, h.g.Baseline(t).Site, t.Ref())
		if h.s.Content(t).Site == "" {
			out.scaffoldLost = append(out.scaffoldLost, where)
			continue
		}
		out.reachBad = append(out.reachBad, where)
	}
}

// refusalCode is a world refusal's code.
func refusalCode(err error) (string, bool) {
	var r *world.Refusal
	if errors.As(err, &r) {
		return r.Code, true
	}
	return "", false
}

// walkTo walks from a tile over passable baseline ground, at most most
// steps, and reports which targets it met.
func walkTo(g *gen.Gen, from hex.Hex, targets []hex.Hex, most int64) map[hex.Hex]bool {
	step := func(_, n hex.Hex) (int64, bool) { return 1, g.Passable(g.Baseline(n).Terrain) }
	reached := hex.Reach([]hex.Hex{from}, step, most)
	found := map[hex.Hex]bool{}
	for _, t := range targets {
		if _, ok := reached[t]; ok {
			found[t] = true
		}
	}
	return found
}

// historyDungeons holds every plan drawn from history to the native
// dungeon rules, and draws each floor's ways as a delve at the end of the
// history would.
func historyDungeons(h *historyRun, out *historyResult) {
	kinds, forks := sheets.Lookup(h.b.Dungeons), sheets.Lookup(h.b.Forks)
	for _, t := range h.reached() {
		c := t.Content
		if c.Dungeon == nil || c.Native {
			continue
		}
		out.plans++
		pl := c.Dungeon
		where := fmt.Sprintf("%s seed %d %s %s", h.name, h.seed, pl.Kind, t.Hex.Ref())
		bad := func(f string, a ...any) { out.dungeonBad = append(out.dungeonBad, where+": "+fmt.Sprintf(f, a...)) }
		k, ok := kinds[pl.Kind]
		if !ok {
			bad("no such kind")
			continue
		}
		if pl.Floors < k.FloorsMin || pl.Floors > k.FloorsMax || pl.Floors < dungeonFloorsLeast || pl.Floors > dungeonFloorsMost {
			bad("%d floors, the kind runs %d to %d", pl.Floors, k.FloorsMin, k.FloorsMax)
		}
		if gd, ok := sheets.GuardianOf(h.b.Hunts, pl.Kind); !ok || pl.Guardian != gd.ID {
			bad("guarded by %q", pl.Guardian)
		}
		p := gen.Plan{Hex: t.Hex, Kind: pl.Kind, Floors: pl.Floors, Guardian: pl.Guardian, Up: pl.Up, SeedTier: pl.SeedTier}
		at := h.s.DigestAt(t.Hex, h.s.Tick+1).Key()
		for n := int64(1); n <= pl.Floors; n++ {
			ways := h.g.DrawWays(p, c.Key, at, n)
			if n == pl.Floors {
				if slices.ContainsFunc(ways[:], func(w gen.Way) bool { return w.Fork != "" }) {
					bad("the bottom forks")
				}
				continue
			}
			out.forks++
			seen := map[string]bool{}
			for w, x := range ways {
				row, ok := forks[x.Fork]
				switch {
				case !ok:
					bad("floor %d way %d: no fork %q", n, w, x.Fork)
				case !slices.Contains(row.Kinds, pl.Kind):
					bad("floor %d way %d: %s is not a %s fork", n, w, x.Fork, pl.Kind)
				case len(x.Tags) < 1 || len(x.Tags) > waysTagsMost:
					bad("floor %d way %d: %d tags", n, w, len(x.Tags))
				case seen[x.Fork]:
					bad("floor %d: %s twice", n, x.Fork)
				}
				seen[x.Fork] = true
			}
		}
	}
}

// drew tallies what the history's draws gave: site kinds, dungeon kinds,
// stock bands and leads.
func drew(h *historyRun, out *historyResult) {
	band := map[int64]string{}
	for _, s := range h.b.StockBands {
		if u, ok := h.g.StockUnits(s.ID); ok {
			band[u] = s.ID
		}
	}
	for _, t := range h.reached() {
		c := t.Content
		if c.Native {
			continue
		}
		if c.SiteKind != "" {
			out.siteKinds[c.SiteKind]++
		}
		if c.Dungeon != nil {
			out.dungeonKinds[c.Dungeon.Kind]++
		}
		for _, u := range c.Stock {
			out.bands[cmp.Or(band[u], fmt.Sprint(u))]++
		}
		if c.Lead != "" {
			out.leads++
			if c.Lead == h.g.Region(h.g.Baseline(t.Hex).Region).Creature {
				out.leadRegion++
			}
		}
	}
}

// sweepResult is one seed of the pin sweep.
type sweepResult struct {
	regions, accepted, noRoom int
	codes                     map[string]int
	bad                       []string
}

// sweepSeed places one designer site or dungeon pin in each region of
// the first two rings round the first settlement's, through the pin
// validators, and holds every accepted one to passable ground, a walk
// from the first settlement and its region's budgets.
func sweepSeed(b *sheets.Book, seed int) (sweepResult, error) {
	out := sweepResult{codes: map[string]int{}}
	g, k, err := newGen(b, fmt.Sprintf("content-sweep-%d", seed))
	if err != nil {
		return out, err
	}
	s, err := world.New(b, g, k.Roll)
	if err != nil {
		return out, err
	}
	d := draw.NewDrawer(k.Roll)
	home := g.Settlement(0).Hex
	inner := g.RegionOf(home)
	ring := map[gen.LatticeID]bool{}
	for _, id := range g.RegionNeighbours(inner) {
		ring[id] = true
		for _, n := range g.RegionNeighbours(id) {
			ring[n] = true
		}
	}
	delete(ring, inner)
	log := &fact.Mem{}
	var placed []world.Pin
	for _, id := range slices.SortedFunc(maps.Keys(ring), gen.CompareIDs) {
		out.regions++
		var free []hex.Hex
		for _, h := range g.RegionTiles(id) {
			if tb := g.Baseline(h); tb.Site == "" && tb.Landmark == "" && g.Passable(tb.Terrain) {
				free = append(free, h)
			}
		}
		if len(free) == 0 {
			out.noRoom++
			continue
		}
		at := []draw.Part{draw.Int(id.I), draw.Int(id.J)}
		h := free[d.Below(uint64(len(free)), "harness.pin", append(at, draw.Str("tile"))...)]
		fix := tile.Fix{Site: gen.SiteOrdinary}
		if d.Below(2, "harness.pin", append(at, draw.Str("slot"))...) == 0 {
			fix.Site = gen.PlaceDungeon
		}
		reach := d.Between(1, sweepReachMost, "harness.pin", append(at, draw.Str("reach"))...)
		p, err := s.Reserve(log, h, reach, fix, world.PinBy{Role: world.PinDesigner})
		if err != nil {
			if err := tallyRefusal(out.codes, err); err != nil {
				return out, err
			}
			continue
		}
		out.accepted++
		placed = append(placed, *p)
	}
	var targets []hex.Hex
	for _, p := range placed {
		targets = append(targets, p.At)
	}
	found := walkTo(g, home, targets, reachWalk)
	sitesMax := sheets.IntParam(b.MapParams, "sites-max")
	for _, p := range placed {
		where := fmt.Sprintf("seed %d %s %s", seed, p.Fix.Site, p.At.Ref())
		id := g.RegionOf(p.At)
		if !g.Passable(g.Baseline(p.At).Terrain) {
			out.bad = append(out.bad, where+": impassable")
		}
		if !found[p.At] {
			out.bad = append(out.bad, fmt.Sprintf("%s: no walk from the first settlement within %d tiles", where, reachWalk))
		}
		sites, dungeons := int64(len(g.RegionSites(id))), 0
		for _, h := range g.RegionTiles(id) {
			if site := g.Baseline(h).Site; site == gen.PlaceDungeon || site == gen.PlaceRelay {
				dungeons++
			}
		}
		for _, q := range placed {
			if g.RegionOf(q.At) == id {
				sites++
				if q.Fix.Site == gen.PlaceDungeon {
					dungeons++
				}
			}
		}
		if sites > sitesMax {
			out.bad = append(out.bad, fmt.Sprintf("%s: the region holds %d sites", where, sites))
		}
		if p.Fix.Site == gen.PlaceDungeon && dungeons > 1 {
			out.bad = append(out.bad, fmt.Sprintf("%s: the region holds %d dungeons", where, dungeons))
		}
	}
	return out, nil
}

// busyResult is the cost row's reading.
type busyResult struct {
	tiles                  int
	day1, day300           time.Duration // medians
	cost1, cost300         []int64       // sorted visit counts
	bound                  int64
	facts, cells, reachedN int
}

// busyCost plays the warring history with busyFacts located heavy facts
// noted a day, to day busyDays, and times a tile's digest and draw on
// unreached tiles against the same tiles on day 1, alternating tile by
// tile so machine load falls on both alike.
func busyCost(b *sheets.Book) (busyResult, error) {
	var out busyResult
	h, err := newHistory(warringBook(b), "busy", 0, false)
	if err != nil {
		return out, err
	}
	tail := &fact.Tail{}
	h.log = tail
	// The sample is the disc of busyTiles tiles just past where the
	// explorer stands on the last day, and the facts land round it, so the
	// index cells each sample tile reads are full from day 1 and only the
	// world's age differs between the two days.
	last := h.ex.steps[min(len(h.ex.steps)-1, (busyDays-historyStillDays)*explorerPerDay)]
	spread := int64(0)
	for hex.DiscSize(spread) < busyTiles {
		spread++
	}
	centre := hex.Ring(h.home, hex.Distance(h.home, last)+1+spread)[0]
	sample := hex.DiscAt(centre, spread)[:busyTiles]
	area := hex.DiscAt(centre, spread+history.BoundsOf(b.MapParams).Radius)
	kinds := []string{"faction.raided", "region.surge"}
	inject := func(h *historyRun) error {
		tail.Flush()
		day := draw.Int(h.s.Day)
		for i := range busyFacts {
			at := area[h.d.Below(uint64(len(area)), "harness.busy", day, draw.Int(int64(i)))]
			if err := h.note(kinds[i%len(kinds)], at); err != nil {
				return err
			}
		}
		out.facts += busyFacts
		return nil
	}
	if err := h.days(1, inject); err != nil {
		return out, err
	}
	first, err := h.state()
	if err != nil {
		return out, err
	}
	if err := h.days(busyDays-1, inject); err != nil {
		return out, err
	}
	tail.Flush()
	out.cells = len(h.s.History)
	out.reachedN = len(h.reached())
	out.bound = history.BoundsOf(b.MapParams).CostBound()
	states := []*world.State{first, h.s}
	var times1, times300 []time.Duration
	for _, t := range sample {
		if first.Content(t) != nil || h.s.Content(t) != nil {
			continue
		}
		out.tiles++
		site := h.g.Baseline(t).Site
		var best [2]time.Duration
		for range busyRounds {
			for i, st := range states {
				start := time.Now()
				d := st.DigestAt(t, st.Tick+1)
				_ = h.g.Content(t, site, d, d.Key())
				if el := time.Since(start); best[i] == 0 || el < best[i] {
					best[i] = el
				}
			}
		}
		_, c1 := first.DigestCost(t, first.Tick+1)
		_, c300 := h.s.DigestCost(t, h.s.Tick+1)
		out.cost1, out.cost300 = append(out.cost1, c1), append(out.cost300, c300)
		times1, times300 = append(times1, best[0]), append(times300, best[1])
	}
	slices.Sort(times1)
	slices.Sort(times300)
	slices.Sort(out.cost1)
	slices.Sort(out.cost300)
	if out.tiles > 0 {
		out.day1, out.day300 = percentile(times1, 50), percentile(times300, 50)
	}
	return out, nil
}

// ContentRun plays the four histories, the pin sweep and the busy world,
// and writes content.md and readings.json under out. n is seeds per
// history.
func ContentRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	if n == 0 {
		n = contentSeeds
	}
	books := historyBooks(b)
	results := make([]historyResult, len(historyNames)*n)
	if err := runParallel(len(results), func(i int) error {
		name := historyNames[i/n]
		var err error
		results[i], err = playHistory(books[name], name, i%n)
		return err
	}); err != nil {
		return nil, err
	}
	sweeps := make([]sweepResult, n*sweepPerSeed)
	if err := runParallel(len(sweeps), func(i int) error {
		var err error
		sweeps[i], err = sweepSeed(b, i)
		return err
	}); err != nil {
		return nil, err
	}
	busy, err := busyCost(b)
	if err != nil {
		return nil, err
	}

	var body lineDoc
	p := body.p
	readings := []Measured{
		replayRow(p, results, n),
		differsRow(p, results),
		pinRow(p, results),
		reachRow(p, results, sweeps),
		busyRow(p, busy),
		dungeonRow(p, results),
	}
	drewSection(p, b, results)
	var doc lineDoc
	p = doc.p
	p("# Content run")
	p("")
	p("Content drawn from history at a tile's first reach (GDD 4.17) and pins (GDD 14.4), on %d seeds of each of four headless histories: worlds with no characters and no service, played on a fact.Mem under throwaway keys `content-<history>-<seed>`. Each stands %d days unattended, then the explorer walks out from the first settlement, %d tiles a day, for %d days.", n, historyStillDays, explorerPerDay, historyExploreDays)
	p("")
	p("- **quiet**: the base book.")
	p("- **warring**: factions.params regions-per-faction %d, seat-spacing %d, raid-damage %d, betray-threshold %d, betray-cooldown %d, betray-grudge %d; factions.move-weights fit %d for expand, %d for raid and %d for betray, every archetype.", warringRegionsPer, warringSeatSpacing, warringRaidDamage, warringBetrayThreshold, warringBetrayCooldown, warringBetrayGrudge, warringExpandFit, warringRaidFit, warringBetrayFit)
	p("- **overrun**: world.params baseline-min %d and baseline-max %d, world.gauges threat daily rise %d.", overrunBaselineMin, overrunBaselineMax, overrunThreatRise)
	p("- **pinned**: quiet, with a designer pin reserved before every %d explorer days, on the first passable tile %d to %d steps along the explorer's walk, reach %d to %d, and a fix drawn under `harness.pin`: a site kind on a site slot, a lead among the tile's archetypes, a stock band, or a dungeon (a new slot where the region's scaffold holds none, or a kind on a dungeon slot). Refusals are counted, never retried. Its pinless twin runs under the same key.", pinEvery, pinAheadMin, pinAheadMax, pinReachLeast, pinReachMost)
	p("")
	p("| Target | Reading | Holds |")
	p("| --- | --- | --- |")
	text := map[string]string{}
	for _, t := range b.Targets {
		text[t.ID] = t.Text
	}
	for _, m := range readings {
		p("| %s | %s | %s |", cmp.Or(text[m.Target], m.Target), m.Value, holds(m.Holds))
	}
	p("")
	p("| History | Tiles reached (median) | Facts (median) | Quietest week's raids and betrayals (median) | Awake regions over the overrun line (median) |")
	p("| --- | --- | --- | --- | --- |")
	for hi, name := range historyNames {
		rs := results[hi*n : (hi+1)*n]
		med := func(get func(historyResult) int) int {
			xs := make([]int, len(rs))
			for i, r := range rs {
				xs[i] = get(r)
			}
			slices.Sort(xs)
			return percentile(xs, 50)
		}
		p("| %s | %d | %d | %d | %d%% |", name, med(func(r historyResult) int { return r.tiles }), med(func(r historyResult) int { return r.facts }),
			med(func(r historyResult) int { return r.weekMin }), med(func(r historyResult) int { return r.over }))
	}
	doc.b.WriteString(body.b.String())
	if err := doc.save(out, "content.md"); err != nil {
		return nil, err
	}
	raw, err := json.MarshalIndent(readings, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(out, "readings.json"), append(raw, '\n'), 0o644); err != nil {
		return nil, err
	}
	return readings, nil
}

// listBad writes up to badShown failures.
func listBad(p func(string, ...any), heading string, bad []string) {
	if len(bad) == 0 {
		return
	}
	p("")
	p("%s, first %d:", heading, min(len(bad), badShown))
	p("")
	for _, s := range bad[:min(len(bad), badShown)] {
		p("- %s", s)
	}
}

func replayRow(p func(string, ...any), rs []historyResult, n int) Measured {
	var bad []string
	for _, r := range rs {
		if !r.replays {
			bad = append(bad, r.replayWhy)
		}
	}
	p("")
	p("## The same history gives the same content twice")
	p("")
	p("Every history and seed is played twice from scratch. Both plays must store the same content on every tile (canonical digest of each tile's `Content`) and reach the same world digest (state and log).")
	listBad(p, "Failing", bad)
	return Measured{"content-replays", fmt.Sprintf("%d of %d plays (%d histories × %d seeds) replay to equal content and world digests", len(rs)-len(bad), len(rs), len(historyNames), n), len(bad) == 0}
}

func differsRow(p func(string, ...any), rs []historyResult) Measured {
	p("")
	p("## Two neighbourhoods, two contents")
	p("")
	p("Each history is copied on day %d. S is up to %d tiles, drawn under `harness.sample`, that the explorer first reaches in the next %d days and whose draw sets at least one field. In the copy, one heavy fact is noted 1 to history-radius tiles from each tile of S at the end of the day before the explorer reaches it, so it lies inside the tile's window: whichever of %s the first history's digest of the tile holds fewest of, since a kind already at history-kind-most adds nothing to a digest. A tile whose digest holds all of them at the cap is left out of S and counted. Both then run the same %d days. A tile differs when a drawn field does: its site kind, lead, any material's stock, or its dungeon's kind or floors (residents are the game's, not a world-only history's). The key alone does not count.", twinDay, twinSample, twinDays, "`"+strings.Join(twinKinds, "`, `")+"`", twinDays)
	p("")
	p("| History | Tiles in S | Left out, every kind at the cap | Of the candidates | Key differs | Drawn fields differ | Share |")
	p("| --- | --- | --- | --- | --- | --- | --- |")
	var sample int
	var bad, per []string
	holds := true
	for _, name := range historyNames {
		var s, f, c, k, d int
		for _, r := range byHistory(rs, name) {
			s, f, c, k, d = s+r.sample, f+r.saturated, c+r.candidates, k+r.keyDiffer, d+r.differ
			bad = append(bad, r.differBad...)
		}
		sample += s
		holds = holds && s > 0 && d*100 >= differsTarget*s
		p("| %s | %s | %s | %s | %s | %s | %.1f%% |", name, comma(int64(s)), comma(int64(f)), comma(int64(c)), comma(int64(k)), comma(int64(d)), pct(d, s))
		per = append(per, fmt.Sprintf("%s %.1f%%", name, pct(d, s)))
	}
	listBad(p, "Failing", bad)
	return Measured{"content-differs", fmt.Sprintf("in every history, of %s sampled tiles: %s", comma(int64(sample)), strings.Join(per, ", ")),
		holds && len(bad) == 0}
}

// byHistory are the results of one history.
func byHistory(rs []historyResult, name string) []historyResult {
	return slices.DeleteFunc(slices.Clone(rs), func(r historyResult) bool { return r.name != name })
}

// tallyRefusal counts a world refusal's code and returns any other error.
func tallyRefusal(codes map[string]int, err error) error {
	if err == nil {
		return nil
	}
	if code, ok := refusalCode(err); ok {
		codes[code]++
		return nil
	}
	return err
}

// sumCodes adds src's counts to dst.
func sumCodes(dst, src map[string]int) {
	for k, v := range src {
		dst[k] += v
	}
}

// total is the sum of a code count.
func total(codes map[string]int) int {
	n := 0
	for _, v := range codes {
		n += v
	}
	return n
}

func pinRow(p func(string, ...any), rs []historyResult) Measured {
	var pins, landed, holding, compared, before, outside, exempt int
	codes := map[string]int{}
	var bad []string
	for _, r := range byHistory(rs, historyPinned) {
		pins, landed, holding = pins+r.pins, landed+r.landed, holding+r.holding
		compared, before, outside, exempt = compared+r.compared, before+r.before, outside+r.outside, exempt+r.exempt
		sumCodes(codes, r.codes)
		bad = append(bad, r.pinBad...)
	}
	p("")
	p("## A pin stays in its reach")
	p("")
	p("The pinned history against its pinless twin at the end. A tile may differ only where a pin made before the tile was reached covers it; every other reached tile must store the same content in both, whether no pin covers it or it was reached before the pins that do. A tile drawn in a pin's reach must have read the same digest as its twin apart from the pins, and only pins made before the draw. Every landed pin's tile must hold its fix.")
	p("")
	p("| Pins reserved | Refused | Landed | Holding their fix | Tiles compared | Of them reached before a covering pin | Outside every pin | In a pin's reach after it (exempt) |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- |")
	refused := total(codes)
	p("| %d | %d (%s) | %d | %d | %s | %s | %s | %s |", pins, refused, either(len(codes) > 0, mapList(codes), "none"), landed, holding,
		comma(int64(compared)), comma(int64(before)), comma(int64(outside)), comma(int64(exempt)))
	listBad(p, "Failing", bad)
	return Measured{"pin-stays-in-reach", fmt.Sprintf("%d pins, %d landed, %d holding their fix; %s tiles equal to the pinless twin's (%s before a covering pin, %s outside every pin) and %s drawn in a pin's reach on the twin's digest but for its pins; %d failing", pins, landed, holding, comma(int64(compared)), comma(int64(before)), comma(int64(outside)), comma(int64(exempt)), len(bad)),
		len(bad) == 0 && landed > 0 && holding == landed}
}

func reachRow(p func(string, ...any), rs []historyResult, sw []sweepResult) Measured {
	var regions, accepted, noRoom int
	codes := map[string]int{}
	var sweepBad []string
	for _, s := range sw {
		regions, accepted, noRoom = regions+s.regions, accepted+s.accepted, noRoom+s.noRoom
		sumCodes(codes, s.codes)
		sweepBad = append(sweepBad, s.bad...)
	}
	var targets int
	var histBad, lost []string
	for _, r := range rs {
		targets += r.reachTargets
		histBad = append(histBad, r.reachBad...)
		lost = append(lost, r.scaffoldLost...)
	}
	p("")
	p("## Reachable on every history and with pins")
	p("")
	p("**The pin sweep.** On %s seeds (`content-sweep-<n>`), a fresh world places one designer pin, a site or a dungeon slot drawn under `harness.pin`, reach 1 to %d, on a free passable tile of each region in the first two rings round the first settlement's, through `Reserve` and so every pin validator. Every accepted pin's tile must be passable, a walk of at most %d tiles from the first settlement over baseline passability, and inside its region's budgets: sites-max sites and one dungeon or relay.", comma(int64(len(sw))), sweepReachMost, reachWalk)
	p("")
	p("| Regions | Accepted | Refused | No free tile | Failing |")
	p("| --- | --- | --- | --- | --- |")
	refused := total(codes)
	p("| %s | %s | %s (%s) | %d | %d |", comma(int64(regions)), comma(int64(accepted)), comma(int64(refused)), either(len(codes) > 0, mapList(codes), "none"), noRoom, len(sweepBad))
	listBad(p, "Failing", sweepBad)
	p("")
	p("**The histories.** At each history's end, every pinned slot and every dungeon entrance drawn from history must be a walk of at most %d tiles from the first settlement: %s of them, %d failing. An entrance whose slot the scaffold put where no walk reaches (gen's sites, the same at 366429aa: spike E's structures-reachable holds pattern points and settlements, not a region's own dungeon sites) is listed apart, %d of them; the explorer visits along its spiral, not on foot.", reachWalk, comma(int64(targets)), len(histBad), len(lost))
	listBad(p, "Failing", histBad)
	listBad(p, "Scaffold slots no walk reaches", lost)
	return Measured{"content-reachable", fmt.Sprintf("sweep: %s of %s pins accepted on %s seeds, %d failing; histories: %s slots and entrances, %d failing, %d on scaffold slots no walk reaches", comma(int64(accepted)), comma(int64(regions-noRoom)), comma(int64(len(sw))), len(sweepBad), comma(int64(targets)), len(histBad), len(lost)),
		accepted > 0 && len(sweepBad) == 0 && len(histBad) == 0}
}

func busyRow(p func(string, ...any), r busyResult) Measured {
	ok := r.tiles > 0 && r.day300*100 <= r.day1*costFlat
	most1, most300 := int64(0), int64(0)
	med1, med300 := int64(0), int64(0)
	if r.tiles > 0 {
		most1, most300 = r.cost1[len(r.cost1)-1], r.cost300[len(r.cost300)-1]
		med1, med300 = percentile(r.cost1, 50), percentile(r.cost300, 50)
	}
	ok = ok && most300 <= r.bound
	ratio := 0.0
	if r.day1 > 0 {
		ratio = 100 * float64(r.day300) / float64(r.day1)
	}
	p("")
	p("## A draw costs the same on day 1 and day %d", busyDays)
	p("")
	p("The busy world: the warring history under `content-busy-0`, to day %d, with %s located heavy facts (`faction.raided` and `region.surge`, alternately) noted every day at tiles drawn under `harness.busy`: %s facts in all, %d index cells at the end, %s tiles reached. The sample is the disc of %d tiles just past where the explorer stands on day %d, and the facts land within history-radius of it, so the index cells every sample tile reads are at history-cell-kept from day 1 and only the world's age differs. On every sample tile still unreached, `DigestAt` plus `gen.Content` is timed on day %d against a snapshot of day 1, the two in turn tile by tile, the least of %d tries each (one core).", busyDays, comma(busyFacts), comma(int64(r.facts)), r.cells, comma(int64(r.reachedN)), busyTiles, busyDays, busyDays, busyRounds)
	p("")
	p("| Day | Median draw | Visits (median) | Visits (most) |")
	p("| --- | --- | --- | --- |")
	p("| 1 | %s | %d | %d |", micros(r.day1), med1, most1)
	p("| %d | %s | %d | %d |", busyDays, micros(r.day300), med300, most300)
	p("")
	p("Visits are what `DigestCost` counts: index entries, disc tiles, pins and finds. The bound is %d: %d cells of history-cell-kept, the history-radius disc, %d cells of pins-per-cell and %d regions of %d find kinds.", r.bound, history.CellsRead, history.CellsRead, history.CellsRead, history.FindKinds)
	return Measured{"content-cost-flat", fmt.Sprintf("day %d median %s, day 1 %s (%.0f%%, at most %d%%); visits at most %d on day 1 and %d on day %d, bound %d", busyDays, micros(r.day300), micros(r.day1), ratio, costFlat, most1, most300, busyDays, r.bound), ok}
}

// micros is a duration to a tenth of a microsecond.
func micros(d time.Duration) string { return fmt.Sprintf("%.1f µs", float64(d.Nanoseconds())/1000) }

func dungeonRow(p func(string, ...any), rs []historyResult) Measured {
	var plans, forks int
	var bad []string
	for _, r := range rs {
		plans, forks = plans+r.plans, forks+r.forks
		bad = append(bad, r.dungeonBad...)
	}
	p("")
	p("## Dungeons drawn from history keep MM8's rules")
	p("")
	p("Every dungeon plan drawn from history at the end of every history: its floors within its kind's and %d to %d, its kind's guardian, and every floor above the bottom forking into three ways drawn as a delve at the end would draw them (`DrawWays` under the plan's key and the entrance's digest then), each a distinct `map.forks` row of its kind with 1 to %d tags; the bottom forks into none. %s plans, %s forks, %d failing.", dungeonFloorsLeast, dungeonFloorsMost, waysTagsMost, comma(int64(plans)), comma(int64(forks)), len(bad))
	listBad(p, "Failing", bad)
	return Measured{"content-dungeons", fmt.Sprintf("%s plans and %s forks drawn from history, %d failing", comma(int64(plans)), comma(int64(forks)), len(bad)), plans > 0 && len(bad) == 0}
}

// drewSection reports what each history's draws gave, for tuning
// map.content-weights.
func drewSection(p func(string, ...any), b *sheets.Book, rs []historyResult) {
	names := nameIndex(b)
	label := func(sheet, id string) string { return cmp.Or(names[sheet+":"+id], id) }
	p("")
	p("## What each history drew")
	p("")
	p("Over every seed's reached tiles at the end, native ones aside: site kinds on site slots, dungeon kinds, the stock band of every material, and how often the lead is the region's own creature.")
	p("")
	p("| History | Site kinds | Dungeon kinds | Stock bands | Lead is the region's creature |")
	p("| --- | --- | --- | --- | --- |")
	for _, name := range historyNames {
		sk, dk, bands := map[string]int{}, map[string]int{}, map[string]int{}
		var leads, region int
		for _, r := range byHistory(rs, name) {
			for k, v := range r.siteKinds {
				sk[label("map.site-kinds", k)] += v
			}
			for k, v := range r.dungeonKinds {
				dk[label("map.dungeons", k)] += v
			}
			sumCodes(bands, r.bands)
			leads, region = leads+r.leads, region+r.leadRegion
		}
		p("| %s | %s | %s | %s | %.1f%% of %s |", name, mapList(sk), mapList(dk), mapList(bands), pct(region, leads), comma(int64(leads)))
	}
}
