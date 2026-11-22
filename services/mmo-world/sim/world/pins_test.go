package world

import (
	"errors"
	"maps"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
)

var designer = PinBy{Role: PinDesigner}

// pinWorld founds a world that draws content from history.
func pinWorld(t testing.TB, label string) (*State, *fact.Mem) {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	k := keys.Throwaway(label)
	g, err := gen.New(b, k.Generation)
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(b, g, k.Roll)
	if err != nil {
		t.Fatal(err)
	}
	s.ContentVersion = ContentDrawn
	return s, &fact.Mem{}
}

func home(s *State) hex.Hex { return s.g.Settlement(0).Hex }

// pinFind is the first tile round home, nearest first, that ok accepts.
func pinFind(t testing.TB, s *State, from, to int64, ok func(hex.Hex) bool) hex.Hex {
	t.Helper()
	for r := from; r <= to; r++ {
		for _, h := range hex.Ring(home(s), r) {
			if ok(h) {
				return h
			}
		}
	}
	t.Fatalf("no tile %d to %d from home fits", from, to)
	return hex.Hex{}
}

// open reports whether a reserve could stand on h: passable, no place, no
// slot or landmark, unreached, with a path.
func (s *State) open(h hex.Hex) bool {
	b := s.g.Baseline(h)
	return s.g.Passable(b.Terrain) && !s.placeTile(h) && b.Site == "" && b.Landmark == "" && !s.reached(h) && s.ReserveAt(h) == nil
}

func (s *State) slot(site string) func(hex.Hex) bool {
	return func(h hex.Hex) bool {
		return s.g.Baseline(h).Site == site && !s.placeTile(h) && !s.reached(h) && s.ReserveAt(h) == nil
	}
}

func pinDigest(t testing.TB, s *State, log fact.Log) string {
	t.Helper()
	d, err := Digest(s, log)
	if err != nil {
		t.Fatal(err)
	}
	return d.String()
}

func codeOf(err error) string {
	var r *Refusal
	if errors.As(err, &r) {
		return r.Code
	}
	if err != nil {
		return "error: " + err.Error()
	}
	return ""
}

