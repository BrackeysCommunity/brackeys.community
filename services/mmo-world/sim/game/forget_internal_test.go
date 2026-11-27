package game

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// fgChars are n new characters of server s1, in its guild, at the first
// settlement.
func fgChars(t *testing.T, g *Game, n int) []*Char {
	t.Helper()
	var out []*Char
	for range n {
		res, err := g.Act(Command{Key: fmt.Sprintf("fg-new-%d", len(g.Chars)), Kind: Create, Option: "knife", Server: "s1", Note: "The Reedwardens"})
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, res.Char)
	}
	return out
}

func fgDo(t *testing.T, g *Game, c *Char, cmd Command) Result {
	t.Helper()
	cmd.Char = c.C.ID
	cmd.Key = fmt.Sprintf("fg-%s-%s-%d-%d", cmd.Kind, c.C.ID, g.Tick(), g.Log.Len())
	res, err := g.Act(cmd)
	if err != nil {
		t.Fatalf("%s %s: %v", c.C.ID, cmd.Kind, err)
	}
	return res
}

func fgForget(t *testing.T, g *Game, c *Char) {
	t.Helper()
	fgDo(t, g, c, Command{Kind: Forget})
}

// fgTxn is the flushed transaction under a key.
func fgTxn(txns []ledger.Txn, key string) (ledger.Txn, bool) {
	i := slices.IndexFunc(txns, func(x ledger.Txn) bool { return x.Key == key })
	if i < 0 {
		return ledger.Txn{}, false
	}
	return txns[i], true
}

// A forget refuses a character that does not exist and one already
// asked; it marks the character, and every later command on it, or naming
// it as a target, is refused and changes nothing.
func TestForgetRefusesAndMarks(t *testing.T) {
	g := guardGame(t)
	cs := fgChars(t, g, 2)
	c, d := cs[0], cs[1]
	_, err := g.Act(Command{Key: "fg-none", Char: "c-99", Kind: Forget})
	refusedWith(t, err, NoSuchChar)
	advance(t, g)
	before := c.Version
	res, err := g.Act(Command{Key: "fg-forget", Char: c.C.ID, Kind: Forget})
	if err != nil {
		t.Fatal(err)
	}
	if c.Forget != g.Tick() || res.Char != c || c.Version != before+1 || len(res.Facts) != 0 {
		t.Fatalf("forget marked tick %d (now %d), version %d from %d, %d facts", c.Forget, g.Tick(), c.Version, before, len(res.Facts))
	}
	if !g.IsForgotten(c.C.ID) || g.IsForgotten(d.C.ID) || g.IsForgotten("c-99") {
		t.Fatal("IsForgotten does not read the mark")
	}
	digest, _ := g.Digest()
	for _, cmd := range []Command{
		{Key: "fg-again", Char: c.C.ID, Kind: Forget},
		{Key: "fg-step", Char: c.C.ID, Kind: Step, Dir: 0},
		{Key: "fg-rest", Char: c.C.ID, Kind: Rest},
		{Key: "fg-correct", Char: c.C.ID, Kind: Correct, Asset: ledger.Coin, Units: 5, Note: "operator"},
		{Key: "fg-ban", Char: c.C.ID, Kind: Ban, Note: "operator"},
		{Key: "fg-invite", Char: d.C.ID, Kind: PartyInvite, Target: c.C.ID},
		{Key: "fg-give", Char: d.C.ID, Kind: Give, Target: c.C.ID, Asset: ledger.Coin, Units: 1},
	} {
		_, err := g.Act(cmd)
		refusedWith(t, err, ForgottenCode)
		if after, _ := g.Digest(); after != digest {
			t.Fatalf("a refused %s changed the game", cmd.Kind)
		}
	}
	fgDo(t, g, d, Command{Kind: Rest})
}

