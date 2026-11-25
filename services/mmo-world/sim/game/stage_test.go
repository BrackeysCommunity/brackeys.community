package game

import (
	"slices"
	"strconv"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// stageTile is a tile near a settlement a stage may stand on, other than
// those skipped.
func stageTile(t *testing.T, g *Game, n int, skip ...hex.Hex) hex.Hex {
	t.Helper()
	for r := int64(1); r <= 8; r++ {
		for _, h := range hex.Ring(g.SettlementHex(n), r) {
			if !slices.Contains(skip, h) && g.stageSite(n, h) == nil {
				return h
			}
		}
	}
	t.Fatal("no tile near the settlement a stage may stand on")
	return hex.Hex{}
}

// worldHunt is a fights.hunts row a hunt template may stage.
func worldHunt(t *testing.T, g *Game) string {
	t.Helper()
	for _, h := range g.r.Book.Hunts {
		if h.Kind == "" {
			return h.ID
		}
	}
	t.Fatal("no world hunt row")
	return ""
}

// mustAct applies a command that must be accepted.
func mustAct(t *testing.T, g *Game, cmd Command) Result {
	t.Helper()
	res, err := g.Act(cmd)
	if err != nil {
		t.Fatalf("%s: %v", cmd.Kind, err)
	}
	return res
}

// refusedAs applies a command that must be refused with code, leaving the
// digest as it was.
func stageRefused(t *testing.T, g *Game, cmd Command, code string) {
	t.Helper()
	before, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	_, err = g.Act(cmd)
	refusedWith(t, err, code)
	if after, _ := g.Digest(); after != before {
		t.Fatalf("a %s refusal of %s changed the game", code, cmd.Kind)
	}
}

// joinA makes n more characters of server a.
func joinA(t *testing.T, g *Game, n int) []*Char {
	t.Helper()
	var out []*Char
	for i := range n {
		out = append(out, mustAct(t, g, Command{Key: "join-" + strconv.Itoa(len(g.Chars)) + "-" + strconv.Itoa(i), Kind: Create, Server: "a"}).Char)
	}
	return out
}

func stageOrder(key string, c *Char, server string, admin, staff bool, s StageCmd) Command {
	return Command{Key: key, Char: c.C.ID, Kind: Staging, Server: server, Admin: admin, Staff: staff, Stage: &s}
}

// stampedBy finds a fact of a kind and reports whether server's stamp is
// on it.
func stampedBy(t *testing.T, facts []fact.Fact, kind, server string) {
	t.Helper()
	i := slices.IndexFunc(facts, func(f fact.Fact) bool { return f.Kind == kind })
	if i < 0 {
		t.Fatalf("no %s among %d facts", kind, len(facts))
	}
	if s := facts[i].StagedBy; s == nil || *s != (fact.Ref{Kind: stampServer, ID: server}) {
		t.Fatalf("%s is stamped %v, want server %s", kind, s, server)
	}
}

// crateGoods is every staged unit a character carries.
func crateGoods(c *Char) int64 {
	var n int64
	for _, s := range c.C.Staged {
		n += s.Units
	}
	return n
}

// TestHouseStaging: an admin of server a stages a large drop and the pool
// is untouched; a staff member stages a tier 2 hunt and the pool goes 400
// to 320; a player, another server's staff and staff short of points are
// refused with the game unchanged; both open stamped by a, and the drop's
// crates mint staged goods.
func TestHouseStaging(t *testing.T) {
	g, c, home := houseGame(t)
	full := g.lp("pool-cap")
	at := stageTile(t, g, home)
	res := mustAct(t, g, stageOrder("s1", c, "a", true, false, StageCmd{Template: "drop-large", Settlement: home, At: at}))
	drop := g.StageByID("st-1")
	switch {
	case res.Points != 0 || g.PoolOf("a", home) != full || g.House("a") != nil:
		t.Fatalf("an admin's staging spent %d points, leaving the pool at %d", res.Points, g.PoolOf("a", home))
	case drop == nil || !drop.Open || drop.Closed || drop.Crates != g.stageTemplate("drop-large").Crates || drop.Role != RoleAdmin || drop.Label != g.ServerGuild("a").G.Name:
		t.Fatalf("the drop reads %+v", drop)
	}
	stampedBy(t, res.Facts, factStagedOpened, "a")

	row := worldHunt(t, g)
	at2 := stageTile(t, g, home, at)
	res = mustAct(t, g, stageOrder("s2", c, "a", false, true, StageCmd{Template: "hunt-2", Settlement: home, At: at2, Hunt: row}))
	hunt := g.StageByID("st-2")
	price := g.stageTemplate("hunt-2").Points
	switch {
	case res.Points != price || g.Spent() != price || g.PoolOf("a", home) != full-price:
		t.Fatalf("a staff hunt-2 spent %d, leaving the pool at %d", res.Points, g.PoolOf("a", home))
	case hunt == nil || !hunt.Open || hunt.Closed || hunt.HuntID == "" || hunt.Role != RoleStaff:
		t.Fatalf("the hunt stage reads %+v", hunt)
	case g.HuntByID(hunt.HuntID) == nil || g.HuntByID(hunt.HuntID).Stage != hunt.ID:
		t.Fatalf("the staged hunt %s is not its stage's", hunt.HuntID)
	}
	stampedBy(t, res.Facts, factStagedOpened, "a")

	at3 := stageTile(t, g, home, at, at2)
	order := StageCmd{Template: "drop-small", Settlement: home, At: at3}
	stageRefused(t, g, stageOrder("s3", c, "a", false, false, order), HouseRoleCode)
	stageRefused(t, g, stageOrder("s4", g.Char("c-2"), "b", false, true, order), HouseScope)
	g.poolFor("a", home).Points = g.stageTemplate("drop-small").Points - 1
	stageRefused(t, g, stageOrder("s5", c, "a", false, true, order), PoolShort)
	stageRefused(t, g, stageOrder("s6", c, "a", false, true, StageCmd{Template: "pattern", Settlement: home, At: at3, Pattern: "second-triangle"}), StageTemplate)
	stageRefused(t, g, stageOrder("s7", c, "a", true, false, StageCmd{Template: "no-such", Settlement: home, At: at3}), StageTemplate)
	stageRefused(t, g, stageOrder("s8", c, "a", true, false, StageCmd{Template: "drop-small", Settlement: home, At: g.SettlementHex(home)}), BadArgs)
	stageRefused(t, g, stageOrder("s9", c, "a", true, false, StageCmd{Template: "drop-small", Settlement: home, At: at3, Days: g.lp("stage-days-max") + 1}), BadArgs)
	stageRefused(t, g, stageOrder("s10", c, "a", true, false, StageCmd{Template: "hunt-2", Settlement: home, At: at3}), BadArgs)

	opener := joinA(t, g, 1)[0]
	if err := g.Teleport(opener, at); err != nil {
		t.Fatal(err)
	}
	res = mustAct(t, g, Command{Key: "o1", Char: opener.C.ID, Kind: CrateOpen, Target: drop.ID})
	if crateGoods(opener) <= 0 || len(opener.C.Staged) != 1 || opener.C.Staged[0].At != home || drop.Crates != g.stageTemplate("drop-large").Crates-1 {
		t.Fatalf("a crate gave %+v, %d crates left", opener.C.Staged, drop.Crates)
	}
	stampedBy(t, res.Facts, factCrateOpened, "a")
	audit(t, g)
}

// TestStageLimit: a settlement holds live-stages-most live stages, and
// the next is refused.
func TestStageLimit(t *testing.T) {
	g, c, home := houseGame(t)
	at := stageTile(t, g, home)
	most := g.lp("live-stages-most")
	for i := range most {
		mustAct(t, g, stageOrder("l"+strconv.FormatInt(i, decimal), c, "a", true, false, StageCmd{Template: "drop-small", Settlement: home, At: at}))
	}
	stageRefused(t, g, stageOrder("over", c, "a", true, false, StageCmd{Template: "drop-small", Settlement: home, At: at}), StageLimit)
	mustAct(t, g, Command{Key: "end", Char: c.C.ID, Kind: StagingEnd, Server: "a", Admin: true, Target: "st-1"})
	mustAct(t, g, stageOrder("again", c, "a", true, false, StageCmd{Template: "drop-small", Settlement: home, At: at}))
}

// TestPoolRefill: at the world day a pool gains pool-refill and one point
// per pool-per-active of its server's active characters, up to the cap.
func TestPoolRefill(t *testing.T) {
	g, _, home := houseGame(t)
	joinA(t, g, 7)
	var active int64
	for c := range g.activeChars() {
		if c.Server == "a" {
			active++
		}
	}
	per := g.lp("pool-per-active")
	if active < per {
		t.Fatalf("%d active characters of a, want at least %d", active, per)
	}
	want := g.lp("pool-refill") + active/per
	if got := g.PoolRefill("a"); got != want {
		t.Fatalf("the refill reads %d, want %d", got, want)
	}
	g.poolFor("a", home).Points = 100
	toDay := func() {
		for {
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
			if g.Tick()%sheets.TicksPerDay == 0 {
				return
			}
		}
	}
	toDay()
	if got := g.PoolOf("a", home); got != 100+want {
		t.Fatalf("the pool refilled to %d, want %d", got, 100+want)
	}
	g.poolFor("a", home).Points = g.lp("pool-cap") - 1
	toDay()
	if got := g.PoolOf("a", home); got != g.lp("pool-cap") {
		t.Fatalf("the pool refilled past its cap to %d", got)
	}
	if g.PoolOf("b", home) != g.lp("pool-cap") || len(g.House("a").Pools) != 1 {
		t.Fatal("a refill made a pool nobody spent from")
	}
}

// TestCrates: a drop's crates open on its tile only, up to crate-cap per
// character, never for the stager, and not once the stage is closed.
func TestCrates(t *testing.T) {
	g, c, home := houseGame(t)
	at := stageTile(t, g, home)
	mustAct(t, g, stageOrder("d1", c, "a", true, false, StageCmd{Template: "drop-small", Settlement: home, At: at}))
	open := func(key string, who *Char) Command {
		return Command{Key: key, Char: who.C.ID, Kind: CrateOpen, Target: "st-1"}
	}
	ch := joinA(t, g, 2)
	x, y := ch[0], ch[1]
	stageRefused(t, g, open("x0", x), BadArgs)
	for _, who := range []*Char{c, x, y} {
		if err := g.Teleport(who, at); err != nil {
			t.Fatal(err)
		}
	}
	stageRefused(t, g, open("c1", c), StagedOwn)
	most := g.lp("crate-cap")
	for i := range most {
		mustAct(t, g, open("x"+strconv.FormatInt(i+1, decimal), x))
	}
	stageRefused(t, g, open("x-over", x), CrateCap)
	held := crateGoods(x)
	if held <= 0 || crateGoods(c) != 0 || g.StageByID("st-1").Opened.Get(x.C.ID) != most {
		t.Fatalf("crates gave %d staged units, the stager %d", held, crateGoods(c))
	}
	for _, s := range x.C.Staged {
		if s.At != home || g.Ledger.Of(ledger.Char(x.C.ID), ledger.Staged(s.At, s.Material)) != s.Units || g.Ledger.Of(ledger.Char(x.C.ID), ledger.Material(s.Material)) != 0 {
			t.Fatalf("staged goods %+v do not match the ledger, or came clean", s)
		}
	}
	stageRefused(t, g, Command{Key: "none", Char: y.C.ID, Kind: CrateOpen, Target: "st-9"}, NoStage)
	mustAct(t, g, Command{Key: "end", Char: c.C.ID, Kind: StagingEnd, Server: "a", Admin: true, Target: "st-1"})
	stageRefused(t, g, open("y1", y), NoStage)
	audit(t, g)
}

// TestContest: a staff contest is an Each goal with no coin, escrow or
// fee; its first most winners each roll a staged prize, the stager's
// work counts for nothing, and nobody's coin moves.
func TestContest(t *testing.T) {
	g, c, home := houseGame(t)
	at := stageTile(t, g, home)
	row := g.contestRow("hound-hunt")
	res := mustAct(t, g, stageOrder("k1", c, "a", false, true, StageCmd{Template: "contest", Settlement: home, At: at, Contest: row.ID}))
	if res.Points != g.stageTemplate("contest").Points {
		t.Fatalf("a staff contest spent %d", res.Points)
	}
	st := g.StageByID("st-1")
	if len(st.Goals) != 1 {
		t.Fatalf("the contest posted %d goals", len(st.Goals))
	}
	x := g.GoalOf(st.Goals[0])
	switch {
	case x.Issuer != (goal.Ref{Kind: goal.ByStaged, ID: st.ID}) || x.Mode != goal.Each || x.Cap != row.Most || x.Reward != 0 || x.Fee != 0 || x.Prize != row.Prize:
		t.Fatalf("the contest goal reads %+v", x)
	case len(g.Ledger.Held(goalPool(x.ID))) != 0:
		t.Fatal("a staged contest holds an escrow")
	case lined(x):
		t.Fatal("a staged contest keeps an emergence line")
	}
	stampedBy(t, res.Facts, "goal.posted", "a")
	players := append([]*Char{c}, joinA(t, g, int(row.Most)+1)...)
	coin := map[string]int64{}
	for _, p := range players {
		coin[p.C.ID] = p.C.Coin
	}
	first := fact.ID(g.Log.Len())
	for _, p := range players {
		for range row.Count {
			if _, err := g.fact(p, "encounter.won", g.Tick(), fact.S("archetype", row.Target)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := g.creditGoals(first, "contest-credit"); err != nil {
		t.Fatal(err)
	}
	var winners int64
	for _, p := range players[1:] {
		if crateGoods(p) > 0 {
			winners++
		}
	}
	switch {
	case winners != row.Most || int64(len(x.Claims)) != row.Most || x.State != goal.Done:
		t.Fatalf("%d winners, %d claims, state %s; want %d", winners, len(x.Claims), x.State, row.Most)
	case crateGoods(c) != 0 || x.Progress.Get(c.C.ID) != 0:
		t.Fatal("the stager counted toward its own contest")
	case crateGoods(players[len(players)-1]) != 0:
		t.Fatal("a winner past the contest's most was paid")
	}
	for _, p := range players {
		if p.C.Coin != coin[p.C.ID] {
			t.Fatalf("%s's coin moved from %d to %d", p.C.ID, coin[p.C.ID], p.C.Coin)
		}
	}
	audit(t, g)
}

// TestFair: a staff fair costs its points and runs every fair contest it
// can post, beside a small drop of crates, all paying staged goods.
func TestFair(t *testing.T) {
	g, c, home := houseGame(t)
	at := stageTile(t, g, home)
	tpl := g.stageTemplate("fair")
	res := mustAct(t, g, stageOrder("f1", c, "a", false, true, StageCmd{Template: "fair", Settlement: home, At: at}))
	st := g.StageByID("st-1")
	if res.Points != tpl.Points || g.PoolOf("a", home) != g.lp("pool-cap")-tpl.Points || st.Crates != tpl.Crates {
		t.Fatalf("a fair spent %d with %d crates", res.Points, st.Crates)
	}
	var want []string
	for _, row := range g.r.Book.FairContests() {
		if row.Verb != sheets.ContestReach {
			want = append(want, row.ID)
		} else if _, ok := g.reachTile(home, mustTiles(t, row), at); ok {
			want = append(want, row.ID)
		}
	}
	if len(st.Goals) != len(want) || len(want) < 2 {
		t.Fatalf("the fair posted %d goals, want %v", len(st.Goals), want)
	}
	for _, id := range st.Goals {
		x := g.GoalOf(id)
		if x.Issuer.Kind != goal.ByStaged || x.Mode != goal.Each || x.Reward != 0 || x.Fee != 0 || x.Prize == "" || x.Board != home || x.Expires > st.Ends {
			t.Fatalf("a fair goal reads %+v", x)
		}
	}
	reach := slices.IndexFunc(st.Goals, func(id string) bool { return g.GoalOf(id).Cond.Verb == goal.Reach })
	if reach >= 0 {
		h, ok := hex.ParseRef(g.GoalOf(st.Goals[reach]).Cond.At[len(goal.PlaceTile)+1:])
		if !ok || hex.Distance(h, g.SettlementHex(home)) != mustTiles(t, *g.contestRow("far-walk")) {
			t.Fatalf("the fair's reach goal names %s", g.GoalOf(st.Goals[reach]).Cond.At)
		}
	}
}

func mustTiles(t *testing.T, row sheets.ContestRow) int64 {
	t.Helper()
	n, ok := row.ReachTiles()
	if !ok {
		t.Fatalf("%s names no distance", row.ID)
	}
	return n
}

// TestStageScheduled: a stage ordered ahead writes staged.ordered, holds
// nothing until its tick, opens then stamped by its server, and closes at
// its end tick.
func TestStageScheduled(t *testing.T) {
	g, c, home := houseGame(t)
	at := stageTile(t, g, home)
	const ahead = 10
	res := mustAct(t, g, stageOrder("w1", c, "a", true, false, StageCmd{Template: "drop-small", Settlement: home, At: at, Opens: ahead, Days: 1}))
	st := g.StageByID("st-1")
	if st.Open || st.Crates != 0 || st.Opens != g.Tick()+ahead || st.Ends != st.Opens+sheets.TicksPerDay {
		t.Fatalf("a stage ordered ahead reads %+v", st)
	}
	stampedBy(t, res.Facts, factStagedOrdered, "a")
	if slices.ContainsFunc(res.Facts, func(f fact.Fact) bool { return f.Kind == factStagedOpened }) {
		t.Fatal("a stage ordered ahead opened at once")
	}
	x := joinA(t, g, 1)[0]
	if err := g.Teleport(x, at); err != nil {
		t.Fatal(err)
	}
	stageRefused(t, g, Command{Key: "early", Char: x.C.ID, Kind: CrateOpen, Target: st.ID}, NoStage)
	var facts []fact.Fact
	for g.Tick() < st.Opens {
		if st.Open {
			t.Fatalf("the stage opened at %d, before %d", g.Tick(), st.Opens)
		}
		out, err := g.Advance()
		if err != nil {
			t.Fatal(err)
		}
		facts = append(facts, out...)
	}
	if !st.Open || st.Crates != g.stageTemplate("drop-small").Crates {
		t.Fatalf("the stage did not open at its tick: %+v", st)
	}
	stampedBy(t, facts, factStagedOpened, "a")
	mustAct(t, g, Command{Key: "on-time", Char: x.C.ID, Kind: CrateOpen, Target: st.ID})
	facts = nil
	for !st.Closed && g.Tick() < st.Ends+2*sheets.TicksPerDay {
		out, err := g.Advance()
		if err != nil {
			t.Fatal(err)
		}
		facts = append(facts, out...)
	}
	if !st.Closed || g.Tick() != st.Ends || st.Crates != 0 {
		t.Fatalf("the stage closed at %d (ends %d): %+v", g.Tick(), st.Ends, st)
	}
	stampedBy(t, facts, factStagedClosed, "a")
	audit(t, g)
}

// TestStageEnd: only the staging server ends a stage, its staff only a
// staff stage; another server, a player and staff against an admin's
// stage are refused with the game unchanged, and nothing is refunded.
func TestStageEnd(t *testing.T) {
	g, c, home := houseGame(t)
	at := stageTile(t, g, home)
	mustAct(t, g, stageOrder("e1", c, "a", true, false, StageCmd{Template: "drop-small", Settlement: home, At: at}))
	mustAct(t, g, stageOrder("e2", c, "a", false, true, StageCmd{Template: "drop-small", Settlement: home, At: at}))
	pool := g.PoolOf("a", home)
	end := func(key string, who *Char, server string, admin, staff bool, target string) Command {
		return Command{Key: key, Char: who.C.ID, Kind: StagingEnd, Server: server, Admin: admin, Staff: staff, Target: target}
	}
	other := g.Char("c-2")
	stageRefused(t, g, end("x1", other, "b", true, false, "st-1"), HouseScope)
	stageRefused(t, g, end("x2", other, "b", false, true, "st-2"), HouseScope)
	stageRefused(t, g, end("x3", c, "a", false, false, "st-1"), HouseRoleCode)
	stageRefused(t, g, end("x4", c, "a", false, true, "st-1"), HouseRoleCode)
	stageRefused(t, g, end("x5", c, "a", true, false, "st-9"), NoStage)
	res := mustAct(t, g, end("x6", c, "a", false, true, "st-2"))
	stampedBy(t, res.Facts, factStagedClosed, "a")
	if !g.StageByID("st-2").Closed || g.PoolOf("a", home) != pool {
		t.Fatal("staff did not end their stage, or were refunded")
	}
	stageRefused(t, g, end("x7", c, "a", true, false, "st-2"), NoStage)
	mustAct(t, g, end("x8", c, "a", true, false, "st-1"))
}

// TestPoolStaffPin: a staff pin from the console pays the staff row's
// points from the pool of the settlement whose region it is in; an
// admin's pays nothing; withdrawing gives nothing back; staff withdraw
// only staff pins, and another server's staff, a player and staff short
// of points are refused with the game unchanged.
func TestPoolStaffPin(t *testing.T) {
	g, c, home := houseGame(t)
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	gd := g.ServerGuild("a")
	region := g.r.Gen.RegionOf(g.SettlementHex(home))
	by := world.PinBy{Role: world.PinStaff, Server: "a", Char: c.C.ID, Label: gd.G.Name, Region: &region}
	lead := func(h hex.Hex) tile.Fix {
		a := g.r.Gen.Archetypes(h)
		if len(a) == 0 {
			return tile.Fix{}
		}
		return tile.Fix{Lead: a[len(a)-1]}
	}
	var at []hex.Hex
	for r := int64(1); r <= 40 && len(at) < 3; r++ {
		for _, h := range hex.Ring(g.SettlementHex(home), r) {
			if f := lead(h); !f.Empty() && len(at) < 3 && g.World.CheckPin(h, 1, f, by, false) == nil {
				at = append(at, h)
			}
		}
	}
	if len(at) < 3 {
		t.Fatalf("found %d tiles a pin may stand on", len(at))
	}
	pin := func(key string, server string, admin, staff bool, h hex.Hex) Command {
		return Command{Key: key, Char: c.C.ID, Kind: HousePin, Server: server, Admin: admin, Staff: staff, Pin: &PinCmd{At: h, Reach: 1, Fix: lead(h)}}
	}
	unpin := func(key string, admin, staff bool, id string) Command {
		return Command{Key: key, Char: c.C.ID, Kind: HouseUnpin, Server: "a", Admin: admin, Staff: staff, Pin: &PinCmd{Pin: id}}
	}
	price := g.pinLimit(world.PinStaff).Points
	full := g.lp("pool-cap")
	res := mustAct(t, g, pin("p1", "a", false, true, at[0]))
	staffPin := g.World.Pins[len(g.World.Pins)-1]
	switch {
	case res.Points != price || g.PoolOf("a", home) != full-price:
		t.Fatalf("a staff pin spent %d, leaving the pool at %d", res.Points, g.PoolOf("a", home))
	case staffPin.By.Role != world.PinStaff || staffPin.By.Server != "a" || staffPin.By.Label != gd.G.Name || staffPin.By.Points != price:
		t.Fatalf("the staff pin reads %+v", staffPin.By)
	}
	stampedBy(t, res.Facts, "pin.reserved", "a")
	res = mustAct(t, g, pin("p2", "a", true, false, at[1]))
	adminPin := g.World.Pins[len(g.World.Pins)-1]
	if res.Points != 0 || g.PoolOf("a", home) != full-price || adminPin.By.Role != world.PinAdmin {
		t.Fatalf("an admin's pin spent %d", res.Points)
	}
	stageRefused(t, g, pin("p3", "a", false, false, at[2]), HouseRoleCode)
	stageRefused(t, g, Command{Key: "p4", Char: "c-2", Kind: HousePin, Server: "b", Staff: true, Pin: &PinCmd{At: at[2], Reach: 1, Fix: lead(at[2])}}, HouseScope)
	stageRefused(t, g, unpin("u1", false, true, adminPin.ID), HouseRoleCode)
	mustAct(t, g, unpin("u2", false, true, staffPin.ID))
	if g.PoolOf("a", home) != full-price {
		t.Fatal("withdrawing a staff pin gave its points back")
	}
	g.poolFor("a", home).Points = price - 1
	stageRefused(t, g, pin("p5", "a", false, true, at[2]), PoolShort)
}
