package game

import (
	"errors"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/class"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// taking gives a character an active class and these of its abilities.
func abTaking(c *Char, cls string, abilities ...string) {
	c.C.Classes = class.State{Earned: []class.Earned{{ID: cls}}, Active: []string{cls}, Abilities: abilities}
}

func abAct(t *testing.T, g *Game, cmd Command) {
	t.Helper()
	if _, err := g.Act(cmd); err != nil {
		t.Fatal(err)
	}
}

// refusedAs gives a command the rules must refuse with code, and expects
// the digest unchanged.
func abRefused(t *testing.T, g *Game, cmd Command, code string) {
	t.Helper()
	before, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	_, err = g.Act(cmd)
	var ref *Refused
	if !errors.As(err, &ref) || ref.Code != code {
		t.Fatalf("%s: want %s, got %v", cmd.Kind, code, err)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatalf("a refused %s changed the game", cmd.Kind)
	}
}

func abTicks(t *testing.T, g *Game, n int) {
	t.Helper()
	for range n {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
}

// fledHere lays a creature's track on a tile, as one that fled it does.
func abFled(t *testing.T, g *Game, h hex.Hex) string {
	t.Helper()
	arch := g.r.Book.Creatures[0].ID
	g.Pending = append(g.Pending, world.Action{Kind: world.ActVisit, Hex: h, By: fact.Ref{Kind: trackCreature, ID: arch}})
	abTicks(t, g, 1)
	return arch
}

// dungeonNear is the nearest dungeon entrance to a tile.
func abDungeon(t *testing.T, g *Game, from hex.Hex) (hex.Hex, int64) {
	t.Helper()
	if h, plan, ok := entrances(t, g, from, func(hex.Hex, gen.Plan) bool { return true }); ok {
		return h, plan.Floors
	}
	t.Fatal("no dungeon near")
	return hex.Hex{}, 0
}

// delving stands a character on a dungeon's floor.
func abDelving(c *Char, h hex.Hex, floor int64) {
	c.C.At, c.C.Floor = h, floor
	c.Delving = &Delving{Dungeon: h.Ref(), Way: noWay}
}

// GDD 5.9, Stalker tier 1: "Read the ground: tracks stay readable for 12
// ticks, not 6".
func TestAbilityReadTheGround(t *testing.T) {
	g := guardGame(t)
	plain, reader := mustCreate(t, g, "plain", "knife"), mustCreate(t, g, "reader", "knife")
	abTaking(reader, "stalker", "read-the-ground")
	base := g.trigger(TrigTrail).Window
	if g.trackWindow(plain) != base || g.trackWindow(reader) != g.r.Fight.Param("read-the-ground-ticks") {
		t.Fatalf("windows %d and %d; want %d and the read-the-ground-ticks cell", g.trackWindow(plain), g.trackWindow(reader), base)
	}
	if g.trackWindow(plain, reader) != g.trackWindow(reader) {
		t.Fatal("a party does not read the ground with its best tracker")
	}
	h := plain.C.At
	other := mustCreate(t, g, "passer", "knife")
	g.Pending = append(g.Pending, world.Action{Kind: world.ActVisit, Hex: h, By: char.Ref(other.C.ID)})
	abFled(t, g, h)
	other.C.At = h.Neighbour(0)
	abTicks(t, g, int(base)+1)
	if len(g.FledTracks(plain, h)) != 0 || len(g.Trails(plain, h)) != 0 {
		t.Fatalf("tracks %d ticks old are still readable without Read the ground", base+1)
	}
	if len(g.FledTracks(reader, h)) != 1 || len(g.Trails(reader, h)) != 1 {
		t.Fatalf("Read the ground lost tracks %d ticks old: %v, %v", base+1, g.FledTracks(reader, h), g.Trails(reader, h))
	}
}

// GDD 5.9, Stalker tier 15: "The long hunt: a creature that fled can be
// followed to its tile".
func TestAbilityTheLongHunt(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "hunter", "knife")
	arch := abFled(t, g, c.C.At)
	abRefused(t, g, Command{Key: "no", Char: c.C.ID, Kind: FollowTrack}, NoTrack)
	abTaking(c, "stalker", "the-long-hunt")
	k := g.FledTracks(c, c.C.At)
	if len(k) != 1 {
		t.Fatalf("tracks %v", k)
	}
	abAct(t, g, Command{Key: "follow", Char: c.C.ID, Kind: FollowTrack})
	if c.C.At != k[0].To || c.Fight == nil || c.Fight.E.Creature.Archetype != arch {
		t.Fatalf("followed to %v (track to %v), fight %+v", c.C.At, k[0].To, c.Fight)
	}
}

// partyOfTwo forms a party of two on one tile, the second following the
// first.
func abParty(t *testing.T, g *Game, start string) (l, f *Char) {
	t.Helper()
	l, f = mustCreate(t, g, "lead", start), mustCreate(t, g, "follow", start)
	abAct(t, g, Command{Key: "invite", Char: l.C.ID, Kind: PartyInvite, Target: f.C.ID})
	abAct(t, g, Command{Key: "join", Char: f.C.ID, Kind: PartyJoin, Target: l.C.ID})
	abAct(t, g, Command{Key: "follow", Char: f.C.ID, Kind: Follow})
	return l, f
}

// GDD 5.9, Chandler tier 10: "Convoy: a party following your route shares
// your ambush band".
func TestAbilityConvoy(t *testing.T) {
	g := guardGame(t)
	l, f := abParty(t, g, "knife")
	var h hex.Hex
	found := false
	for _, n := range hex.DiscAt(l.C.At, 6) {
		if len(g.Creatures(n)) > 0 && g.World.RegionAt(n) >= 0 {
			h, found = n, true
			break
		}
	}
	if !found {
		t.Fatal("no tile with creatures near")
	}
	abFled(t, g, h)
	g.World.Tile(h).Road = 1
	g.World.Regions[g.World.RegionAt(h)].Gauge[g.World.GaugeIndex(gaugeThreat)] = g.r.Book.RouteRisks[2].Threat
	l.C.At, f.C.At = h, h
	abTaking(l, "chandler", "road-sense")
	_, lead, _ := g.riskBand(l, h)
	_, follow, _ := g.riskBand(f, h)
	if lead >= follow {
		t.Fatalf("road sense gives the leader band %d, the follower %d", lead, follow)
	}
	if _, i, _ := g.routeBand(l, h); i != follow {
		t.Fatalf("without Convoy the party is ambushed at %d, not its worst %d", i, follow)
	}
	// The ambush on entering is drawn at that band: find a tick where the
	// two bands' draws differ.
	bands := g.r.Book.RouteRisks
	at := int64(-1)
	for tick := range int64(400) {
		hit := func(i int) bool {
			return g.r.draw.Percent(bands[i].Chance.Of(fixed.Hundredths), "game.ambush", draw.Str(l.C.ID), draw.Int(tick))
		}
		if hit(lead) != hit(follow) {
			at = tick
			break
		}
	}
	sprung := func(i int) bool {
		return g.r.draw.Percent(bands[i].Chance.Of(fixed.Hundredths), "game.ambush", draw.Str(l.C.ID), draw.Int(at))
	}
	if at < 0 || g.ambushed(l, h, at) != sprung(follow) {
		t.Fatal("the leader's ambush is not drawn at the party's worst band")
	}
	abTaking(l, "chandler", "road-sense", "convoy")
	if _, i, _ := g.routeBand(l, h); i != lead {
		t.Fatalf("with Convoy the party is ambushed at %d, not the leader's %d", i, lead)
	}
	if g.ambushed(l, h, at) != sprung(lead) {
		t.Fatal("with Convoy the leader's ambush is not drawn at its own band")
	}
	abAct(t, g, Command{Key: "unfollow", Char: f.C.ID, Kind: Unfollow})
	abTaking(l, "chandler", "road-sense")
	if _, i, _ := g.routeBand(l, h); i != lead {
		t.Fatal("a member who does not follow sets the leader's band")
	}
}

// GDD 5.9, Chandler tier 15: "Caravan-master: mounts in your party need
// no upkeep on the road".
func TestAbilityCaravanMaster(t *testing.T) {
	g := guardGame(t)
	l, f := abParty(t, g, "knife")
	abAct(t, g, Command{Key: "grant", Char: f.C.ID, Kind: Grant, Asset: "rad-goat", Note: "test mount"})
	base := g.r.Mounts.Upkeep(1, 0)
	if base <= 0 || g.mountUpkeep(f, base) != base {
		t.Fatalf("a party member's mount owes %d of %d with no caravan master", g.mountUpkeep(f, base), base)
	}
	abTaking(l, "chandler", "caravan-master")
	if g.mountUpkeep(f, base) != 0 || g.mountUpkeep(l, base) != 0 {
		t.Fatalf("a caravan master's party still owes %d", g.mountUpkeep(f, base))
	}
	for g.Tick() < sheets.TicksPerDay {
		abTicks(t, g, 1)
	}
	if f.Owed != 0 {
		t.Fatalf("a mount in a caravan master's party owed %d at the day's upkeep", f.Owed)
	}
}

// GDD 5.9, Delver tier 5: "Mapper: both ways down at a fork show their
// next beat's tags".
func TestAbilityMapper(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "mapper", "knife")
	h, _ := abDungeon(t, g, c.C.At)
	abDelving(c, h, 1)
	g.openFork(c, 1)
	seen := func() (n int) {
		f := g.Fork(c)
		if f == nil || len(f.Ways) < 2 {
			t.Fatalf("no fork: %+v", f)
		}
		for _, w := range f.Ways {
			if len(w.Next) > 0 {
				n++
			}
		}
		return n
	}
	if seen() != 0 {
		t.Fatal("a fork shows its next beats without Mapper")
	}
	abTaking(c, "delver", "mapper")
	if n := seen(); n < 2 {
		t.Fatalf("Mapper sees %d ways ahead", n)
	}
}

