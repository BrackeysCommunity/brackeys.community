package game

import (
	"slices"
	"strconv"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// structural: how far from the first settlement the tests look for a
// dungeon, in tiles.
const delveSearch = 200

// dungeonFor is the nearest dungeon to the first settlement that is not
// a relay tower, of a kind ("" for any) and with at least min floors.
func dungeonFor(t *testing.T, g *Game, kind string, least int64) (hex.Hex, gen.Plan) {
	t.Helper()
	from := g.SettlementHex(0)
	for r := int64(1); r <= delveSearch; r++ {
		for _, h := range hex.Ring(from, r) {
			p, ok := g.r.Gen.Dungeon(h)
			if ok && !p.Up && p.Floors >= least && (kind == "" || p.Kind == kind) && len(g.r.Gen.Creatures(h)) > 0 {
				return h, p
			}
		}
	}
	t.Fatalf("no %q dungeon of %d floors within %d tiles", kind, least, delveSearch)
	return hex.Hex{}, gen.Plan{}
}

// formParty is n new characters on one tile in one party, the first
// leading.
func formParty(t *testing.T, g *Game, n int, h hex.Hex) []*Char {
	t.Helper()
	var cs []*Char
	for i := range n {
		c := mustCreate(t, g, "delver-"+strconv.Itoa(len(g.Chars))+"-"+strconv.Itoa(i), "knife")
		c.C.At = h
		cs = append(cs, c)
	}
	for i, c := range cs[1:] {
		key := "party-" + cs[0].C.ID + "-" + strconv.Itoa(i)
		if _, err := g.Act(Command{Key: key + "-invite", Char: cs[0].C.ID, Kind: PartyInvite, Target: c.C.ID}); err != nil {
			t.Fatal(err)
		}
		if _, err := g.Act(Command{Key: key + "-join", Char: c.C.ID, Kind: PartyJoin, Target: cs[0].C.ID}); err != nil {
			t.Fatal(err)
		}
	}
	return cs
}

// explored starts c's encounter on its tile, waiting out thin herds.
func explored(t *testing.T, g *Game, c *Char) {
	t.Helper()
	for i := range delveSearch {
		if _, err := g.Act(Command{Key: "explore-" + c.C.ID + "-" + strconv.Itoa(int(g.Tick())) + "-" + strconv.Itoa(i), Char: c.C.ID, Kind: Explore}); err != nil {
			t.Fatal(err)
		}
		if c.Fight != nil {
			return
		}
		advance(t, g)
	}
	t.Fatal("no encounter showed")
}

func advance(t *testing.T, g *Game) {
	t.Helper()
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
}

// endFight ends c's encounter with a result and closes it as a press
// would: alone, or for every member of its shared encounter.
func endFight(t *testing.T, g *Game, c *Char, result string, haul []item.Spoil) {
	t.Helper()
	e := c.Fight.E
	e.Over, e.Result, e.Haul = true, result, haul
	key := "end-" + e.ID
	var err error
	if sh := g.SharedByID(c.Fight.Shared); sh != nil {
		err = g.closeShared(sh, c, e, key, g.Tick())
	} else {
		err = g.close(c, key, g.Tick())
	}
	if err != nil {
		t.Fatal(err)
	}
}

func act(t *testing.T, g *Game, c *Char, kind, option string) Result {
	t.Helper()
	res, err := g.Act(Command{Key: kind + "-" + c.C.ID + "-" + strconv.Itoa(int(g.Tick())) + "-" + strconv.Itoa(g.Log.Len()), Char: c.C.ID, Kind: kind, Option: option, Now: 1})
	if err != nil {
		t.Fatalf("%s %s: %v", c.C.ID, kind, err)
	}
	return res
}

func someHaul(g *Game) []item.Spoil {
	return []item.Spoil{{Material: g.r.Book.FightTiers[0].Haul[0], Qty: 4}}
}

func TestDelveSoloThroughThreeFloors(t *testing.T) {
	g := guardGame(t)
	h, plan := dungeonFor(t, g, "", 4)
	c := mustCreate(t, g, "solo", "knife")
	c.C.At = h
	explored(t, g, c)
	for n := int64(1); n <= 3; n++ {
		e := c.Fight.E
		if e.Floor != n || c.C.Floor != n || c.Delving == nil || c.Delving.Dungeon != h.Ref() {
			t.Fatalf("floor %d: encounter on %d, standing on %d, %+v", n, e.Floor, c.C.Floor, c.Delving)
		}
		if !slices.ContainsFunc(e.Beats, func(b string) bool { return b == fight.BeatLock || b == "puzzle" }) {
			t.Fatalf("floor %d holds no machine: %v", n, e.Beats)
		}
		endFight(t, g, c, fight.Won, someHaul(g))
		f, sh := g.forkOf(c)
		if f == nil || sh.Floor != n || len(sh.Members) != 1 {
			t.Fatalf("no fork below floor %d", n)
		}
		if n < 3 {
			act(t, g, c, DungeonPush, WayOption(gen.WayOpen))
		}
	}
	if DeepestFloor(c, h) != 3 {
		t.Fatalf("deepest %d", DeepestFloor(c, h))
	}
	read, _ := g.DungeonOf(c)
	if read.Deepest != 3 || read.Bottom || read.Floor != 3 || read.Fork == nil || plan.Floors <= 3 {
		t.Fatalf("the card: %+v", read)
	}
	carried := item.Total(c.Delving.Carried)
	act(t, g, c, DungeonLeave, "")
	if c.Long == nil || c.Long.Kind != Climb || c.Long.Due != g.Tick()+g.fp("leave-ticks") {
		t.Fatalf("leaving: %+v", c.Long)
	}
	if carried != 3*item.Total(someHaul(g)) {
		t.Fatalf("carried %d out of three floors", carried)
	}
	advance(t, g)
	if c.C.Floor != 0 || c.Delving != nil || c.Long != nil {
		t.Fatalf("out: floor %d, %+v", c.C.Floor, c.Delving)
	}
	audit(t, g)
}

func TestDelvePartyOfFourToTheGuardian(t *testing.T) {
	g := guardGame(t)
	h, plan := dungeonFor(t, g, "bunker", 7)
	if plan.Floors != 7 {
		t.Fatalf("a bunker of %d floors", plan.Floors)
	}
	cs := formParty(t, g, 4, h)
	explored(t, g, cs[0])
	for n := int64(1); n <= plan.Floors; n++ {
		e := cs[0].Fight.E
		for _, c := range cs {
			if c.Fight == nil || c.Fight.E != e || c.C.Floor != n {
				t.Fatalf("floor %d: %s is not in the party's encounter", n, c.C.ID)
			}
		}
		if e.Party != 4 {
			t.Fatalf("floor %d: party of %d", n, e.Party)
		}
		if n == plan.Floors {
			if e.Beats[len(e.Beats)-1] != fight.BeatGuardian {
				t.Fatalf("the bottom's last beat is %s", e.Beats[len(e.Beats)-1])
			}
			endFight(t, g, cs[0], fight.Won, someHaul(g))
			break
		}
		endFight(t, g, cs[0], fight.Won, someHaul(g))
		for _, c := range cs {
			act(t, g, c, DungeonPush, WayOption(gen.WayOpen))
		}
	}
	if read, _ := g.DungeonOf(cs[0]); !read.Bottom || read.Deepest != plan.Floors || read.Fork != nil {
		t.Fatalf("the card at the bottom: %+v", read)
	}
	for _, c := range cs {
		if DeepestFloor(c, h) != plan.Floors || c.Long == nil || c.Long.Kind != Climb {
			t.Fatalf("%s at the bottom: deepest %d, %+v", c.C.ID, DeepestFloor(c, h), c.Long)
		}
	}
	advance(t, g)
	for _, c := range cs {
		if c.C.Floor != 0 || c.Delving != nil {
			t.Fatalf("%s is not out", c.C.ID)
		}
	}
	audit(t, g)
}

// atFork puts a party on a won floor's fork: explored, then won.
func toFork(t *testing.T, g *Game, cs []*Char) *Shared {
	t.Helper()
	explored(t, g, cs[0])
	endFight(t, g, cs[0], fight.Won, someHaul(g))
	_, sh := g.forkOf(cs[0])
	if sh == nil {
		t.Fatal("no fork")
	}
	return sh
}

func TestForkVoteTieAndDefault(t *testing.T) {
	ids := func(cs ...string) []*Char {
		var out []*Char
		for _, id := range cs {
			out = append(out, &Char{C: char.New(id, hex.Hex{})})
		}
		return out
	}
	present := ids("a", "b", "c", "d")
	vote := func(leader string, cs ...Choice) (int64, int, int) {
		way, push, leave := forkVote(&ForkState{Choices: cs}, present, leader)
		return way, len(push), len(leave)
	}
	tie := []Choice{{Who: "a", Push: true, Way: 1}, {Who: "b", Push: true, Way: 0}, {Who: "c"}, {Who: "d"}}
	if way, p, l := vote("a", tie...); way != 1 || p != 2 || l != 2 {
		t.Fatalf("the leader breaks a tie: way %d", way)
	}
	if way, _, _ := vote("c", tie...); way != 0 {
		t.Fatalf("a leader who left: the lowest way of the tie, got %d", way)
	}
	most := []Choice{{Who: "a", Push: true, Way: 1}, {Who: "b", Push: true, Way: 2}, {Who: "c", Push: true, Way: 2}, {Who: "d"}}
	if way, _, _ := vote("a", most...); way != 2 {
		t.Fatalf("most votes win over the leader, got %d", way)
	}
	if _, p, l := vote("a", Choice{Who: "a"}, Choice{Who: "b"}, Choice{Who: "c"}, Choice{Who: "d"}); p != 0 || l != 4 {
		t.Fatal("nobody pushing is everyone leaving")
	}

	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	cs := formParty(t, g, 3, h)
	sh := toFork(t, g, cs)
	act(t, g, cs[0], DungeonPush, WayOption(gen.WayOpen))
	if sh.Opened != 1 || cs[0].C.Floor != 1 {
		t.Fatalf("the first choice opens the window: %d", sh.Opened)
	}
	if sheets.ChoiceParam(g.r.Book.FightParams, "fork-default") != "leave" {
		t.Skip("fork-default is not leave")
	}
	if err := g.forkWindow(sh, g.Tick()); err != nil {
		t.Fatal(err)
	}
	for _, c := range cs[1:] {
		if c.Long == nil || c.Long.Kind != Climb {
			t.Fatalf("%s chose nothing and does not leave", c.C.ID)
		}
	}
	if cs[0].Fight == nil || cs[0].Fight.E.Floor != 2 {
		t.Fatal("the one pusher does not go down alone")
	}
}

func TestDelveLeaverAtTheEntranceATickLater(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	cs := formParty(t, g, 2, h)
	toFork(t, g, cs)
	paid := g.balance(cs[1], ledger.Material(someHaul(g)[0].Material))
	if paid == 0 {
		t.Fatal("the leaver was paid no part of the floor")
	}
	act(t, g, cs[0], DungeonPush, WayOption(gen.WayOpen))
	act(t, g, cs[1], DungeonLeave, "")
	at := g.Tick()
	if cs[1].C.Floor != 1 || cs[1].Long == nil || cs[1].Long.Due != at+g.fp("leave-ticks") {
		t.Fatalf("the leaver climbs: floor %d, %+v", cs[1].C.Floor, cs[1].Long)
	}
	if cs[0].Fight == nil || cs[0].Fight.Shared != "" || cs[0].Fight.E.Floor != 2 {
		t.Fatal("the pusher goes on alone")
	}
	advance(t, g)
	if cs[1].C.Floor != 0 || cs[1].Delving != nil || cs[1].C.At != h {
		t.Fatalf("a tick later the leaver stands on floor %d", cs[1].C.Floor)
	}
	if got := g.balance(cs[1], ledger.Material(someHaul(g)[0].Material)); got != paid {
		t.Fatalf("the leaver kept %d of %d", got, paid)
	}
}

func TestDelveDownOnFloorThree(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 4)
	c := mustCreate(t, g, "deep", "knife")
	c.C.At = h
	explored(t, g, c)
	for range 2 {
		endFight(t, g, c, fight.Won, someHaul(g))
		act(t, g, c, DungeonPush, WayOption(gen.WayOpen))
	}
	if c.C.Floor != 3 {
		t.Fatalf("on floor %d", c.C.Floor)
	}
	carried := slices.Clone(c.Delving.Carried)
	e := c.Fight.E
	e.Down = append(e.Down, c.C.ID)
	c.C.Set(char.Down, 0)
	endFight(t, g, c, fight.Lost, nil)
	pool := ledger.FloorPool(h.Ref(), 3)
	for _, s := range carried {
		if got := g.Ledger.Of(pool, ledger.Material(s.Material)); got != s.Qty {
			t.Fatalf("floor 3's pool holds %d %s of %d carried", got, s.Material, s.Qty)
		}
	}
	if !slices.ContainsFunc(g.Pending, func(a world.Action) bool { return a.Kind == world.ActFloorFell && a.Floor == 3 }) {
		t.Fatal("no fall recorded on floor 3")
	}
	act(t, g, c, Crawl, "")
	if want := g.r.wp("crawl-ticks") + 3*g.fp("crawl-per-floor"); c.Long.Due-g.Tick() != want {
		t.Fatalf("crawling takes %d, not %d", c.Long.Due-g.Tick(), want)
	}
	for c.Long != nil {
		advance(t, g)
	}
	if c.C.Floor != 0 || c.Delving != nil || notDown(c) != nil {
		t.Fatal("not out at the entrance")
	}
	audit(t, g)
}

