package harness

import (
	"encoding/json"
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// The content run's histories (GDD 4.17): worlds with no characters and
// no service, a fact.Mem each, played by the explorer after a quiet start.
const (
	historyQuiet   = "quiet"
	historyWarring = "warring"
	historyOverrun = "overrun"
	historyPinned  = "pinned"

	historyStillDays   = 28  // unattended days before the explorer sets out
	historyExploreDays = 120 // explorer days after them
	twinDay            = 60  // the day content-differs splits its twins
	twinDays           = 30  // days both twins then run
	twinSample         = 300 // tiles of S, at most
	pinEvery           = 3   // explorer days between pins in the pinned history
	pinAheadMin        = 4   // a pin lands this many to pinAheadMax steps along the explorer's walk
	pinAheadMax        = 12
	pinReachLeast      = 2
	pinReachMost       = 12
)

// historyNames are the four histories in report order.
var historyNames = []string{historyQuiet, historyWarring, historyOverrun, historyPinned}

// historyBooks are the books the histories run on: the base book, and the
// warring and overrun copies.
func historyBooks(b *sheets.Book) map[string]*sheets.Book {
	return map[string]*sheets.Book{
		historyQuiet:   b,
		historyWarring: warringBook(b),
		historyOverrun: overrunBook(b),
		historyPinned:  b,
	}
}

// The warring book's cells: twice the factions, seated half as far apart;
// raids that wear a holding down more slowly, so borders last; every
// archetype expanding whenever it can until its holdings border another's,
// then raiding and betraying over any other move; betrayal that pays at
// any friendliness and comes round weekly; and grudges that last the whole
// history. That gives every week ten or more faction.raided or
// faction.betrayed facts.
const (
	warringRegionsPer      = 3   // factions.params regions-per-faction
	warringSeatSpacing     = 9   // factions.params seat-spacing
	warringRaidDamage      = 10  // factions.params raid-damage
	warringExpandFit       = 350 // factions.move-weights fit for expand
	warringRaidFit         = 400 // factions.move-weights fit for raid
	warringBetrayFit       = 300 // factions.move-weights fit for betray
	warringBetrayThreshold = 0   // factions.params betray-threshold
	warringBetrayCooldown  = 7   // factions.params betray-cooldown
	warringBetrayGrudge    = 150 // factions.params betray-grudge
)

func warringBook(b *sheets.Book) *sheets.Book {
	out := *b
	out.MoveWeights = slices.Clone(b.MoveWeights)
	for i := range out.MoveWeights {
		switch out.MoveWeights[i].Move {
		case "expand":
			out.MoveWeights[i].Fit = warringExpandFit
		case "raid":
			out.MoveWeights[i].Fit = warringRaidFit
		case "betray":
			out.MoveWeights[i].Fit = warringBetrayFit
		}
	}
	out.FactionParams = withParams(b.FactionParams, map[string]int64{
		"regions-per-faction": warringRegionsPer,
		"seat-spacing":        warringSeatSpacing,
		"raid-damage":         warringRaidDamage,
		"betray-threshold":    warringBetrayThreshold,
		"betray-cooldown":     warringBetrayCooldown,
		"betray-grudge":       warringBetrayGrudge,
	})
	return &out
}

// The overrun book's cells: world.params baseline-min and baseline-max
// (the band every gauge wakes in, threat's among them) and world.gauges
// threat's daily rise, so that most awake regions sit over the 900 line.
const (
	overrunBaselineMin = 550
	overrunBaselineMax = 850
	overrunThreatRise  = 40
)

func overrunBook(b *sheets.Book) *sheets.Book {
	out := *b
	out.WorldParams = withParams(b.WorldParams, map[string]int64{
		"baseline-min": overrunBaselineMin,
		"baseline-max": overrunBaselineMax,
	})
	out.Gauges = slices.Clone(b.Gauges)
	for i := range out.Gauges {
		if out.Gauges[i].ID == "threat" {
			out.Gauges[i].DailyRise = overrunThreatRise
		}
	}
	return &out
}

// withParams is a copy of rows with some whole-number cells set.
func withParams(rows []sheets.Param, set map[string]int64) []sheets.Param {
	out := slices.Clone(rows)
	for i := range out {
		if v, ok := set[out[i].ID]; ok {
			out[i].Value = fixed.FromInt(v)
		}
	}
	return out
}

// historyRun is one history being played.
type historyRun struct {
	name  string
	seed  int
	b     *sheets.Book
	g     *gen.Gen
	key   keys.Set
	s     *world.State
	log   fact.Log
	ex    *Explorer
	home  hex.Hex
	pins  bool
	d     *draw.Drawer
	fw    fact.Weights
	pinsP []world.Pin    // the pins reserved, as they were made
	codes map[string]int // pin refusals by code
}

// historyLabel is a history's throwaway key; the pinned history's pinless
// twin shares it.
func historyLabel(name string, seed int) string { return fmt.Sprintf("content-%s-%d", name, seed) }

func newHistory(b *sheets.Book, name string, seed int, pins bool) (*historyRun, error) {
	label := historyLabel(name, seed)
	g, k, err := newGen(b, label)
	if err != nil {
		return nil, err
	}
	s, err := world.New(b, g, k.Roll)
	if err != nil {
		return nil, err
	}
	home := g.Settlement(0).Hex
	return &historyRun{
		name: name, seed: seed, b: b, g: g, key: k, s: s, log: &fact.Mem{},
		ex: NewExplorer(home, explorerRadius), home: home, pins: pins,
		d: draw.NewDrawer(k.Roll), fw: fact.NewWeights(b.FactWeights), codes: map[string]int{},
	}, nil
}

// days plays n world days: unattended until historyStillDays, then the
// explorer's walk, with a pin before every pinEvery-th explorer day.
func (h *historyRun) days(n int, before func(*historyRun) error) error {
	for range n {
		if before != nil {
			if err := before(h); err != nil {
				return err
			}
		}
		var acts []world.Action
		if day := h.s.Day; day >= historyStillDays {
			if h.pins && (day-historyStillDays)%pinEvery == 0 {
				h.pin()
			}
			acts = h.ex.Day(h.s, explorerPerDay)
		}
		if err := h.s.AdvanceDayWith(h.log, acts); err != nil {
			return fmt.Errorf("%s seed %d day %d: %w", h.name, h.seed, h.s.Day, err)
		}
	}
	return nil
}

// historyLength is a whole history's days.
const historyLength = historyStillDays + historyExploreDays

// pin reserves one designer pin ahead of the explorer, with a fix drawn
// under harness.pin; a refusal is counted and never retried.
func (h *historyRun) pin() {
	day := draw.Int(h.s.Day)
	at, ok := h.ahead(h.d.Between(pinAheadMin, pinAheadMax, "harness.pin", day, draw.Str("ahead")))
	if !ok {
		return
	}
	fixes := h.fixesFor(at, day)
	if len(fixes) == 0 {
		return
	}
	fix := fixes[h.d.Below(uint64(len(fixes)), "harness.pin", day, draw.Str("fix"))]
	most := int64(pinReachMost)
	if l, ok := sheets.Lookup(h.b.PinLimits)[world.PinDesigner]; ok {
		most = min(most, l.ReachMax)
	}
	reach := h.d.Between(pinReachLeast, most, "harness.pin", day, draw.Str("reach"))
	p, err := h.s.Reserve(h.log, at, reach, fix, world.PinBy{Role: world.PinDesigner})
	if err != nil {
		code, ok := refusalCode(err)
		if !ok {
			code = err.Error()
		}
		h.codes[code]++
		return
	}
	h.pinsP = append(h.pinsP, *p)
}

// ahead is the first passable tile at least k steps along the explorer's
// walk, which it reaches within a day or two.
func (h *historyRun) ahead(k int64) (hex.Hex, bool) {
	for i := h.ex.at + int(k) - 1; i < len(h.ex.steps); i++ {
		if t := h.ex.steps[i]; h.g.Passable(h.g.Baseline(t).Terrain) {
			return t, true
		}
	}
	return hex.Hex{}, false
}

// fixesFor are the fixes a designer pin on at may draw from: a site kind
// on a site slot, a lead among the tile's archetypes, a stock band, and a
// dungeon (a new slot where the region's scaffold leaves room, or a kind
// on a dungeon slot).
func (h *historyRun) fixesFor(at hex.Hex, day draw.Part) []tile.Fix {
	pick := func(n int, what string) int {
		return int(h.d.Below(uint64(n), "harness.pin", day, draw.Str(what)))
	}
	b := h.g.Baseline(at)
	var out []tile.Fix
	if b.Site == gen.SiteOrdinary || b.Site == gen.SiteEdge {
		var kinds []string
		for _, k := range h.b.SiteKinds {
			if slices.Contains(k.Places, b.Site) {
				kinds = append(kinds, k.ID)
			}
		}
		if len(kinds) > 0 {
			out = append(out, tile.Fix{SiteKind: kinds[pick(len(kinds), "site-kind")]})
		}
	}
	if arch := h.g.Archetypes(at); len(arch) > 0 {
		out = append(out, tile.Fix{Lead: arch[pick(len(arch), "lead")]})
	}
	if len(h.b.StockBands) > 0 {
		out = append(out, tile.Fix{Stock: h.b.StockBands[pick(len(h.b.StockBands), "stock")].ID})
	}
	switch {
	case b.Site == "" && b.Landmark == "" && h.dungeonRoom(b.Region):
		out = append(out, tile.Fix{Site: gen.PlaceDungeon})
	case b.Site == gen.PlaceDungeon:
		var kinds []string
		for _, k := range h.b.Dungeons {
			if k.Place == gen.PlaceDungeon && k.Share > 0 {
				kinds = append(kinds, k.ID)
			}
		}
		if len(kinds) > 0 {
			out = append(out, tile.Fix{Dungeon: kinds[pick(len(kinds), "dungeon")]})
		}
	}
	return out
}

// dungeonRoom reports whether a region's scaffold holds no dungeon or
// relay and leaves a site to spare.
func (h *historyRun) dungeonRoom(id gen.LatticeID) bool {
	if int64(len(h.g.RegionSites(id)))+1 > sheets.IntParam(h.b.MapParams, "sites-max") {
		return false
	}
	for _, t := range h.g.RegionTiles(id) {
		if s := h.g.Baseline(t).Site; s == gen.PlaceDungeon || s == gen.PlaceRelay {
			return false
		}
	}
	return true
}

// state is a copy of the world as a snapshot round-trips it.
func (h *historyRun) state() (*world.State, error) {
	snap, err := json.Marshal(h.s)
	if err != nil {
		return nil, err
	}
	var s world.State
	if err := json.Unmarshal(snap, &s); err != nil {
		return nil, err
	}
	s.Attach(h.b, h.g, h.key.Roll)
	return &s, nil
}

// fork copies the history mid-run: the state through its snapshot, the
// log fact by fact, and the explorer at the same step.
func (h *historyRun) fork() (*historyRun, error) {
	s, err := h.state()
	if err != nil {
		return nil, err
	}
	log := &fact.Mem{}
	for _, f := range h.log.Since(0) {
		if _, err := log.Append(f); err != nil {
			return nil, err
		}
	}
	ex := *h.ex
	out := *h
	out.s, out.log, out.ex = s, log, &ex
	out.pinsP, out.codes = slices.Clone(h.pinsP), map[string]int{}
	return &out, nil
}

// note appends a located fact of kind at a tile and indexes it, as if the
// world had written it on its last tick.
func (h *historyRun) note(kind string, at hex.Hex) error {
	f, err := h.fw.New(h.s.Tick, kind, "", nil, nil, fact.At(at)...)
	if err != nil {
		return err
	}
	id, err := h.log.Append(f)
	if err != nil {
		return err
	}
	f.ID = id
	h.s.Note(f)
	return nil
}

// reached are the tiles holding content, in the state's tile order.
func (h *historyRun) reached() []*tile.State {
	var out []*tile.State
	for _, t := range h.s.Tiles {
		if t.Content != nil {
			out = append(out, t)
		}
	}
	return out
}

// contentDigests is every reached tile's content, canonically digested.
func (h *historyRun) contentDigests() (map[hex.Hex]string, error) {
	out := map[hex.Hex]string{}
	for _, t := range h.reached() {
		d, err := canon.Digest(t.Content)
		if err != nil {
			return nil, err
		}
		out[t.Hex] = d.String()
	}
	return out, nil
}

// weekly counts the faction.raided and faction.betrayed facts in each
// whole week of the log.
func weekly(log fact.Log, days int) []int {
	week := sheets.TicksPerDay * 7
	out := make([]int, days/7)
	for _, f := range log.Since(0) {
		if f.Kind != "faction.raided" && f.Kind != "faction.betrayed" {
			continue
		}
		if w := int((f.Tick - 1) / int64(week)); w >= 0 && w < len(out) {
			out[w]++
		}
	}
	return out
}

// overShare is the per cent of awake regions over the overrun line.
func overShare(s *world.State, b *sheets.Book) int {
	threat := s.GaugeIndex("threat")
	line := world.LineAt(b, "overrun")
	over := 0
	for _, r := range s.Regions {
		if r.Gauge[threat] >= line {
			over++
		}
	}
	return int(pct(over, len(s.Regions)))
}