// GDD 5.9, Delver tier 5: "Pack light: leaving a dungeon never costs a
// turn".
func TestAbilityPackLight(t *testing.T) {
	g := guardGame(t)
	plain, light := mustCreate(t, g, "plain", "knife"), mustCreate(t, g, "light", "knife")
	h, _ := abDungeon(t, g, plain.C.At)
	abTaking(light, "delver", "pack-light")
	for _, c := range []*Char{plain, light} {
		abDelving(c, h, 2)
		if err := g.climbOut(c, "climb-"+c.C.ID); err != nil {
			t.Fatal(err)
		}
	}
	if plain.C.Floor == 0 || plain.Long == nil || plain.Long.Kind != Climb || plain.Long.Due-g.Tick() != g.r.Fight.Param("leave-ticks") {
		t.Fatalf("a plain delver's climb: floor %d, %+v", plain.C.Floor, plain.Long)
	}
	if light.C.Floor != 0 || light.Long != nil || light.Delving != nil {
		t.Fatalf("Pack light still climbs: floor %d, %+v", light.C.Floor, light.Long)
	}
}

// GDD 5.9, Delver tier 10: "Key-maker: make a key for a dungeon you have
// reached the bottom of".
func TestAbilityKeyMaker(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "smith", "knife")
	h, floors := abDungeon(t, g, c.C.At)
	c.C.At = h
	c.C.Deepest.Bump(h.Ref(), floors)
	m, n, ok := g.KeyCost(h)
	if !ok {
		t.Fatal("no key cost")
	}
	abAct(t, g, Command{Key: "stock", Char: c.C.ID, Kind: Correct, Asset: ledger.Material(m), Units: n, Note: "key stock"})
	abRefused(t, g, Command{Key: "no", Char: c.C.ID, Kind: KeyMake}, NoKeyMaker)
	abTaking(c, "delver", "key-maker")
	abAct(t, g, Command{Key: "key", Char: c.C.ID, Kind: KeyMake})
	if !slices.Contains(c.Keys, h.Ref()) || g.balance(c, ledger.Material(m)) != 0 {
		t.Fatalf("keys %v, %d %s left", c.Keys, g.balance(c, ledger.Material(m)), m)
	}
	audit(t, g)
}

