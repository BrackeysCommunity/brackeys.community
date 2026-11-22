package game_test

import (
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// The servers a pin test plays from, each with a guild of its own.
const (
	pinServerA = "srv-a"
	pinServerB = "srv-b"
	pinLabelA  = "Server A"
	// pinSearch is how far from the first settlement a test looks for a
	// tile a pin may stand on.
	pinSearch = 40
)

type pinGame struct {
	t *testing.T
	g *game.Game
	n int
}

func newPinGame(t *testing.T) *pinGame {
	t.Helper()
	g, err := game.New(testkit.Rules(t, testkit.Book(t), keys.Throwaway("pins-test")))
	if err != nil {
		t.Fatal(err)
	}
	return &pinGame{t: t, g: g}
}

func (p *pinGame) key() string {
	p.n++
	return "pin-test-" + strconv.Itoa(p.n)
}

// create is a new character from a server, one of its admins when admin
// is set, with the tick run so its arrival is discovered.
func (p *pinGame) create(server string, admin bool) *game.Char {
	p.t.Helper()
	res, err := p.g.Act(game.Command{Key: p.key(), Kind: game.Create, Server: server, Note: server, Admin: admin})
	if err != nil {
		p.t.Fatal(err)
	}
	p.advance(1)
	return res.Char
}

func (p *pinGame) advance(n int) {
	p.t.Helper()
	for range n {
		if _, err := p.g.Advance(); err != nil {
			p.t.Fatal(err)
		}
	}
}

func (p *pinGame) digest() canon.Sum {
	p.t.Helper()
	d, err := p.g.Digest()
	if err != nil {
		p.t.Fatal(err)
	}
	return d
}

// act sends a world-level command, keyed afresh.
func (p *pinGame) act(kind string, pc *game.PinCmd) (game.Result, error) {
	return p.g.Act(game.Command{Key: p.key(), Kind: kind, Pin: pc})
}

// pin sends a pin command that must be accepted, and returns the pin it
// made or changed.
func (p *pinGame) pin(kind string, pc game.PinCmd) world.Pin {
	p.t.Helper()
	before := len(p.g.World.Pins)
	if _, err := p.act(kind, &pc); err != nil {
		p.t.Fatalf("%s at %s: %v", kind, pc.At.Ref(), err)
	}
	if kind == game.PinWithdraw {
		i := slices.IndexFunc(p.g.World.Pins, func(x world.Pin) bool { return x.ID == pc.Pin })
		return p.g.World.Pins[i]
	}
	if len(p.g.World.Pins) != before+1 {
		p.t.Fatalf("%s kept no pin", kind)
	}
	return p.g.World.Pins[before]
}

// refused sends a command that must be refused with code, and checks the
// game's digest is what it was.
func (p *pinGame) refused(code, kind string, pc *game.PinCmd) {
	p.t.Helper()
	before := p.digest()
	_, err := p.act(kind, pc)
	var r *game.Refused
	if !errors.As(err, &r) || r.Code != code {
		p.t.Fatalf("%s: %v, want a %s refusal", kind, err, code)
	}
	if after := p.digest(); after != before {
		p.t.Fatalf("a %s refusal of %s moved the digest from %s to %s", code, kind, before, after)
	}
}

func (p *pinGame) home() hex.Hex { return p.g.SettlementHex(0) }

func (p *pinGame) region(h hex.Hex) gen.LatticeID { return p.g.Rules().Gen.RegionOf(h) }

// leadFix fixes a tile's lead creature to the last of its archetypes.
func (p *pinGame) leadFix(h hex.Hex) tile.Fix {
	a := p.g.Rules().Gen.Archetypes(h)
	if len(a) == 0 {
		return tile.Fix{}
	}
	return tile.Fix{Lead: a[len(a)-1]}
}

// tiles are up to n tiles round the first settlement, nearest first,
// where the world would take a reserve with fix from by, and keep.
func (p *pinGame) tiles(n int, by world.PinBy, fix func(hex.Hex) tile.Fix, keep func(hex.Hex) bool) []hex.Hex {
	var out []hex.Hex
	for r := int64(1); r <= pinSearch && len(out) < n; r++ {
		for _, h := range hex.Ring(p.home(), r) {
			f := fix(h)
			if f.Empty() || (keep != nil && !keep(h)) {
				continue
			}
			if p.g.World.CheckPin(h, 1, f, by, false) == nil {
				out = append(out, h)
				if len(out) == n {
					break
				}
			}
		}
	}
	if len(out) < n {
		p.t.Fatalf("found %d tiles a pin may stand on, wanted %d", len(out), n)
	}
	return out
}

// tileWith is a tile from least to most tiles round the first settlement
// where the world refuses a designer's reserve of fix with code.
func (p *pinGame) tileWith(code string, fix tile.Fix, least, most int64) (hex.Hex, bool) {
	by := world.PinBy{Role: world.PinDesigner}
	for r := least; r <= most; r++ {
		for _, h := range hex.Ring(p.home(), r) {
			var ref *world.Refusal
			if err := p.g.World.CheckPin(h, 1, fix, by, false); errors.As(err, &ref) && ref.Code == code {
				return h, true
			}
		}
	}
	return hex.Hex{}, false
}

func (p *pinGame) limit(role string) sheets.PinLimit {
	return *sheets.Lookup(p.g.Rules().Book.PinLimits)[role]
}

// A designer pins anywhere; an admin only in its settlement's region,
// with its reach clipped to it, once a day and never a dungeon; staff
// carry their points onto the pin and the tile it lands on.
func TestPinRoles(t *testing.T) {
	p := newPinGame(t)
	admin := p.create(pinServerA, true)
	staff := p.create(pinServerA, false)
	other := p.create(pinServerB, true)
	home := p.region(p.home())
	if p.region(admin.C.At) != home || !p.g.ServerGuild(pinServerB).Waiting {
		t.Fatal("server A's guild does not run the first settlement, or server B's runs one")
	}
	designer := world.PinBy{Role: world.PinDesigner}
	inHome := func(h hex.Hex) bool { return p.region(h) == home }
	outside := func(h hex.Hex) bool { return p.region(h) != home }

	away := p.tiles(1, designer, p.leadFix, outside)[0]
	d := p.pin(game.PinReserve, game.PinCmd{At: away, Reach: p.limit(world.PinDesigner).ReachMax, Fix: p.leadFix(away)})
	if d.By.Role != world.PinDesigner || d.By.Region != nil || d.By.Label != "" || d.By.Points != 0 {
		t.Fatalf("a designer's pin reads %+v", d.By)
	}

	// The admin's tile must have a neighbour in reach that lies in another
	// region, to show the clip.
	reach := p.limit(world.PinAdmin).ReachMax
	crosses := func(h hex.Hex) bool {
		return inHome(h) && slices.ContainsFunc(hex.DiscAt(h, reach), outside)
	}
	at := p.tiles(3, designer, p.leadFix, crosses)
	p.refused(world.CodePinFix, game.PinReserve, &game.PinCmd{At: at[0], Reach: 1, Fix: tile.Fix{Dungeon: p.g.Rules().Book.Dungeons[0].ID}, As: world.PinAdmin, For: admin.C.ID, Label: pinLabelA})
	p.refused(world.CodePinFix, game.PinReserve, &game.PinCmd{At: at[0], Reach: 1, Fix: tile.Fix{Stock: p.g.Rules().Book.StockBands[0].ID}, As: world.PinAdmin, For: admin.C.ID, Label: pinLabelA})
	p.refused(world.CodePinAnchor, game.PinReserve, &game.PinCmd{At: away, Reach: 1, Fix: p.leadFix(away), As: world.PinAdmin, For: admin.C.ID, Label: pinLabelA})
	p.refused(world.CodePinAnchor, game.PinReserve, &game.PinCmd{At: at[0], Reach: 1, Fix: p.leadFix(at[0]), As: world.PinAdmin, For: staff.C.ID, Label: pinLabelA})
	p.refused(world.CodePinAnchor, game.PinReserve, &game.PinCmd{At: at[0], Reach: 1, Fix: p.leadFix(at[0]), As: world.PinAdmin, For: other.C.ID, Label: pinLabelA})
	p.refused(world.CodePinAnchor, game.PinReserve, &game.PinCmd{At: at[0], Reach: 1, Fix: p.leadFix(at[0]), As: world.PinAdmin, For: admin.C.ID})

	a := p.pin(game.PinReserve, game.PinCmd{At: at[0], Reach: reach, Fix: p.leadFix(at[0]), As: world.PinAdmin, For: admin.C.ID, Label: pinLabelA})
	if a.By.Role != world.PinAdmin || a.By.Server != pinServerA || a.By.Char != admin.C.ID || a.By.Label != pinLabelA || a.By.Region == nil || *a.By.Region != home {
		t.Fatalf("an admin's pin reads %+v", a.By)
	}
	t1 := p.g.Tick() + 1
	for _, h := range hex.DiscAt(at[0], reach) {
		if want := inHome(h); slices.Contains(p.g.World.PinsAt(h, t1), a.ID) != want {
			t.Fatalf("an admin's pin at %s covers %s: %v, want %v (clipped to its region)", at[0].Ref(), h.Ref(), !want, want)
		}
	}
	p.refused(world.CodePinBudget, game.PinReserve, &game.PinCmd{At: at[1], Reach: 1, Fix: p.leadFix(at[1]), As: world.PinAdmin, For: admin.C.ID, Label: pinLabelA})

	s := p.pin(game.PinReserve, game.PinCmd{At: at[1], Reach: 2, Fix: p.leadFix(at[1]), As: world.PinStaff, For: staff.C.ID, Label: pinLabelA})
	if s.By.Role != world.PinStaff || s.By.Points != p.limit(world.PinStaff).Points || s.By.Points == 0 {
		t.Fatalf("a staff pin reads %+v, want %d points", s.By, p.limit(world.PinStaff).Points)
	}
	p.pin(game.PinReserve, game.PinCmd{At: at[2], Reach: 1, Fix: p.leadFix(at[2]), As: world.PinStaff, For: admin.C.ID, Label: pinLabelA})

	// A server withdraws only its own pins.
	p.refused(world.CodePinAnchor, game.PinWithdraw, &game.PinCmd{Pin: s.ID, As: world.PinAdmin, For: other.C.ID})

	// The next world day gives the admin its pin again.
	p.advance(int(sheets.TicksPerDay))
	more := p.tiles(1, designer, p.leadFix, func(h hex.Hex) bool { return inHome(h) && !slices.Contains(at, h) })[0]
	p.pin(game.PinReserve, game.PinCmd{At: more, Reach: 1, Fix: p.leadFix(more), As: world.PinAdmin, For: admin.C.ID, Label: pinLabelA})

	for _, h := range []hex.Hex{at[0], at[1]} {
		if err := p.g.World.Reach(p.g.Log, h, p.g.Tick()+1); err != nil {
			t.Fatal(err)
		}
	}
	ca, cs := p.g.World.Content(at[0]), p.g.World.Content(at[1])
	if ca == nil || ca.Pin != a.ID || ca.Lead != p.leadFix(at[0]).Lead || ca.Placed == nil || *ca.Placed != (tile.Placed{By: tile.PlacedAdmins, Server: pinServerA, Label: pinLabelA}) {
		t.Fatalf("the admin's pin landed as %+v", ca)
	}
	if cs == nil || cs.Placed == nil || *cs.Placed != (tile.Placed{By: tile.PlacedStaff, Server: pinServerA, Label: pinLabelA, Points: s.By.Points}) {
		t.Fatalf("the staff pin landed as %+v", cs)
	}
	w := p.pin(game.PinWithdraw, game.PinCmd{Pin: s.ID, As: world.PinStaff, For: staff.C.ID})
	if w.Withdrawn == 0 || p.g.World.Content(at[1]).Placed == nil {
		t.Fatal("a withdrawn landed pin did not stop counting, or its tile lost its content")
	}
}

// Every pin refusal and the freeze's on a drawing world: each is the
// world's code, and the game's digest does not move.
func TestPinRefusals(t *testing.T) {
	p := newPinGame(t)
	admin := p.create(pinServerA, true)
	designer := world.PinBy{Role: world.PinDesigner}
	free := p.tiles(2, designer, p.leadFix, nil)
	band := p.g.Rules().Book.StockBands[0].ID

	p.refused(game.BadArgs, game.PinReserve, nil)
	p.refused(world.CodePinReach, game.PinReserve, &game.PinCmd{At: free[0], Fix: p.leadFix(free[0])})
	p.refused(world.CodePinReach, game.PinReserve, &game.PinCmd{At: free[0], Reach: p.limit(world.PinDesigner).ReachMax + 1, Fix: p.leadFix(free[0])})
	p.refused(world.CodePinSeen, game.PinReserve, &game.PinCmd{At: admin.C.At, Reach: 1, Fix: tile.Fix{Stock: band}})
	p.refused(world.CodePinUnseen, game.PinEdit, &game.PinCmd{At: free[0], Fix: p.leadFix(free[0])})
	p.refused(world.CodePinFix, game.PinReserve, &game.PinCmd{At: free[0], Reach: 1})
	p.refused(world.CodePinFix, game.PinReserve, &game.PinCmd{At: free[0], Reach: 1, Fix: tile.Fix{SiteKind: "no-such-kind"}})
	p.refused(world.CodePinAnchor, game.PinReserve, &game.PinCmd{At: free[0], Reach: 1, Fix: p.leadFix(free[0]), As: world.PinAdmin, For: "c-404", Label: pinLabelA})
	p.refused(world.CodePinAnchor, game.PinReserve, &game.PinCmd{At: free[0], Reach: 1, Fix: p.leadFix(free[0]), Label: pinLabelA})
	p.refused(world.CodePinAnchor, game.PinReserve, &game.PinCmd{At: free[0], Reach: 1, Fix: p.leadFix(free[0]), As: "mayor"})
	p.refused(world.CodePinGone, game.PinWithdraw, &game.PinCmd{Pin: "pin-404"})
	p.refused(world.CodeAlreadyFrozen, game.ContentFreeze, nil)

	ground, ok := p.tileWith(world.CodePinGround, tile.Fix{Stock: band}, 1, pinSearch)
	if !ok {
		t.Fatal("no tile near the first settlement a pin may not stand on")
	}
	p.refused(world.CodePinGround, game.PinReserve, &game.PinCmd{At: ground, Reach: 1, Fix: tile.Fix{Stock: band}})

	// A tile no walk of pin-path-tiles joins to known ground lies past
	// that walk from the first settlement, the only known ground.
	walk := sheets.IntParam(p.g.Rules().Book.MapParams, "pin-path-tiles")
	path, ok := p.tileWith(world.CodePinPath, tile.Fix{Stock: band}, walk+1, walk+pinPathSearch)
	if !ok {
		t.Fatal("no tile a pin's walk cannot join to known ground")
	}
	p.refused(world.CodePinPath, game.PinReserve, &game.PinCmd{At: path, Reach: 1, Fix: tile.Fix{Stock: band}})

	first := p.pin(game.PinReserve, game.PinCmd{At: free[0], Reach: 1, Fix: p.leadFix(free[0])})
	p.refused(world.CodePinTaken, game.PinReserve, &game.PinCmd{At: free[0], Reach: 1, Fix: tile.Fix{Stock: band}})

	// A full pin cell takes no more.
	size := p.limit(world.PinDesigner).ReachMax
	cell := func(h hex.Hex) [2]int64 { return [2]int64{hex.FloorDiv(h.Q, size), hex.FloorDiv(h.R, size)} }
	most := int(sheets.IntParam(p.g.Rules().Book.MapParams, "pins-per-cell"))
	same := func(h hex.Hex) bool { return cell(h) == cell(free[0]) }
	rest := p.tiles(most, designer, func(h hex.Hex) tile.Fix { return tile.Fix{Stock: band} }, same)
	for _, h := range rest[:most-1] {
		p.pin(game.PinReserve, game.PinCmd{At: h, Reach: 1, Fix: tile.Fix{Stock: band}})
	}
	p.refused(world.CodePinBudget, game.PinReserve, &game.PinCmd{At: rest[most-1], Reach: 1, Fix: tile.Fix{Stock: band}})
	p.pin(game.PinWithdraw, game.PinCmd{Pin: first.ID})
	p.refused(world.CodePinGone, game.PinWithdraw, &game.PinCmd{Pin: first.ID})

	// An entered dungeon's depth is fixed.
	h, floors := p.enteredDungeon()
	p.refused(world.CodePinEntered, game.PinEdit, &game.PinCmd{At: h, Fix: tile.Fix{Floors: floors}})
}

// pinPathSearch is how many rings past a pin's walk a pin-path tile is
// looked for, clear of the other starting settlements' walks.
const pinPathSearch = 60

// enteredDungeon is a dungeon entrance near the first settlement that a
// designer could edit, reached and with its first floor drawn, and the
// floors its plan holds.
func (p *pinGame) enteredDungeon() (hex.Hex, int64) {
	p.t.Helper()
	designer := world.PinBy{Role: world.PinDesigner}
	for r := int64(1); r <= pinSearch; r++ {
		for _, h := range hex.Ring(p.home(), r) {
			if _, ok := p.g.Rules().Gen.Dungeon(h); !ok {
				continue
			}
			if err := p.g.World.Reach(p.g.Log, h, p.g.Tick()+1); err != nil {
				p.t.Fatal(err)
			}
			plan, ok := p.g.Plan(h)
			if !ok || p.g.World.CheckPin(h, 1, tile.Fix{Floors: plan.Floors}, designer, true) != nil {
				continue
			}
			p.g.ReachFloor(h, 1, -1)
			return h, plan.Floors
		}
	}
	p.t.Fatal("no dungeon near the first settlement a designer may edit")
	return hex.Hex{}, 0
}

// pinTick is one tick's commands in a recorded pin run.
type pinTick struct {
	Tick     int64          `json:"tick"`
	Commands []game.Command `json:"commands"`
}

// Pin commands are recorded and replayed like any other: a run of
// reserves by every role, a walk onto one so it lands, an edit and a
// withdrawal, replayed from its snapshot, reaches the same digest and
// facts twice.
func TestPinCommandsReplay(t *testing.T) {
	p := newPinGame(t)
	admin := p.create(pinServerA, true)
	staff := p.create(pinServerA, false)
	walker := p.create("", false)
	snap, err := json.Marshal(p.g)
	if err != nil {
		t.Fatal(err)
	}
	from := fact.ID(p.g.Log.Len())
	home := p.region(p.home())
	designer := world.PinBy{Role: world.PinDesigner}
	gn := p.g.Rules().Gen
	walk := func(_, n hex.Hex) (int64, bool) { return 1, gn.Passable(gn.Baseline(n).Terrain) }
	var target hex.Hex
	var path []hex.Hex
	for _, h := range p.tiles(pinSearch, designer, p.leadFix, nil) {
		if hex.Distance(h, walker.C.At) < 3 {
			continue
		}
		if route, _, ok := hex.Path(walker.C.At, h, walk, 1, 0); ok && len(route) <= 8 {
			target, path = h, route
			break
		}
	}
	if path == nil {
		t.Fatal("no pinnable tile a short walk from the first settlement")
	}
	served := p.tiles(2, designer, p.leadFix, func(h hex.Hex) bool { return p.region(h) == home && !slices.Contains(path, h) })
	band := p.g.Rules().Book.StockBands[len(p.g.Rules().Book.StockBands)-1].ID

	var given []pinTick
	give := func(cmds ...game.Command) {
		for i := range cmds {
			cmds[i].Key = p.key()
			if _, err := p.g.Act(cmds[i]); err != nil {
				t.Fatalf("%s: %v", cmds[i].Kind, err)
			}
		}
		given = append(given, pinTick{Tick: p.g.Tick(), Commands: cmds})
	}
	start := p.g.Tick()
	give(
		game.Command{Kind: game.PinReserve, Pin: &game.PinCmd{At: target, Reach: 3, Fix: tile.Fix{Stock: band, Lead: p.leadFix(target).Lead}}},
		game.Command{Kind: game.PinReserve, Pin: &game.PinCmd{At: served[0], Reach: 4, Fix: p.leadFix(served[0]), As: world.PinAdmin, For: admin.C.ID, Label: pinLabelA}},
		game.Command{Kind: game.PinReserve, Pin: &game.PinCmd{At: served[1], Reach: 2, Fix: p.leadFix(served[1]), As: world.PinStaff, For: staff.C.ID, Label: pinLabelA}},
	)
	p.advance(1)
	for walker.C.At != target {
		if walker.Long != nil || walker.Fight != nil {
			p.advance(1)
			continue
		}
		next := path[slices.Index(path, walker.C.At)+1]
		give(game.Command{Kind: game.Step, Char: walker.C.ID, Dir: walker.C.At.DirectionTo(next)})
		p.advance(1)
		if p.g.Tick()-start > sheets.TicksPerDay {
			t.Fatal("the walker never reached the pinned tile")
		}
	}
	p.advance(2)
	c := p.g.World.Content(target)
	staffPin := p.g.World.Pins[slices.IndexFunc(p.g.World.Pins, func(x world.Pin) bool { return x.By.Role == world.PinStaff })]
	if c == nil || c.Pin == "" || c.Lead != p.leadFix(target).Lead {
		t.Fatalf("the reserve did not land: %+v", c)
	}
	give(
		game.Command{Kind: game.PinEdit, Pin: &game.PinCmd{At: target, Fix: tile.Fix{Stock: p.g.Rules().Book.StockBands[0].ID}}},
		game.Command{Kind: game.PinWithdraw, Pin: &game.PinCmd{Pin: staffPin.ID, As: world.PinStaff, For: staff.C.ID}},
	)
	p.advance(3)
	lean, _ := gn.StockUnits(p.g.Rules().Book.StockBands[0].ID)
	for m, n := range p.g.World.Content(target).Stock {
		if n != lean || p.g.Stock(target, m) != lean {
			t.Fatalf("the edit left %s at %d, want %d", m, n, lean)
		}
	}
	ticks := p.g.Tick() - start
	want := p.digest()
	facts, _ := json.Marshal(p.g.Log.Since(from))

	stored, err := json.Marshal(given)
	if err != nil {
		t.Fatal(err)
	}
	for run := range 2 {
		var cmds []pinTick
		if err := json.Unmarshal(stored, &cmds); err != nil {
			t.Fatal(err)
		}
		var g game.Game
		if err := json.Unmarshal(snap, &g); err != nil {
			t.Fatal(err)
		}
		g.Attach(p.g.Rules())
		at := 0
		for range ticks {
			if at < len(cmds) && cmds[at].Tick == g.Tick() {
				for _, cmd := range cmds[at].Commands {
					if _, err := g.Act(cmd); err != nil {
						t.Fatalf("replay %d, tick %d: %s: %v", run+1, g.Tick(), cmd.Kind, err)
					}
				}
				at++
			}
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
		}
		got, err := g.Digest()
		if err != nil {
			t.Fatal(err)
		}
		again, _ := json.Marshal(g.Log.Since(from))
		if at != len(cmds) || got != want || string(again) != string(facts) {
			t.Fatalf("replay %d reaches %s after %d of %d ticks of commands, the run %s", run+1, got, at, len(cmds), want)
		}
	}
}

// A slot a pin stores is not free ground: nobody founds a settlement on it.
func TestAPinnedSlotIsNotFreeGround(t *testing.T) {
	g, ts := society(t, 5)
	officer := ts[0]
	designer := world.PinBy{Role: world.PinDesigner}
	fix := tile.Fix{Site: gen.PlaceDungeon}
	site := freeTile(t, g, officer.c.C.At)
	far := sheets.IntParam(g.Rules().Book.SettlementParams, "found-distance")
	for _, h := range hex.DiscAt(officer.c.C.At, far*2) {
		b := g.Rules().Gen.Baseline(h)
		if b.Site != "" || !g.Rules().Gen.Passable(b.Terrain) || g.IsSettlement(h) || g.World.CheckPin(h, 1, fix, designer, false) != nil {
			continue
		}
		clear := true
		for _, o := range hex.DiscAt(h, far-1) {
			clear = clear && !g.IsSettlement(o)
		}
		if clear {
			site = h
			break
		}
	}
	officer.c.C.At = site
	const taken = "free, passable tile"
	if why := g.CharterAt(officer.c).Why; strings.Contains(why, taken) {
		t.Fatalf("the tile was refused before any pin: %s", why)
	}
	p := &pinGame{t: t, g: g}
	if err := g.World.CheckPin(site, 1, fix, designer, false); err != nil {
		t.Fatalf("no free tile takes a pin: %v", err)
	}
	p.pin(game.PinReserve, game.PinCmd{At: site, Reach: 1, Fix: fix})
	if err := g.World.Reach(g.Log, site, g.Tick()+1); err != nil {
		t.Fatal(err)
	}
	if c, ok := g.Content(site); !ok || c.Site == "" {
		t.Fatal("the pin did not land on the reached tile")
	}
	if why := g.CharterAt(officer.c).Why; !strings.Contains(why, taken) {
		t.Fatalf("a charter on a pinned slot: %q", why)
	}
	unchanged(t, officer, "founding on a pinned slot", game.Command{Kind: game.Found, Note: "Reedhold"})
}

// A tile a guild founded on holds no pin: its content would stand beside the
// settlement.
func TestAFoundedSettlementTakesNoPin(t *testing.T) {
	p := newPinGame(t)
	h := p.tiles(1, world.PinBy{Role: world.PinDesigner}, p.leadFix, nil)[0]
	p.g.Places = append(p.g.Places, &game.Place{N: len(p.g.Places), Hex: h, Lattice: -1, Name: "Reedhold"})
	for _, kind := range []string{game.PinReserve, game.PinEdit} {
		p.refused(world.CodePinGround, kind, &game.PinCmd{At: h, Reach: 1, Fix: p.leadFix(h)})
	}
}

// A party on the first floor of a dungeon that stores no floors has entered
// it: its depth is no longer the designer's to change.
func TestPinEditRefusedUnderADelvingParty(t *testing.T) {
	p := newPinGame(t)
	designer := world.PinBy{Role: world.PinDesigner}
	var at hex.Hex
	var floors int64
	for r := int64(1); r <= pinSearch && floors == 0; r++ {
		for _, h := range hex.Ring(p.home(), r) {
			if _, ok := p.g.Rules().Gen.Dungeon(h); !ok {
				continue
			}
			if err := p.g.World.Reach(p.g.Log, h, p.g.Tick()+1); err != nil {
				t.Fatal(err)
			}
			if plan, ok := p.g.Plan(h); ok && p.g.World.CheckPin(h, 1, tile.Fix{Floors: plan.Floors}, designer, true) == nil {
				at, floors = h, plan.Floors
				break
			}
		}
	}
	if floors == 0 {
		t.Fatal("no dungeon near the first settlement a designer may edit")
	}
	c := p.create(pinServerA, false)
	if err := p.g.Teleport(c, at); err != nil {
		t.Fatal(err)
	}
	c.C.Floor = 1
	before := len(p.g.World.Pins)
	p.refused(world.CodePinEntered, game.PinEdit, &game.PinCmd{At: at, Fix: tile.Fix{Floors: floors}})
	if len(p.g.World.Pins) != before {
		t.Fatal("a refused edit kept a pin")
	}
}

// An open Reach goal checked its floor against the plan an edit would change.
func TestPinEditRefusedUnderAReachGoal(t *testing.T) {
	p := newPinGame(t)
	designer := world.PinBy{Role: world.PinDesigner}
	var at hex.Hex
	var floors int64
	for r := int64(1); r <= pinSearch && floors == 0; r++ {
		for _, h := range hex.Ring(p.home(), r) {
			if _, ok := p.g.Rules().Gen.Dungeon(h); !ok {
				continue
			}
			if err := p.g.World.Reach(p.g.Log, h, p.g.Tick()+1); err != nil {
				t.Fatal(err)
			}
			if plan, ok := p.g.Plan(h); ok && p.g.World.CheckPin(h, 1, tile.Fix{Floors: plan.Floors}, designer, true) == nil {
				at, floors = h, plan.Floors
				break
			}
		}
	}
	if floors == 0 {
		t.Fatal("no dungeon near the first settlement a designer may edit")
	}
	x := &game.Goal{ID: "g-reach-pin", State: goal.Live, Cond: goal.Condition{Verb: goal.Reach, Dungeon: at.Ref(), Floor: 1, Count: 1}}
	i, _ := slices.BinarySearchFunc(p.g.Goals, x.ID, func(e *game.Goal, id string) int { return strings.Compare(e.ID, id) })
	p.g.Goals = slices.Insert(p.g.Goals, i, x)
	before := len(p.g.World.Pins)
	p.refused(world.CodePinEntered, game.PinEdit, &game.PinCmd{At: at, Fix: tile.Fix{Floors: floors}})
	if len(p.g.World.Pins) != before {
		t.Fatal("a refused edit kept a pin")
	}
	x.State = goal.Ended
	p.pin(game.PinEdit, game.PinCmd{At: at, Fix: tile.Fix{Floors: floors}})
}