// A forget at the world's first tick is kept, since 0 reads as never asked.
func TestForgetAtTickZero(t *testing.T) {
	g := guardGame(t)
	c := fgChars(t, g, 1)[0]
	fgForget(t, g, c)
	if c.Forget != 1 {
		t.Fatalf("a forget at tick 0 marked %d", c.Forget)
	}
}

// The sweep withdraws a character's orders and goal, takes it out of its
// party and guild, then in one transaction keyed forget-<id> sends its
// coin to sink:forgotten, its staged goods to sink:staged and everything
// else to its tile's pool. The audit stays clean and nothing is drawn.
func TestForgetSweep(t *testing.T) {
	g := guardGame(t)
	cs := fgChars(t, g, 3)
	c, d, e := cs[0], cs[1], cs[2]
	fgDo(t, g, c, Command{Kind: PartyInvite, Target: d.C.ID})
	fgDo(t, g, d, Command{Kind: PartyJoin, Target: c.C.ID})
	if c.Party == "" || c.C.Guild == "" {
		t.Fatalf("setup: party %q, guild %q", c.Party, c.C.Guild)
	}
	fibre := alMaterial(t, g, "fibre")
	other := g.r.Book.Materials[0].ID
	if other == fibre {
		other = g.r.Book.Materials[1].ID
	}
	dirGive(t, g, c, ledger.Coin, 400)
	dirGive(t, g, c, ledger.Material(fibre), 9)
	dirGive(t, g, c, ledger.Provisions, 4)
	n, _ := g.SettlementAt(c.C.At)
	fgDo(t, g, c, Command{Kind: PostGoal, Goal: &GoalSpec{Title: "Four fibre", Issuer: goal.ByCharacter, Reward: 50, Mode: goal.First,
		Lifetime: goal.Ephemeral, Turnover: goal.Expire, Ticks: sheets.TicksPerDay, Cond: goal.Condition{Verb: goal.Deliver, Tag: "fibre", Count: 4, At: goal.SettlementRef(n)}}})
	x := g.Goals[len(g.Goals)-1]
	fgDo(t, g, c, Command{Kind: Ask, Material: fibre, Units: 3, Price: 900})
	fgDo(t, g, c, Command{Kind: Bid, Material: other, Units: 2, Price: 1})
	staged := ledger.Staged(n, fibre)
	if err := g.postAll(ledger.Move("fg-staged", "test", g.Tick(), ledger.FromStaged, ledger.Char(c.C.ID), staged, 3)); err != nil {
		t.Fatal(err)
	}
	audit(t, g)

	acc := ledger.Char(c.C.ID)
	var orders []Open
	for o := range g.opens(acc, false) {
		orders = append(orders, o)
	}
	if len(orders) != 2 {
		t.Fatalf("setup: %d open orders", len(orders))
	}
	coin := c.C.Coin + g.Ledger.Of(goalPool(x.ID), ledger.Coin)
	goods := map[string]int64{}
	for _, b := range g.Ledger.Held(acc) {
		if b.Asset != ledger.Coin && !ledger.IsStaged(b.Asset) {
			goods[b.Asset] += b.Units
		}
	}
	for _, o := range orders {
		for _, b := range g.Ledger.Held(ledger.EscrowPool(o.ID)) {
			if b.Asset == ledger.Coin {
				coin += b.Units
			} else {
				goods[b.Asset] += b.Units
			}
		}
	}
	pool := poolOf(c.C.At)
	poolBefore := map[string]int64{}
	for a := range goods {
		poolBefore[a] = g.Ledger.Of(pool, a)
	}
	pack := slices.Clone(c.C.Pack)
	forgottenBefore, stagedBefore := g.Ledger.Of(ledger.ToForgotten, ledger.Coin), g.Ledger.Of(ledger.ToStaged, staged)
	g.Ledger.Flush()

	fgForget(t, g, c)
	if c.Forgotten != 0 {
		t.Fatal("the command swept before the tick")
	}
	advance(t, g)
	if c.Forgotten != g.Tick() {
		t.Fatalf("swept at %d, the tick is %d", c.Forgotten, g.Tick())
	}
	txns := g.Ledger.Flush()
	if _, ok := fgTxn(txns, forgetPrefix+c.C.ID); !ok {
		t.Fatalf("no transaction keyed %s in %d", forgetPrefix+c.C.ID, len(txns))
	}
	if held := g.Ledger.Held(acc); len(held) != 0 {
		t.Fatalf("the forgotten character's account still holds %v", held)
	}
	if c.C.Coin != 0 || c.C.Provisions != 0 || len(c.C.Goods) != 0 || len(c.C.Staged) != 0 || len(c.C.Pack) != 0 || len(c.C.Equipped) != 0 {
		t.Fatalf("the forgotten character still carries %+v", c.C)
	}
	if got := g.Ledger.Of(ledger.ToForgotten, ledger.Coin) - forgottenBefore; got != coin {
		t.Fatalf("sink:forgotten took %d coin, want %d", got, coin)
	}
	if got := g.Ledger.Of(ledger.ToStaged, staged) - stagedBefore; got != 3 {
		t.Fatalf("sink:staged took %d staged units, want 3", got)
	}
	for a, n := range goods {
		if got := g.Ledger.Of(pool, a) - poolBefore[a]; got != n {
			t.Fatalf("the tile's pool took %d %s, want %d", got, a, n)
		}
	}
	for _, in := range pack {
		if g.Ledger.Of(pool, ledger.Item(in.ID)) != 1 || !slices.ContainsFunc(g.Left, func(l *Left) bool { return l.Item == in && l.By == c.C.ID && !l.Hidden }) {
			t.Fatalf("%s is not lying on the tile", in.ID)
		}
	}
	for range g.opens(acc, false) {
		t.Fatal("an order stands after the sweep")
	}
	if x.State == goal.Live || x.Why != "withdrawn" {
		t.Fatalf("the goal is %s (%s)", x.State, x.Why)
	}
	if c.Party != "" || d.Party != "" || len(g.Parties) != 0 {
		t.Fatalf("parties after the sweep: %q, %q, %d", c.Party, d.Party, len(g.Parties))
	}
	gd := g.GuildOf(e.C.Guild)
	if c.C.Guild != "" || gd == nil || gd.G.Member(c.C.ID) != nil {
		t.Fatal("the forgotten character is still in its guild")
	}
	audit(t, g)

	// Something owed to it later is swept on the next tick.
	if err := g.postAll(ledger.Move("fg-owed", "test", g.Tick(), ledger.FromOperator, acc, ledger.Coin, 7)); err != nil {
		t.Fatal(err)
	}
	advance(t, g)
	if c.C.Coin != 0 || g.Ledger.Of(ledger.ToForgotten, ledger.Coin)-forgottenBefore != coin+7 {
		t.Fatalf("a later payment stayed with the forgotten character: %d coin", c.C.Coin)
	}
	if _, ok := fgTxn(g.Ledger.Flush(), ledger.SubKey(forgetPrefix+c.C.ID, fmt.Sprint(g.Tick()))); !ok {
		t.Fatal("no later sweep keyed under the first")
	}
	advance(t, g)
	if txns := g.Ledger.Flush(); slices.ContainsFunc(txns, func(x ledger.Txn) bool { return x.Kind == forgetTxn }) {
		t.Fatal("a character holding nothing was swept again")
	}
	audit(t, g)
}