func mustPin(t testing.TB) func(*Pin, error) *Pin {
	return func(p *Pin, err error) *Pin {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
}

// discover enters tiles in the next tick, as arrivals do.
func discover(t testing.TB, s *State, log fact.Log, hs ...hex.Hex) {
	t.Helper()
	var acts []Action
	for _, h := range hs {
		acts = append(acts, Action{Kind: ActDiscover, Hex: h, By: fact.Ref{Kind: "character", ID: "c-1"}})
	}
	if _, _, err := Advance(s, log, acts, s.Tick+1); err != nil {
		t.Fatal(err)
	}
}

func staged(s *State, role string, at hex.Hex) PinBy {
	id := s.g.RegionOf(at)
	return PinBy{Role: role, Server: "srv-1", Char: "c-1", Label: "Test Server", Region: &id}
}

// Every refusal leaves the world and its ledger exactly as they were.
func TestPinRefusals(t *testing.T) {
	s, log := pinWorld(t, "pin-refusals")
	at := pinFind(t, s, 3, 30, s.open)
	rich := tile.Fix{Stock: "rich"}

	seen := pinFind(t, s, 2, 30, func(h hex.Hex) bool { return s.open(h) && h != at })
	discover(t, s, log, seen)

	site := pinFind(t, s, 1, 40, s.slot(gen.SiteOrdinary))
	dungeon := pinFind(t, s, 1, 60, s.slot(gen.PlaceDungeon))
	water := pinFind(t, s, 1, 60, func(h hex.Hex) bool { return !s.g.Passable(s.g.Baseline(h).Terrain) })
	other := pinFind(t, s, 3, 40, func(h hex.Hex) bool { return s.open(h) && s.g.RegionOf(h) != s.g.RegionOf(at) })
	// Ground cut off by water: passable, with no passable neighbour.
	cut := pinFind(t, s, 1, 200, func(h hex.Hex) bool {
		around := h.Neighbours()
		if !s.open(h) || slices.ContainsFunc(around[:], func(n hex.Hex) bool { return s.g.Passable(s.g.Baseline(n).Terrain) }) {
			return false
		}
		return !s.pathFrom(h, s.mp("pin-path-tiles"))
	})
	noLead := at
	var wrongMark, wrongLead string
	for _, m := range s.b.Landmarks {
		if !slices.Contains(m.Terrains, s.g.Baseline(at).Terrain) {
			wrongMark = m.ID
		}
	}
	for _, c := range s.b.Creatures {
		if !slices.Contains(s.g.Archetypes(noLead), c.ID) {
			wrongLead = c.ID
		}
	}

	taken := pinFind(t, s, 3, 30, func(h hex.Hex) bool { return s.open(h) && h != at && s.g.RegionOf(h) != s.g.RegionOf(at) })
	mustPin(t)(s.Reserve(log, taken, 2, rich, designer))

	entered := pinFind(t, s, 1, 60, func(h hex.Hex) bool { return s.slot(gen.PlaceDungeon)(h) && h != dungeon })
	discover(t, s, log, entered)
	s.touch(entered).Dungeon = &tile.Dungeon{}

	reached := pinFind(t, s, 2, 30, func(h hex.Hex) bool { return s.open(h) && h != at && h != taken })
	discover(t, s, log, reached)

	gone := mustPin(t)(s.Reserve(log, pinFind(t, s, 3, 30, func(h hex.Hex) bool {
		return s.open(h) && h != at && s.cellOfPin(h) != s.cellOfPin(taken)
	}), 2, rich, designer))
	if _, err := s.Withdraw(log, gone.ID); err != nil {
		t.Fatal(err)
	}

	admin := staged(s, PinAdmin, at)
	long := admin
	long.Label = strings.Repeat("x", int(s.mp("pin-label-max"))+1)
	lost := admin
	lost.Char = ""
	elsewhere := staged(s, PinAdmin, other)

	day := pinFind(t, s, 3, 40, func(h hex.Hex) bool { return s.open(h) && h != at && h != taken && h != reached })
	daily := staged(s, PinAdmin, day)
	mustPin(t)(s.Reserve(log, day, 2, tile.Fix{Lead: s.g.Archetypes(day)[0]}, daily))
	day2 := pinFind(t, s, 1, 40, func(h hex.Hex) bool {
		return s.open(h) && s.g.RegionOf(h) == s.g.RegionOf(day) && h != day && len(s.g.Archetypes(h)) > 0 && s.pathFrom(h, s.mp("pin-path-tiles"))
	})

	cases := []struct {
		name, code string
		do         func() error
	}{
		{"reach zero", CodePinReach, func() error { _, err := s.Reserve(log, at, 0, rich, designer); return err }},
		{"reach past the role's", CodePinReach, func() error {
			_, err := s.Reserve(log, at, s.pinLimit(PinDesigner).ReachMax+1, rich, designer)
			return err
		}},
		{"no such role", CodePinAnchor, func() error { _, err := s.Reserve(log, at, 2, rich, PinBy{Role: "mayor"}); return err }},
		{"admin outside its region", CodePinAnchor, func() error {
			_, err := s.Reserve(log, at, 2, tile.Fix{Lead: s.g.Archetypes(at)[0]}, elsewhere)
			return err
		}},
		{"admin label too long", CodePinAnchor, func() error {
			_, err := s.Reserve(log, at, 2, tile.Fix{Lead: s.g.Archetypes(at)[0]}, long)
			return err
		}},
		{"admin with no one placing it", CodePinAnchor, func() error {
			_, err := s.Reserve(log, at, 2, tile.Fix{Lead: s.g.Archetypes(at)[0]}, lost)
			return err
		}},
		{"reserve on a reached tile", CodePinSeen, func() error { _, err := s.Reserve(log, seen, 2, rich, designer); return err }},
		{"edit on an unreached tile", CodePinUnseen, func() error { _, err := s.EditPin(log, at, 2, rich, designer); return err }},
		{"a second reserve", CodePinTaken, func() error { _, err := s.Reserve(log, taken, 2, rich, designer); return err }},
		{"impassable", CodePinGround, func() error { _, err := s.Reserve(log, water, 2, rich, designer); return err }},
		{"a settlement", CodePinGround, func() error { _, err := s.Reserve(log, home(s), 2, rich, designer); return err }},
		{"a slot on a slot", CodePinGround, func() error {
			_, err := s.Reserve(log, site, 2, tile.Fix{Site: gen.SiteOrdinary}, designer)
			return err
		}},
		{"a landmark on a slot", CodePinGround, func() error {
			_, err := s.Reserve(log, site, 2, tile.Fix{Landmark: s.b.Landmarks[0].ID}, designer)
			return err
		}},
		{"empty", CodePinFix, func() error { _, err := s.Reserve(log, at, 2, tile.Fix{}, designer); return err }},
		{"no such band", CodePinFix, func() error { _, err := s.Reserve(log, at, 2, tile.Fix{Stock: "heaped"}, designer); return err }},
		{"no such slot", CodePinFix, func() error { _, err := s.Reserve(log, at, 2, tile.Fix{Site: "castle"}, designer); return err }},
		{"admin sets stock", CodePinFix, func() error { _, err := s.Reserve(log, at, 2, rich, admin); return err }},
		{"admin stands a dungeon", CodePinFix, func() error {
			_, err := s.Reserve(log, at, 2, tile.Fix{Site: gen.PlaceDungeon}, admin)
			return err
		}},
		{"site kind with no slot", CodePinFix, func() error { _, err := s.Reserve(log, at, 2, tile.Fix{SiteKind: "den"}, designer); return err }},
		{"site kind on a dungeon", CodePinFix, func() error {
			_, err := s.Reserve(log, dungeon, 2, tile.Fix{SiteKind: "den"}, designer)
			return err
		}},
		{"dungeon on a site", CodePinFix, func() error { _, err := s.Reserve(log, site, 2, tile.Fix{Dungeon: "bunker"}, designer); return err }},
		{"floors past the kind", CodePinFix, func() error {
			_, err := s.Reserve(log, dungeon, 2, tile.Fix{Dungeon: "server-vault", Floors: 7}, designer)
			return err
		}},
		{"floors with no dungeon", CodePinFix, func() error { _, err := s.Reserve(log, site, 2, tile.Fix{Floors: 4}, designer); return err }},
		{"a lead that does not live there", CodePinFix, func() error {
			_, err := s.Reserve(log, noLead, 2, tile.Fix{Lead: wrongLead}, designer)
			return err
		}},
		{"a landmark its terrain refuses", CodePinFix, func() error {
			_, err := s.Reserve(log, at, 2, tile.Fix{Landmark: wrongMark}, designer)
			return err
		}},
		{"a dungeon entered", CodePinEntered, func() error {
			_, err := s.EditPin(log, entered, 2, tile.Fix{Floors: 4}, designer)
			return err
		}},
		{"no way there", CodePinPath, func() error { _, err := s.Reserve(log, cut, 2, rich, designer); return err }},
		{"admin's second of the day", CodePinBudget, func() error {
			_, err := s.Reserve(log, day2, 2, tile.Fix{Lead: s.g.Archetypes(day2)[0]}, daily)
			return err
		}},
		{"withdrawn already", CodePinGone, func() error { _, err := s.Withdraw(log, gone.ID); return err }},
		{"no such pin", CodePinGone, func() error { _, err := s.Withdraw(log, "pin-999"); return err }},
	}
	if wrongMark == "" || wrongLead == "" {
		t.Fatal("every landmark or creature fits")
	}
	for _, c := range cases {
		before := pinDigest(t, s, log)
		if got := codeOf(c.do()); got != c.code {
			t.Errorf("%s: %q, want %q", c.name, got, c.code)
		}
		if after := pinDigest(t, s, log); after != before {
			t.Errorf("%s: the refusal changed the world", c.name)
		}
	}
	budgets(t)
}

// budgets: a region's sites, its one dungeon and one landmark.
func budgets(t *testing.T) {
	s, log := pinWorld(t, "pin-budgets")
	most := s.mp("sites-max")
	sitesIn := func(id gen.LatticeID) int64 { return int64(len(s.g.RegionSites(id))) }
	region := func(ok func(gen.LatticeID) bool) gen.LatticeID {
		return s.g.RegionOf(pinFind(t, s, 1, 80, func(h hex.Hex) bool {
			return s.open(h) && ok(s.g.RegionOf(h))
		}))
	}
	freeIn := map[gen.LatticeID][]hex.Hex{}
	free := func(id gen.LatticeID) []hex.Hex {
		if out, ok := freeIn[id]; ok {
			return slices.DeleteFunc(slices.Clone(out), func(h hex.Hex) bool { return !s.open(h) })
		}
		var out []hex.Hex
		for _, h := range s.g.RegionTiles(id) {
			if s.open(h) && s.pathFrom(h, s.mp("pin-path-tiles")) {
				out = append(out, h)
			}
		}
		freeIn[id] = out
		return out
	}
	refused := func(name, code string, err error) {
		t.Helper()
		if got := codeOf(err); got != code {
			t.Errorf("%s: %q, want %q", name, got, code)
		}
	}

	full := region(func(id gen.LatticeID) bool { return int64(len(free(id))) > most-sitesIn(id) })
	tiles := free(full)
	for k := sitesIn(full); k < most; k++ {
		h := tiles[0]
		tiles = tiles[1:]
		mustPin(t)(s.Reserve(log, h, 1, tile.Fix{Site: gen.SiteOrdinary}, designer))
	}
	before := pinDigest(t, s, log)
	_, err := s.Reserve(log, tiles[0], 1, tile.Fix{Site: gen.SiteOrdinary}, designer)
	refused("past sites-max", CodePinBudget, err)

	withDungeon := region(func(id gen.LatticeID) bool {
		return slices.Contains(slices.Collect(maps.Values(s.g.RegionSites(id))), gen.PlaceDungeon) && sitesIn(id) < most && len(free(id)) > 0
	})
	_, err = s.Reserve(log, free(withDungeon)[0], 1, tile.Fix{Site: gen.PlaceDungeon}, designer)
	refused("a second dungeon", CodePinBudget, err)

	fits := func(h hex.Hex) string {
		for _, m := range s.b.Landmarks {
			if slices.Contains(m.Terrains, s.g.Baseline(h).Terrain) {
				return m.ID
			}
		}
		return ""
	}
	withMark := region(func(id gen.LatticeID) bool {
		_, _, ok := s.g.RegionLandmark(id)
		return ok && slices.ContainsFunc(free(id), func(h hex.Hex) bool { return fits(h) != "" })
	})
	h := free(withMark)[slices.IndexFunc(free(withMark), func(h hex.Hex) bool { return fits(h) != "" })]
	_, err = s.Reserve(log, h, 1, tile.Fix{Landmark: fits(h)}, designer)
	refused("a second landmark", CodePinBudget, err)
	if pinDigest(t, s, log) != before {
		t.Error("a budget refusal changed the world")
	}
}

func contentSum(t testing.TB, c *tile.Content) string {
	t.Helper()
	d, err := canon.Digest(c)
	if err != nil {
		t.Fatal(err)
	}
	return d.String()
}

// A reserve changes no tile discovered before it and none outside its
// reach; the tiles inside it reached later list it. A server's pin skips
// the tiles of other regions.
func TestPinReach(t *testing.T) {
	a, logA := pinWorld(t, "pin-reach")
	b, logB := pinWorld(t, "pin-reach")
	const reach = 3
	at := pinFind(t, a, 8, 14, func(h hex.Hex) bool { return a.open(h) && a.pathFrom(h, a.mp("pin-path-tiles")) })
	var early, late []hex.Hex
	for _, h := range hex.DiscAt(home(a), 2) {
		if a.g.Passable(a.g.Baseline(h).Terrain) {
			early = append(early, h)
		}
	}
	for _, h := range hex.DiscAt(at, reach+2) {
		if a.g.Passable(a.g.Baseline(h).Terrain) && !slices.Contains(early, h) {
			late = append(late, h)
		}
	}
	for _, w := range []struct {
		s   *State
		log *fact.Mem
	}{{a, logA}, {b, logB}} {
		discover(t, w.s, w.log, early...)
	}
	pin := mustPin(t)(b.Reserve(logB, at, reach, tile.Fix{Stock: "rich"}, designer))
	for _, w := range []struct {
		s   *State
		log *fact.Mem
	}{{a, logA}, {b, logB}} {
		discover(t, w.s, w.log, late...)
	}

	listed := 0
	for _, h := range append(slices.Clone(early), late...) {
		ca, cb := a.Content(h), b.Content(h)
		if ca == nil || cb == nil {
			t.Fatalf("%s: reached with no content", h.Ref())
		}
		inside := slices.Contains(late, h) && hex.Distance(h, at) <= reach
		if !inside {
			if contentSum(t, ca) != contentSum(t, cb) {
				t.Errorf("%s, %d from the pin: content differs", h.Ref(), hex.Distance(h, at))
			}
			continue
		}
		listed++
		if !slices.Contains(cb.Digest.Pins, pin.ID) || slices.Contains(ca.Digest.Pins, pin.ID) {
			t.Errorf("%s: pins %v and %v, want %s on the pinned twin only", h.Ref(), ca.Digest.Pins, cb.Digest.Pins, pin.ID)
		}
	}
	if listed == 0 {
		t.Fatal("no tile inside the reach was reached")
	}
	units := fixed.PercentFloor(sheets.IntParam(b.b.TileParams, "node-stock"), sheets.Lookup(b.b.StockBands)["rich"].Percent)
	if c := b.Content(at); c.Pin != pin.ID || len(c.Stock) == 0 {
		t.Errorf("pinned tile holds %+v", c)
	} else {
		for m, n := range c.Stock {
			if n != units {
				t.Errorf("pinned tile's %s is %d, want %d", m, n, units)
			}
		}
	}

	// A server's pin is clipped to its region.
	edge := pinFind(t, b, 4, 30, func(h hex.Hex) bool {
		if !b.open(h) || !b.pathFrom(h, b.mp("pin-path-tiles")) || len(b.g.Archetypes(h)) == 0 {
			return false
		}
		return slices.ContainsFunc(hex.DiscAt(h, reach), func(n hex.Hex) bool {
			return b.g.RegionOf(n) != b.g.RegionOf(h) && b.g.Passable(b.g.Baseline(n).Terrain) && !b.reached(n)
		})
	})
	by := staged(b, PinAdmin, edge)
	clip := mustPin(t)(b.Reserve(logB, edge, reach, tile.Fix{Lead: b.g.Archetypes(edge)[0]}, by))
	var out, in hex.Hex
	for _, h := range hex.DiscAt(edge, reach) {
		got := slices.Contains(b.PinsAt(h, b.Tick+1), clip.ID)
		if want := b.g.RegionOf(h) == *by.Region; got != want {
			t.Errorf("%s: listed %v, want %v", h.Ref(), got, want)
		}
		if h != edge && b.g.Passable(b.g.Baseline(h).Terrain) && !b.reached(h) {
			if b.g.RegionOf(h) == *by.Region {
				in = h
			} else {
				out = h
			}
		}
	}
	if in == (hex.Hex{}) || out == (hex.Hex{}) {
		t.Fatalf("no open tile both sides of the border round %s", edge.Ref())
	}
	discover(t, b, logB, in, out)
	if !slices.Contains(b.Content(in).Digest.Pins, clip.ID) || slices.Contains(b.Content(out).Digest.Pins, clip.ID) {
		t.Errorf("clipped pin: %v in its region, %v outside", b.Content(in).Digest.Pins, b.Content(out).Digest.Pins)
	}
}

// A reserve lands once, at its tile's first reach: the fix overrides the
// draw, the label is stored, and one pin.landed names who staged it.
func TestPinLands(t *testing.T) {
	s, log := pinWorld(t, "pin-lands")
	site := pinFind(t, s, 2, 40, func(h hex.Hex) bool { return s.slot(gen.SiteOrdinary)(h) && s.pathFrom(h, s.mp("pin-path-tiles")) })
	by := staged(s, PinAdmin, site)
	p := mustPin(t)(s.Reserve(log, site, 2, tile.Fix{SiteKind: "den"}, by))
	if s.ReserveAt(site) == nil {
		t.Fatal("no reserve standing")
	}
	discover(t, s, log, site)
	discover(t, s, log, site)
	c := s.Content(site)
	want := &tile.Placed{By: tile.PlacedAdmins, Server: by.Server, Label: by.Label}
	if c.SiteKind != "den" || c.Pin != p.ID || c.Placed == nil || *c.Placed != *want {
		t.Errorf("landed content %+v placed %+v", c, c.Placed)
	}
	if s.ReserveAt(site) != nil || s.Pins[0].Landed == 0 {
		t.Error("the reserve did not land")
	}
	var landed []fact.Fact
	for _, f := range log.Since(0) {
		if f.Kind == factPinLanded {
			landed = append(landed, f)
		}
	}
	if len(landed) != 1 {
		t.Fatalf("%d pin.landed, want 1", len(landed))
	}
	f := landed[0]
	if at, ok := fact.HexOf(f); !ok || at != site || f.Region == "" {
		t.Errorf("pin.landed names %v %q", at, f.Region)
	}
	if f.StagedBy == nil || f.StagedBy.ID != by.Server || f.Weight != s.weights[factPinLanded] {
		t.Errorf("pin.landed staged by %v at weight %d", f.StagedBy, f.Weight)
	}
	for _, g := range log.Since(0) {
		if g.Kind == factPinReserved && (g.Region != "" || len(g.Subjects) > 0) {
			t.Errorf("pin.reserved names %q %v", g.Region, g.Subjects)
		}
	}

	// A staff pin records its points; a designer's stores no label.
	staff := pinFind(t, s, 2, 40, func(h hex.Hex) bool {
		return s.open(h) && s.pathFrom(h, s.mp("pin-path-tiles")) && len(s.g.Archetypes(h)) > 1 && s.cellOfPin(h) != s.cellOfPin(site)
	})
	sb := staged(s, PinStaff, staff)
	lead := s.g.Archetypes(staff)[1]
	mustPin(t)(s.Reserve(log, staff, 1, tile.Fix{Lead: lead}, sb))
	discover(t, s, log, staff)
	if c := s.Content(staff); c.Lead != lead || c.Placed == nil || c.Placed.By != tile.PlacedStaff || c.Placed.Points != s.pinLimit(PinStaff).Points {
		t.Errorf("staff pin landed as %+v placed %+v", c, c.Placed)
	}

	dungeon := pinFind(t, s, 2, 60, func(h hex.Hex) bool { return s.slot(gen.PlaceDungeon)(h) && s.pathFrom(h, s.mp("pin-path-tiles")) })
	native, _ := s.g.Dungeon(dungeon)
	k := s.b.Dungeons[slices.IndexFunc(s.b.Dungeons, func(k sheets.DungeonKind) bool {
		return k.Place == gen.PlaceDungeon && k.ID != native.Kind
	})]
	floors := k.FloorsMax
	if floors == native.Floors {
		floors = k.FloorsMin
	}
	mustPin(t)(s.Reserve(log, dungeon, 2, tile.Fix{Dungeon: k.ID, Floors: floors}, designer))
	discover(t, s, log, dungeon)
	if c := s.Content(dungeon); c.Dungeon == nil || c.Dungeon.Kind != k.ID || c.Dungeon.Floors != floors || c.Placed != nil {
		t.Errorf("dungeon pin landed as %+v plan %+v", c, c.Dungeon)
	}

	// An edit changes the reached tile's content and nothing else.
	others := map[hex.Hex]string{}
	for _, t2 := range s.Tiles {
		if t2.Content != nil && t2.Hex != site {
			others[t2.Hex] = contentSum(t, t2.Content)
		}
	}
	mustPin(t)(s.EditPin(log, site, 2, tile.Fix{SiteKind: "ruin"}, designer))
	if c := s.Content(site); c.SiteKind != "ruin" {
		t.Errorf("edited kind %q", c.SiteKind)
	}
	if !slices.Contains(s.Edited(), site) {
		t.Error("the edit is not listed for saving")
	}
	for h, d := range others {
		if contentSum(t, s.Content(h)) != d {
			t.Errorf("%s changed under an edit elsewhere", h.Ref())
		}
	}
}

// A reserve counts until it is withdrawn, or pin-days after it lands; an
// edit for pin-days after it is made; the day's turn prunes what stopped.
func TestPinAging(t *testing.T) {
	s, log := pinWorld(t, "pin-aging")
	span := s.mp("pin-days") * ticksPerDay
	tiles := make([]hex.Hex, 0, 3)
	for len(tiles) < cap(tiles) {
		tiles = append(tiles, pinFind(t, s, 3, 40, func(h hex.Hex) bool {
			return s.open(h) && s.pathFrom(h, s.mp("pin-path-tiles")) && !slices.ContainsFunc(tiles, func(o hex.Hex) bool { return s.cellOfPin(o) == s.cellOfPin(h) })
		}))
	}
	never := mustPin(t)(s.Reserve(log, tiles[0], 1, tile.Fix{Stock: "lean"}, designer)).ID
	lands := mustPin(t)(s.Reserve(log, tiles[1], 1, tile.Fix{Stock: "rich"}, designer)).ID
	gone := mustPin(t)(s.Reserve(log, tiles[2], 1, tile.Fix{Stock: "full"}, designer)).ID
	if got := s.PinsAt(tiles[0], s.Tick); len(got) != 0 {
		t.Errorf("a pin counted in its own tick: %v", got)
	}
	discover(t, s, log, tiles[1])
	landed := s.Pins[1].Landed
	if _, err := s.Withdraw(log, gone); err != nil {
		t.Fatal(err)
	}

	at := func(h hex.Hex, tick int64, id string) bool { return slices.Contains(s.PinsAt(h, tick), id) }
	if !at(tiles[1], landed+span-1, lands) || at(tiles[1], landed+span, lands) {
		t.Error("a landed reserve does not count for exactly pin-days")
	}
	if !at(tiles[0], landed+span*2, never) {
		t.Error("an unreached reserve stopped counting")
	}
	if at(tiles[2], s.Tick+1, gone) {
		t.Error("a withdrawn pin counts")
	}

	s.prunePins(s.Tick)
	if len(s.Pins) != 2 {
		t.Fatalf("%d pins after the prune, want 2", len(s.Pins))
	}
	s.prunePins(landed + span)
	if len(s.Pins) != 1 || s.Pins[0].ID != never {
		t.Fatalf("pins %v after pin-days", s.LivePins())
	}

	// The day's turn prunes on its own.
	discover(t, s, log, tiles[0])
	s.Pins[0].Landed = s.Tick - span
	for s.Tick%ticksPerDay != ticksPerDay-1 {
		if _, _, err := Advance(s, log, nil, s.Tick+1); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := Advance(s, log, nil, s.Tick+1); err != nil {
		t.Fatal(err)
	}
	if len(s.Pins) != 0 || len(s.LivePins()) != 0 {
		t.Errorf("pins %v outlived the day's turn", s.Pins)
	}

	edit := mustPin(t)(s.EditPin(log, tiles[1], 1, tile.Fix{Stock: "thin"}, designer))
	if !at(tiles[1], edit.Tick+span-1, edit.ID) || at(tiles[1], edit.Tick+span, edit.ID) {
		t.Error("an edit does not count for exactly pin-days")
	}
}

// A pin cell holds pins-per-cell pins; the next is over budget until one
// is withdrawn.
func TestPinCells(t *testing.T) {
	s, log := pinWorld(t, "pin-cells")
	most := s.mp("pins-per-cell")
	first := pinFind(t, s, 2, 30, func(h hex.Hex) bool { return s.open(h) && s.pathFrom(h, s.mp("pin-path-tiles")) })
	cell := s.cellOfPin(first)
	var ids []string
	var last hex.Hex
	for _, h := range hex.DiscAt(first, s.pinSize()) {
		if s.cellOfPin(h) != cell || !s.open(h) || !s.pathFrom(h, s.mp("pin-path-tiles")) {
			continue
		}
		if int64(len(ids)) == most {
			last = h
			break
		}
		ids = append(ids, mustPin(t)(s.Reserve(log, h, 1, tile.Fix{Stock: "plain"}, designer)).ID)
	}
	if int64(len(ids)) != most || last == (hex.Hex{}) {
		t.Fatalf("only %d open tiles in the cell", len(ids))
	}
	before := pinDigest(t, s, log)
	if _, err := s.Reserve(log, last, 1, tile.Fix{Stock: "plain"}, designer); codeOf(err) != CodePinBudget {
		t.Fatalf("the ninth pin: %v", err)
	}
	if pinDigest(t, s, log) != before {
		t.Error("the refusal changed the world")
	}
	if got := len(s.PinsAt(first, s.Tick+1)); int64(got) > s.mp("pins-in-reach-max") {
		t.Errorf("%d pins in reach", got)
	}
	if _, err := s.Withdraw(log, ids[0]); err != nil {
		t.Fatal(err)
	}
	mustPin(t)(s.Reserve(log, last, 1, tile.Fix{Stock: "plain"}, designer))
	if n := int64(len(s.pinCellAt(first))); n != most {
		t.Errorf("the cell indexes %d pins, want %d", n, most)
	}
}

func TestPinRefusesNativeWorld(t *testing.T) {
	s, log := pinWorld(t, "pin-native")
	s.ContentVersion = ContentNative
	at := pinFind(t, s, 3, 30, s.open)
	next, pins := s.NextPin, len(s.Pins)
	_, err := s.Reserve(log, at, 2, tile.Fix{Stock: "rich"}, designer)
	if got := codeOf(err); got != CodeContentNative {
		t.Fatalf("a v0 world took a pin: %q", got)
	}
	if s.NextPin != next || len(s.Pins) != pins {
		t.Fatal("the refusal changed the pins")
	}
}

func TestPinRefusesShareZeroKind(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	b.Dungeons = slices.Clone(b.Dungeons)
	i := slices.IndexFunc(b.Dungeons, func(k sheets.DungeonKind) bool { return k.Place == gen.PlaceDungeon && k.Share > 0 })
	if i < 0 {
		t.Fatal("no dungeon kind stands on a dungeon slot")
	}
	kind := b.Dungeons[i].ID
	b.Dungeons[i].Share = 0
	k := keys.Throwaway("pin-share-zero")
	g, err := gen.New(b, k.Generation)
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(b, g, k.Roll)
	if err != nil {
		t.Fatal(err)
	}
	s.ContentVersion = ContentDrawn
	dungeon := pinFind(t, s, 1, 60, s.slot(gen.PlaceDungeon))
	_, err = s.Reserve(&fact.Mem{}, dungeon, 2, tile.Fix{Dungeon: kind}, designer)
	if got := codeOf(err); got != CodePinFix {
		t.Fatalf("a share-0 kind was taken: %q", got)
	}
}