// GDD 5.9, Delver tier 15: "The way back: carry a downed character up
// without a beat per floor".
func TestAbilityTheWayBack(t *testing.T) {
	g := guardGame(t)
	plain, back := mustCreate(t, g, "plain", "knife"), mustCreate(t, g, "back", "knife")
	h, _ := abDungeon(t, g, plain.C.At)
	abTaking(back, "delver", "the-way-back")
	for _, c := range []*Char{plain, back} {
		abDelving(c, h, 3)
		if err := g.carryUp(c, "up-"+c.C.ID); err != nil {
			t.Fatal(err)
		}
	}
	if plain.Fight == nil || int64(len(plain.Fight.E.Beats)) != 3*g.r.Fight.Param("carry-up-beats") {
		t.Fatalf("a plain carry up from floor 3: %+v", plain.Fight)
	}
	if back.Fight != nil || (back.C.Floor != 0 && (back.Long == nil || back.Long.Kind != Climb)) {
		t.Fatalf("The way back still fights its way up: %+v, %+v", back.Fight, back.Long)
	}
}

// GDD 5.9, Delver tier 15: "Hoard-sense: the spoils pool of a floor is
// shown before you enter it".
func TestAbilityHoardSense(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "sense", "knife")
	h, _ := abDungeon(t, g, c.C.At)
	m := g.r.Book.Materials[0].ID
	if err := g.post(ledger.Move("seed-pool", "test", g.Tick(), ledger.FromOperator, ledger.FloorPool(h.Ref(), 2), ledger.Material(m), 3)); err != nil {
		t.Fatal(err)
	}
	if got := g.FloorPoolSeen(c, h, 2); got != nil {
		t.Fatalf("a floor's pool shown without Hoard sense: %v", got)
	}
	abTaking(c, "delver", "hoard-sense")
	if got := g.FloorPoolSeen(c, h, 2); item.Total(got) != 3 {
		t.Fatalf("Hoard sense sees %v of the pool", got)
	}
}