func TestDelveRefusalsChangeNothing(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	cs := formParty(t, g, 2, h)
	lone := mustCreate(t, g, "lone", "knife")
	lone.C.At = h
	refused := func(c *Char, kind, option, code string) {
		t.Helper()
		before := digestOf(t, g)
		_, err := g.Act(Command{Key: "refuse-" + c.C.ID + "-" + kind + option, Char: c.C.ID, Kind: kind, Option: option, Now: 1})
		if !refusedAs(err, code) {
			t.Fatalf("%s %s %q: %v, not %s", c.C.ID, kind, option, err, code)
		}
		if digestOf(t, g) != before {
			t.Fatalf("a refused %s changed the game", kind)
		}
	}
	refused(lone, DungeonPush, WayOption(gen.WayOpen), NoFork)
	refused(lone, DungeonLeave, "", NoFork)
	toFork(t, g, cs)
	refused(cs[0], DungeonPush, "way-9", BadArgs)
	refused(cs[0], DungeonPush, WayOption(gen.WayHidden), NoWay)
	act(t, g, cs[0], DungeonPush, WayOption(gen.WayOpen))
	refused(cs[0], DungeonPush, WayOption(gen.WayOpen), Chose)
	refused(cs[0], DungeonLeave, "", Chose)
	refused(cs[1], Explore, "", Busy)
	refused(cs[1], Travel, "", Busy)
}