// The sweep waits while an ambush is on the character and runs once it
// has defaulted.
func TestForgetWaitsInAFight(t *testing.T) {
	g := guardGame(t)
	c := fgChars(t, g, 1)[0]
	at, ok := hex.Hex{}, false
	for _, h := range hex.DiscAt(c.C.At, delveSearch) {
		if len(g.Creatures(h)) > 0 && !g.IsDungeon(h) {
			at, ok = h, true
			break
		}
	}
	if !ok {
		t.Fatal("no tile with creatures")
	}
	c.C.At = at
	if err := g.begin(c, true, g.Tick()+3); err != nil {
		t.Fatal(err)
	}
	if c.Fight == nil || !c.Fight.Ambush {
		t.Fatal("setup: no ambush")
	}
	fgForget(t, g, c)
	for range 2 {
		advance(t, g)
		if c.Fight == nil || c.Forgotten != 0 {
			t.Fatalf("at %d: fight %v, swept at %d", g.Tick(), c.Fight != nil, c.Forgotten)
		}
	}
	for range 3 {
		advance(t, g)
	}
	if c.Fight != nil || c.Forgotten == 0 {
		t.Fatalf("after the ambush: fight %v, swept at %d", c.Fight != nil, c.Forgotten)
	}
	if held := g.Ledger.Held(ledger.Char(c.C.ID)); len(held) != 0 {
		t.Fatalf("still holds %v", held)
	}
	audit(t, g)
}