// GDD 5.9, Kindler tier 5: "Second slot: carry a second deck".
func TestAbilitySecondSlot(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "kindler", "deck")
	worn := c.C.In("off-hand", 0)
	k, ok := g.Kinds.Kind(worn.Kind)
	if worn == nil || !ok {
		t.Fatal("no deck")
	}
	spare := item.NewInstance("spare-deck", k, "")
	c.C.Pack = append(c.C.Pack, spare)
	cr := g.r.Fight.Spawn(g.r.Book.Creatures[0].ID, nil, nil, nil)
	c.Fight = &Fight{E: g.r.Fight.Assemble(fight.Site{ID: "swap", Party: 1}, cr)}
	swap := Command{Key: "swap", Char: c.C.ID, Kind: DeckSwap, Item: spare.ID}
	abRefused(t, g, swap, NoSlot)
	abTaking(c, "kindler", "second-slot")
	abAct(t, g, swap)
	if c.C.In("off-hand", 0) != spare {
		t.Fatal("Second slot did not swap the deck in")
	}
	swap.Key, swap.Item = "again", worn.ID
	abRefused(t, g, swap, Swapped)
}

// GDD 5.9, Warden tier 5: "Stand over: a downed party member cannot lose
// their haul while you stand". The fight keeps them (fight's own test);
// the party's split pays them.
func TestAbilityStandOver(t *testing.T) {
	g := guardGame(t)
	w, a := abParty(t, g, "knife")
	sh := g.newShared(g.partyOf(w), w.C.At, 0, []*Char{w, a})
	m := g.r.Book.Materials[0].ID
	e := &fight.Encounter{ID: "held", Result: fight.Held, Over: true, Down: []string{a.C.ID}, Haul: []item.Spoil{{Material: m, Qty: 4}}}
	e.Share.Bump(w.C.ID, 1)
	e.Share.Bump(a.C.ID, 1)
	if parts := g.split(sh, e, []*Char{w, a}); len(parts[a.C.ID]) != 0 {
		t.Fatalf("a member down at a held end was paid %v with nobody standing over them", parts[a.C.ID])
	}
	e.Kept = []string{a.C.ID}
	if parts := g.split(sh, e, []*Char{w, a}); item.Total(parts[a.C.ID]) != 2 || item.Total(parts[w.C.ID]) != 2 {
		t.Fatalf("a member stood over was paid %v of the haul's 4", parts)
	}
}