// The sweep waits while the character hauls a live goal's stock, and takes
// the stock to the tile's pool once the goal has lapsed.
func TestForgetWaitsOnTheRoad(t *testing.T) {
	g := guardGame(t)
	cs := fgChars(t, g, 2)
	poster, hauler := cs[0], cs[1]
	fibre := alMaterial(t, g, "fibre")
	dirGive(t, g, poster, ledger.Material(fibre), 10)
	dirGive(t, g, poster, ledger.Coin, 200)
	dirGive(t, g, hauler, ledger.Coin, 500)
	n, _ := g.SettlementAt(poster.C.At)
	far := poster.C.At.Neighbour(0)
	fgDo(t, g, poster, Command{Kind: PostGoal, Goal: &GoalSpec{Title: "Fibre out", Issuer: goal.ByCharacter, Reward: 20, Mode: goal.First,
		Lifetime: goal.Ephemeral, Turnover: goal.Expire, Ticks: sheets.TicksPerDay, Material: fibre, Units: 10,
		Cond: goal.Condition{Verb: goal.Haul, From: goal.SettlementRef(n), At: goal.TileRef(far), Count: 10}}})
	x := g.Goals[len(g.Goals)-1]
	fgDo(t, g, hauler, Command{Kind: TakeHaul, Target: x.ID})
	if g.Ledger.Of(ledger.Char(hauler.C.ID), ledger.Material(fibre)) != 10 {
		t.Fatal("setup: the hauler holds no stock")
	}
	fgForget(t, g, hauler)
	for x.State == goal.Live {
		advance(t, g)
		if x.State == goal.Live && hauler.Forgotten != 0 {
			t.Fatal("swept while hauling")
		}
		if g.Tick() > 3*sheets.TicksPerDay {
			t.Fatal("the haul never lapsed")
		}
	}
	advance(t, g)
	if hauler.Forgotten == 0 || g.Ledger.Of(ledger.Char(hauler.C.ID), ledger.Material(fibre)) != 0 {
		t.Fatalf("after the lapse: swept at %d", hauler.Forgotten)
	}
	if g.Ledger.Of(poolOf(hauler.C.At), ledger.Material(fibre)) < 10 {
		t.Fatal("the stock did not stay on the tile")
	}
	audit(t, g)
}

// A forgotten rescuer sets down whom it carries, since it never travels to
// end the carry, and is swept at once.
func TestForgetSetsDownWhatItCarries(t *testing.T) {
	g := guardGame(t)
	cs := fgChars(t, g, 2)
	rescuer, d := cs[0], cs[1]
	d.C.Set(char.Down, 0)
	rescuer.Carrying, d.CarriedBy = d.C.ID, rescuer.C.ID
	fgForget(t, g, rescuer)
	advance(t, g)
	if rescuer.Carrying != "" || d.CarriedBy != "" {
		t.Fatalf("still carrying %q, carried by %q", rescuer.Carrying, d.CarriedBy)
	}
	if rescuer.Forgotten == 0 {
		t.Fatal("not swept")
	}
	if held := g.Ledger.Held(ledger.Char(rescuer.C.ID)); len(held) != 0 {
		t.Fatalf("still holds %v", held)
	}
	audit(t, g)
}

// A forgotten character being carried is set down, freeing its carrier.
func TestForgetIsSetDown(t *testing.T) {
	g := guardGame(t)
	cs := fgChars(t, g, 2)
	carrier, d := cs[0], cs[1]
	d.C.Set(char.Down, 0)
	carrier.Carrying, d.CarriedBy = d.C.ID, carrier.C.ID
	fgForget(t, g, d)
	advance(t, g)
	if carrier.Carrying != "" || d.CarriedBy != "" {
		t.Fatalf("still carrying %q, carried by %q", carrier.Carrying, d.CarriedBy)
	}
	if d.Forgotten == 0 {
		t.Fatal("not swept")
	}
	if held := g.Ledger.Held(ledger.Char(d.C.ID)); len(held) != 0 {
		t.Fatalf("still holds %v", held)
	}
	audit(t, g)
}

// A forgotten player is a traveller to everyone: a viewer of its own
// server who could name it, its memories in an NPC's dossier, with no
// guild named beside it.
func TestForgetNamesATraveller(t *testing.T) {
	g := guardGame(t)
	cs := fgChars(t, g, 2)
	c, viewer := cs[0], cs[1]
	if got := NameFor(viewer, c, c.C.ID, "The Reedwardens"); got != c.C.ID {
		t.Fatalf("before: %q", got)
	}
	c.NameOther = true
	e := npc.Entry{Kind: entryFought, Player: c.C.ID, Tick: g.Tick()}
	names := map[string]string{}
	if v := g.memoryView(viewer, e, names); v.Who != c.C.ID {
		t.Fatalf("before: the dossier names %q", v.Who)
	}
	fgForget(t, g, c)
	other := &Char{C: viewer.C, Server: "s2"}
	for _, v := range []*Char{viewer, other} {
		if got := NameFor(v, c, c.C.ID, "The Reedwardens"); got != travellerName {
			t.Fatalf("after, to %s: %q", v.Server, got)
		}
		names := map[string]string{}
		if mv := g.memoryView(v, e, names); mv.Who != travellerName || len(names) != 0 {
			t.Fatalf("after, the dossier tells %q and names %v", mv.Who, names)
		}
	}
	if mv := g.memoryView(c, e, map[string]string{}); mv.Who != "you" {
		t.Fatalf("to itself: %q", mv.Who)
	}
}

// A party member forgotten while seated at an armed machine leaves the
// shared record as a ban does: the machine goes back to rest and the
// member is no longer in the record.
func TestForgetUnseatsAnArmedMachine(t *testing.T) {
	g, _, st := vaultWorld(t)
	cs := vaultParty(t, g, st.At, 2)
	vaultAct(t, g, cs[0], armVault)
	sh := g.sharedOf(cs[0])
	if sh == nil || !sh.Machine.Armed() || !slices.Contains(sh.Machine.Seats, cs[1].C.ID) {
		t.Fatal("setup: the vault is not armed with both seats")
	}
	fgForget(t, g, cs[1])
	advance(t, g)
	if cs[1].Forgotten == 0 {
		t.Fatal("the sweep did not run")
	}
	if sh.Machine.Armed() {
		t.Fatalf("the machine is still armed: %+v", sh.Machine)
	}
	if slices.Contains(sh.Members, cs[1].C.ID) {
		t.Fatal("the forgotten member is still in the shared record")
	}
	if cs[0].Armed != nil {
		t.Fatal("the remaining seat is still armed")
	}
	audit(t, g)
	if fault := g.OpenIndexFault(); fault != "" {
		t.Fatalf("open orders: %s", fault)
	}
}
