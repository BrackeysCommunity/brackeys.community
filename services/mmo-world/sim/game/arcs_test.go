package game

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// dirCast casts a template by hand at the first settlement, as an
// operator's arc-cast does.
func dirCast(t *testing.T, g *Game, template string, cast arc.Cast) *Arc {
	t.Helper()
	a, err := g.CastArc(template, cast, g.SettlementHex(0), ByOperator, g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// siegeCast is the siege of faction 0's holding by faction 1, seated at the
// first settlement.
func siegeCast(t *testing.T, g *Game) arc.Cast {
	t.Helper()
	held := g.heldRegions(0)
	if len(g.World.Factions) < 2 || len(held) == 0 {
		t.Fatalf("a siege needs a holder with a holding and a besieger: %d factions, holdings %v", len(g.World.Factions), held)
	}
	return arc.Cast{{Role: "besieger", Ref: arc.FactionRef(1)}, {Role: "holder", Ref: arc.FactionRef(0)},
		{Role: "holding", Ref: arc.HoldingRef(held[0])}, {Role: seatRole, Ref: arc.SettlementRef(0)}}
}

// successionCast is a succession in faction 0 between two of its living
// notables, seated at the first settlement.
func successionCast(t *testing.T, g *Game) arc.Cast {
	t.Helper()
	var ids []string
	for _, n := range g.World.Factions[0].Notables {
		if !n.Dead {
			ids = append(ids, notableID(n.ID))
		}
	}
	if len(ids) < 2 {
		t.Fatalf("a succession needs two living notables, faction 0 has %v", ids)
	}
	return arc.Cast{{Role: "faction", Ref: arc.FactionRef(0)}, {Role: "claimant-a", Ref: fact.Ref{Kind: kindNotable, ID: ids[0]}},
		{Role: "claimant-b", Ref: fact.Ref{Kind: kindNotable, ID: ids[1]}}, {Role: seatRole, Ref: arc.SettlementRef(0)}}
}

// sideNamed is a running stage's side.
func sideNamed(t *testing.T, a *Arc, id string) SideRun {
	t.Helper()
	for _, s := range a.Stages[a.Stage].Sides {
		if s.Side == id {
			return s
		}
	}
	t.Fatalf("%s stage %d has no side %q", a.ID, a.Stage, id)
	return SideRun{}
}

// dirChars are n characters standing at the first settlement.
func dirChars(t *testing.T, g *Game, n int) []*Char {
	t.Helper()
	var out []*Char
	for i := range n {
		c := mustCreate(t, g, fmt.Sprintf("dir-%d-%d", len(g.Chars), i), "knife")
		c.C.At = g.SettlementHex(0)
		out = append(out, c)
	}
	return out
}

// dirGive hands a character goods as an operator's correction.
func dirGive(t *testing.T, g *Game, c *Char, asset string, n int64) {
	t.Helper()
	key := fmt.Sprintf("give-%s-%d", c.C.ID, g.Log.Len())
	if _, err := g.Act(Command{Key: key, Char: c.C.ID, Kind: Correct, Asset: asset, Units: n, Note: "test"}); err != nil {
		t.Fatal(err)
	}
}

// dirBack sends goods to a side's goal.
func dirBack(t *testing.T, g *Game, c *Char, x string, asset string, n int64) {
	t.Helper()
	key := fmt.Sprintf("back-%s-%d", c.C.ID, g.Log.Len())
	if _, err := g.Act(Command{Key: key, Char: c.C.ID, Kind: BackSide, Target: x, Asset: asset, Units: n}); err != nil {
		t.Fatal(err)
	}
}

func dirTick(t *testing.T, g *Game) {
	t.Helper()
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
}

func timberAsset(t *testing.T, g *Game) string {
	t.Helper()
	for _, m := range g.r.Book.Materials {
		if slices.Contains(m.Tags, tagTimber) {
			return ledger.Material(m.ID)
		}
	}
	t.Fatal("no timber in the sheets")
	return ""
}

func coins(cs []*Char) []int64 {
	out := make([]int64, len(cs))
	for i, c := range cs {
		out[i] = c.C.Coin
	}
	return out
}

func pending(g *Game, kind string) []world.Action {
	var out []world.Action
	for _, a := range g.Pending {
		if a.Kind == kind {
			out = append(out, a)
		}
	}
	return out
}

// TestSupplyTheGarrison: the siege's garrison side is posted from the
// holder's budget, held out of the day's faction orders, filled by
// deliveries at the seat and paid to the deliverers by what they gave;
// the besiegers' unfilled escrow goes back, the walls begin and the
// garrison's win fortifies the holding (GDD 12.2).
func TestSupplyTheGarrison(t *testing.T) {
	g := guardGame(t)
	a := dirCast(t, g, "the-siege", siegeCast(t, g))
	garrison, besiegers := sideNamed(t, a, "garrison"), sideNamed(t, a, "besiegers")
	x, y := g.GoalOf(garrison.Goal), g.GoalOf(besiegers.Goal)
	p := g.r.Story
	if garrison.Sponsor != 0 || garrison.Opponent != 1 || x.Issuer != (goal.Ref{Kind: goal.ByFaction, ID: "0"}) || x.Cond.At != goal.SettlementRef(0) {
		t.Fatalf("garrison %+v, goal %+v", garrison, x)
	}
	if garrison.Mark != arc.Mark(25, 0, p.MarkFloorCharacters) || x.Cond.Count != garrison.Mark {
		t.Fatalf("an unattended garrison's mark is the floor's: %d", garrison.Mark)
	}
	var budget int64
	budgets := g.Budgets()
	for _, n := range g.heldFrom(a) {
		budget += budgets[n]
	}
	want := arc.Reward(garrison.Mark, g.r.Values.Asset(ledger.Provisions), p.SidePay, budget, p.SideBudgetShare)
	if x.Reward != want || x.Reward <= 0 || g.Ledger.Of(goalPool(x.ID), ledger.Coin) != want {
		t.Fatalf("garrison escrow %d, pool %d, want %d inside half of %d", x.Reward, g.Ledger.Of(goalPool(x.ID), ledger.Coin), want, budget)
	}
	var held int64
	for _, h := range g.sideHelds(budgets) {
		held += h
	}
	if held != x.Reward+y.Reward {
		t.Fatalf("held %d out of the day's orders, the sides minted %d", held, x.Reward+y.Reward)
	}
	cs := dirChars(t, g, 3)
	for _, c := range cs {
		dirGive(t, g, c, ledger.Provisions, 30)
	}
	before, back := coins(cs), g.Ledger.Of(ledger.ToFaction, ledger.Coin)
	for i, n := range []int64{20, 20, 10} {
		dirBack(t, g, cs[i], x.ID, ledger.Provisions, n)
	}
	dirTick(t, g)
	if x.State != goal.Done || a.Stage != 1 || a.Stages[0].Won != "garrison" || a.Stages[0].Ended != g.Tick() {
		t.Fatalf("met garrison: goal %s, arc at stage %d, stage 0 %+v", x.State, a.Stage, a.Stages[0])
	}
	var paid int64
	for i, c := range cs {
		got := c.C.Coin - before[i]
		if got < x.Reward*[]int64{20, 20, 10}[i]/garrison.Mark {
			t.Fatalf("%s gave %d of %d and was paid %d of %d", c.C.ID, []int64{20, 20, 10}[i], garrison.Mark, got, x.Reward)
		}
		paid += got
	}
	if paid != x.Reward || y.State != goal.Ended || y.Why != whyStageEnded || g.Ledger.Of(goalPool(y.ID), ledger.Coin) != 0 {
		t.Fatalf("paid %d of %d; besiegers %s/%s holding %d", paid, x.Reward, y.State, y.Why, g.Ledger.Of(goalPool(y.ID), ledger.Coin))
	}
	if got := g.Ledger.Of(ledger.ToFaction, ledger.Coin) - back; got != y.Reward {
		t.Fatalf("the unbacked besiegers' %d should go back to the faction, %d did", y.Reward, got)
	}
	if fs := pending(g, world.ActFortify); len(fs) != 1 || fs[0].Units != 15 || fs[0].Cause == 0 {
		t.Fatalf("the garrison's win fortifies the holding: %+v", fs)
	}
	if ended := factsOf(g, "arc.stage-ended"); len(ended) != 1 || !hasDatum(ended[0], "side", "garrison") {
		t.Fatalf("stage-ended facts %+v", ended)
	}
	if len(factsOf(g, "arc.stage-began")) != 1 || len(a.Stages) != 2 || a.Stages[1].Due <= g.Tick() {
		t.Fatalf("the walls should begin at once: %+v", a.Stages)
	}
	dirTick(t, g)
	if len(factsOf(g, "faction.fortified")) != 1 {
		t.Fatal("the fortify was not applied the tick after")
	}
	audit(t, g)
}

func hasDatum(f fact.Fact, key, s string) bool {
	d, ok := f.Get(key)
	return ok && d.S == s
}

// successionAt casts a succession and fills its first stage's sides by
// hand: claimant-a's provisions and claimant-b's timber, as listed.
func successionAt(t *testing.T, g *Game, a, b []int64) (*Arc, []*Char, []*Char) {
	t.Helper()
	arcOf := dirCast(t, g, "the-succession", successionCast(t, g))
	xa, xb := sideNamed(t, arcOf, "claimant-a").Goal, sideNamed(t, arcOf, "claimant-b").Goal
	timber := timberAsset(t, g)
	as, bs := dirChars(t, g, len(a)), dirChars(t, g, len(b))
	for i, n := range a {
		dirGive(t, g, as[i], ledger.Provisions, n)
		dirBack(t, g, as[i], xa, ledger.Provisions, n)
	}
	for i, n := range b {
		dirGive(t, g, bs[i], timber, n)
		dirBack(t, g, bs[i], xb, timber, n)
	}
	return arcOf, as, bs
}

// splitOf is what a side's contributors are owed when it is not met.
func splitOf(x *Goal, mark int64, share int64) map[string]int64 {
	pays, _ := arc.Split(x.Reward, share, mark, x.Progress)
	out := map[string]int64{}
	for _, p := range pays {
		out[p.Who] = p.Coin
	}
	return out
}

// TestStageMetEarlyPaysTheOther: a side met before the deadline ends the
// stage at once; the other side's backers get side-pay-other of its share,
// scaled by how far they filled it, the rest goes back, and the next stage
// starts the same tick.
func TestStageMetEarlyPaysTheOther(t *testing.T) {
	g := guardGame(t)
	a := dirCast(t, g, "the-succession", successionCast(t, g))
	sa, sb := sideNamed(t, a, "claimant-a"), sideNamed(t, a, "claimant-b")
	xa, xb := g.GoalOf(sa.Goal), g.GoalOf(sb.Goal)
	as, bs := dirChars(t, g, 1), dirChars(t, g, 1)
	timber := timberAsset(t, g)
	dirGive(t, g, bs[0], timber, sb.Mark/2)
	dirBack(t, g, bs[0], xb.ID, timber, sb.Mark/2)
	dirGive(t, g, as[0], ledger.Provisions, sa.Mark)
	before, back := coins(append(as, bs...)), g.Ledger.Of(ledger.ToFaction, ledger.Coin)
	owed := splitOf(xb, sb.Mark, g.r.Story.SidePayOther)[bs[0].C.ID]
	dirBack(t, g, as[0], xa.ID, ledger.Provisions, sa.Mark)
	dirTick(t, g)
	if a.Stage != 1 || a.Stages[0].Won != "claimant-a" || a.Stages[0].Ended != g.Tick() || a.Stages[1].Began != g.Tick() {
		t.Fatalf("met early: stage %d, %+v", a.Stage, a.Stages)
	}
	half := fixed.PercentFloor(xb.Reward, g.r.Story.SidePayOther) * (sb.Mark / 2) / sb.Mark
	if owed != half || owed <= 0 {
		t.Fatalf("claimant-b half filled is owed %d, the rule gives %d", owed, half)
	}
	if got := bs[0].C.Coin - before[1]; got != owed {
		t.Fatalf("claimant-b's backer was paid %d, owed %d", got, owed)
	}
	if got := as[0].C.Coin - before[0]; got != xa.Reward {
		t.Fatalf("claimant-a's backer met it alone and was paid %d of %d", got, xa.Reward)
	}
	if got := g.Ledger.Of(ledger.ToFaction, ledger.Coin) - back; got != xb.Reward-owed {
		t.Fatalf("back to the faction %d, want %d", got, xb.Reward-owed)
	}
	if xb.State != goal.Ended || len(xb.Claims) != 1 || xb.Claims[0].Coin != owed {
		t.Fatalf("claimant-b's goal %s, claims %+v", xb.State, xb.Claims)
	}
	if loyal := pending(g, world.ActLoyalty); len(loyal) != 1 || loyal[0].Units != 10 {
		t.Fatalf("claimant-a's win raises its loyalty: %+v", loyal)
	}
	audit(t, g)
}

// TestStageLapsePaysBothByContribution: a stage that runs out pays every
// side side-pay-other of its share, scaled by how far it filled, split by
// what each backer gave; the lapse effects queue and the next stage starts.
func TestStageLapsePaysBothByContribution(t *testing.T) {
	g := guardGame(t)
	a, as, bs := successionAt(t, g, []int64{10, 20}, []int64{10})
	xa, xb := g.GoalOf(sideNamed(t, a, "claimant-a").Goal), g.GoalOf(sideNamed(t, a, "claimant-b").Goal)
	share := g.r.Story.SidePayOther
	owedA, owedB := splitOf(xa, sideNamed(t, a, "claimant-a").Mark, share), splitOf(xb, sideNamed(t, a, "claimant-b").Mark, share)
	before := coins(append(as, bs...))
	a.Stages[0].Due = g.Tick() + 1
	dirTick(t, g)
	if a.Stage != 1 || !a.Stages[0].Lapsed || a.Stages[0].Won != "" {
		t.Fatalf("lapsed stage: %+v", a.Stages[0])
	}
	for i, c := range append(as, bs...) {
		owed := owedA[c.C.ID] + owedB[c.C.ID]
		if got := c.C.Coin - before[i]; got != owed || owed <= 0 {
			t.Fatalf("%s was paid %d, owed %d by contribution", c.C.ID, got, owed)
		}
	}
	if owedA[as[1].C.ID] <= owedA[as[0].C.ID] {
		t.Fatalf("the larger contribution is owed more: %v", owedA)
	}
	if g.Ledger.Of(goalPool(xa.ID), ledger.Coin) != 0 || g.Ledger.Of(goalPool(xb.ID), ledger.Coin) != 0 {
		t.Fatal("a lapsed side's escrow is left in its pool")
	}
	if loyal := pending(g, world.ActLoyalty); len(loyal) != 2 || loyal[0].Units != -10 || loyal[1].Units != -10 {
		t.Fatalf("the mourning's lapse costs both claimants loyalty: %+v", loyal)
	}
	if ended := factsOf(g, "arc.stage-ended"); len(ended) != 1 || !hasDatum(ended[0], "side", outcomeLapsed) {
		t.Fatalf("stage-ended %+v", ended)
	}
	audit(t, g)
}

// TestMarksScaleWithActiveCharacters: a side's mark is its per for each
// character active in the arc's regions, floored at mark-floor-characters;
// a thread's is thread-mark for its one character.
func TestMarksScaleWithActiveCharacters(t *testing.T) {
	floor := int64(0)
	for _, n := range []int{0, 1, 2, 10, 100} {
		g := guardGame(t)
		p := g.r.Story
		floor = p.MarkFloorCharacters
		dirChars(t, g, n)
		a := dirCast(t, g, "the-succession", successionCast(t, g))
		want := 25 * max(int64(n), floor)
		for _, s := range a.Stages[0].Sides {
			if s.Mark != want || g.GoalOf(s.Goal).Cond.Count != want {
				t.Fatalf("%d active: side %s mark %d, want %d", n, s.Side, s.Mark, want)
			}
		}
		audit(t, g)
	}
	if floor != 2 {
		t.Fatalf("mark-floor-characters is %d", floor)
	}
	g := guardGame(t)
	c := dirChars(t, g, 1)[0]
	dirChars(t, g, 10)
	a := dirCast(t, g, "the-oath", arc.Cast{{Role: "character", Ref: char.Ref(c.C.ID)}, {Role: "board", Ref: arc.SettlementRef(0)}})
	for _, s := range a.Stages[0].Sides {
		if s.Mark != g.r.Story.ThreadMark {
			t.Fatalf("a thread's side %s asks %d, not thread-mark %d", s.Side, s.Mark, g.r.Story.ThreadMark)
		}
	}
	if a.Char != c.C.ID || len(factsOf(g, "thread.cast")) != 1 || len(factsOf(g, "arc.cast")) != 0 {
		t.Fatalf("a thread is its character's: %+v", a)
	}
	audit(t, g)
}

// overrunAt is a hand-built region candidate on region r alone.
func overrunAt(g *Game, r int) arc.Candidate {
	return arc.Candidate{Cast: arc.Sorted(arc.Cast{{Role: "front", Ref: arc.RegionRef(r)}, {Role: seatRole, Ref: arc.SettlementRef(0)}}),
		Regions: []int{r}, Seat: g.regionHex(r), Place: -1}
}

// TestRegionSlots: region arcs run at most RegionSlots at once, and never
// two on one region; the director's own casting stops at the slots.
func TestRegionSlots(t *testing.T) {
	g := guardGame(t)
	tpl, _ := g.template("the-overrun")
	p := g.pacing(arc.Region)
	slots := arc.RegionSlots(p.AtOnce, p.PerRegions, int64(len(g.World.Regions)))
	if want := max(int64(len(g.World.Regions))*2/6, 1); slots != want {
		t.Fatalf("%d awake regions give %d slots, want %d", len(g.World.Regions), slots, want)
	}
	if int64(len(g.World.Regions)) <= slots+1 {
		t.Fatalf("the world has too few regions to fill %d slots", slots)
	}
	if _, err := g.castFrom(tpl, overrunAt(g, 1), ByDirector, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if _, err := g.castFrom(tpl, overrunAt(g, 1), ByDirector, g.Tick()); !refusedAs(err, SlotBusy) {
		t.Fatalf("a second arc on region 1: %v", err)
	}
	for r := 2; int64(len(g.openArcs(arc.Region))) < slots; r++ {
		if _, err := g.castFrom(tpl, overrunAt(g, r), ByDirector, g.Tick()); err != nil {
			t.Fatal(err)
		}
	}
	next := int(slots) + 1
	if _, err := g.castFrom(tpl, overrunAt(g, next), ByDirector, g.Tick()); !refusedAs(err, SlotBusy) {
		t.Fatalf("a region arc past %d slots: %v", slots, err)
	}
	if err := g.castRegions(g.storyView(), g.Tick()); err != nil || int64(len(g.openArcs(arc.Region))) != slots {
		t.Fatalf("the director cast past the slots: %d open, %v", len(g.openArcs(arc.Region)), err)
	}
	audit(t, g)
}

// TestRests: an ended arc rests its scope's refs for the scope's rest
// days, the predicates see them busy, and the rest is forgotten once run.
func TestRests(t *testing.T) {
	g := guardGame(t)
	dirTick(t, g)
	tpl, _ := g.template("the-overrun")
	a, err := g.castFrom(tpl, overrunAt(g, 3), ByDirector, g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	c := dirChars(t, g, 1)[0]
	thread := dirCast(t, g, "the-oath", arc.Cast{{Role: "character", Ref: char.Ref(c.C.ID)}, {Role: "board", Ref: arc.SettlementRef(0)}})
	raid := dirCast(t, g, "raid", arc.Cast{{Role: rolePlace, Ref: arc.SettlementRef(0)}, {Role: roleSource, Ref: arc.RegionRef(g.World.RegionAt(g.SettlementHex(0)))}})
	now := g.Tick()
	for _, x := range []*Arc{a, thread, raid} {
		x.Stages[0].Due = now
	}
	if err := g.stagesDue(now); err != nil {
		t.Fatal(err)
	}
	w := g.storyView()
	for _, r := range []struct {
		scope string
		ref   fact.Ref
	}{{arc.Region, arc.RegionRef(3)}, {arc.Personal, char.Ref(c.C.ID)}, {arc.Settlement, arc.SettlementRef(0)}} {
		i, ok := slices.BinarySearchFunc(g.Story.Rests, ScopeRest{Scope: r.scope, Ref: r.ref}, cmpRest)
		days := g.pacing(r.scope).RestDays
		if !ok || g.Story.Rests[i].Until != now+days*sheets.TicksPerDay || !w.Busy(r.scope, r.ref) {
			t.Fatalf("%s %s should rest %d days: %+v", r.scope, r.ref, days, g.Story.Rests)
		}
	}
	g.storyKept(now + g.pacing(arc.Region).RestDays*sheets.TicksPerDay)
	if slices.ContainsFunc(g.Story.Rests, func(r ScopeRest) bool { return r.Scope == arc.Region }) {
		t.Fatalf("a region rest run out is kept: %+v", g.Story.Rests)
	}
	if !slices.ContainsFunc(g.Story.Rests, func(r ScopeRest) bool { return r.Scope == arc.Personal }) {
		t.Fatal("the thread's rest is longer than the region's")
	}
	audit(t, g)
}

// TestArcCastRefusedChangesNothing: every refusal of a hand-bound cast
// leaves the digest as it was.
func TestArcCastRefusedChangesNothing(t *testing.T) {
	g := guardGame(t)
	cast := siegeCast(t, g)
	misfit := slices.Clone(cast)
	misfit[0].Ref = arc.RegionRef(0)
	missing := cast[1:]
	gone := slices.Clone(cast)
	gone[0].Ref = arc.FactionRef(len(g.World.Factions) + 5)
	extra := append(slices.Clone(cast), arc.Binding{Role: "nobody", Ref: arc.RegionRef(0)})
	cmd := func(key, template string, cast arc.Cast) Command {
		return Command{Key: key, Kind: ArcCast, Arc: &ArcCmd{Template: template, Cast: cast}}
	}
	refused := func(c Command, code string) {
		t.Helper()
		before := digestOf(t, g)
		if _, err := g.Act(c); !refusedAs(err, code) {
			t.Fatalf("%s: %v, want %s", c.Key, err, code)
		}
		if digestOf(t, g) != before {
			t.Fatalf("%s changed the game", c.Key)
		}
	}
	refused(cmd("no-such", "the-long-siege", cast), NoTemplate)
	refused(cmd("occasion", "caravan", arc.Cast{{Role: rolePlace, Ref: arc.SettlementRef(0)}}), NoTemplate)
	refused(cmd("misfit", "the-siege", misfit), CastMisfit)
	refused(cmd("missing", "the-siege", missing), CastMisfit)
	refused(cmd("gone", "the-siege", gone), CastMisfit)
	refused(cmd("extra", "the-siege", extra), CastMisfit)
	if _, err := g.Act(cmd("first", "the-siege", cast)); err != nil {
		t.Fatal(err)
	}
	refused(cmd("second", "the-succession", successionCast(t, g)), SlotBusy)
	raid := arc.Cast{{Role: rolePlace, Ref: arc.SettlementRef(0)}}
	if _, err := g.Act(cmd("raid", "raid", raid)); err != nil {
		t.Fatal(err)
	}
	refused(cmd("raid-again", "fire", raid), SlotBusy)
	audit(t, g)

	old := guardGame(t)
	old.Story = nil
	before := digestOf(t, old)
	if _, err := old.Act(cmd("no-season", "the-siege", siegeCast(t, old))); !refusedAs(err, NoSeason) || digestOf(t, old) != before {
		t.Fatalf("a world with no season: %v", err)
	}
}

// troubleAt casts a trouble at the first settlement by hand.
func troubleAt(t *testing.T, g *Game, id string) *Arc {
	t.Helper()
	r := g.World.RegionAt(g.SettlementHex(0))
	cast := arc.Cast{{Role: rolePlace, Ref: arc.SettlementRef(0)}, {Role: roleSource, Ref: arc.RegionRef(r)}}
	if id == "panic" {
		cast = append(cast, arc.Binding{Role: roleFaction, Ref: arc.FactionRef(0)})
	}
	return dirCast(t, g, id, cast)
}

// lose lapses a trouble now.
func lose(t *testing.T, g *Game, a *Arc) {
	t.Helper()
	if err := g.endStage(a, "", g.Tick()); err != nil {
		t.Fatal(err)
	}
}

// TestTroubleRaidLost: a raid's mark is its defence per user after the
// keepers' watch, its hunt opens through OpenHunt, and lost it damages the
// first of its structures standing, raises fees for its days, notes the
// raid got in and rests the place.
func TestTroubleRaidLost(t *testing.T) {
	g := guardGame(t)
	p := g.r.Story
	a := troubleAt(t, g, "raid")
	hold := sideNamed(t, a, sideHold)
	users := g.storyView().placeUsers()[0]
	if want := max(arc.DefenceMark(7, users, p.MarkFloorCharacters, 0, 0)-p.KeeperWatch, 1); hold.Mark != want {
		t.Fatalf("raid mark %d, want %d", hold.Mark, want)
	}
	if a.Hunt != "" && !slices.ContainsFunc(g.Hunts, func(x *Hunt) bool { return x.H.ID == a.Hunt && x.H.Row == "raid-band" && x.Why == WhyTrouble }) {
		t.Fatalf("the raid's hunt %q is not the raid-band", a.Hunt)
	}
	if len(factsOf(g, "trouble.started")) != 1 {
		t.Fatal("no trouble.started")
	}
	x := g.GoalOf(hold.Goal)
	back := g.Ledger.Of(ledger.ToFaction, ledger.Coin)
	market := g.Places[0].Get(structureMarket).Condition
	lose(t, g, a)
	now := g.Tick()
	if got := g.Places[0].Get(structureMarket).Condition; got != market-g.r.Settle.TroubleDamage {
		t.Fatalf("the market stood at %d and is now %d", market, got)
	}
	ps := g.storyAt(0)
	if ps.Lost != 1 || ps.Followed != now || ps.Fees != now+3*sheets.TicksPerDay || g.feeShare(0, now) != p.FeesRaised {
		t.Fatalf("lost raid stakes %+v", ps)
	}
	fee := g.r.Values.Fee(1000)
	if g.marketFee(0, 1000) != fixed.PercentFloor(fee, p.FeesRaised) {
		t.Fatalf("a raised fee is %d, not %d", g.marketFee(0, 1000), fixed.PercentFloor(fee, p.FeesRaised))
	}
	if g.feeShare(0, now+3*sheets.TicksPerDay) != fixed.Hundredths {
		t.Fatal("the raised fees outlive their days")
	}
	if got := g.Ledger.Of(ledger.ToFaction, ledger.Coin) - back; got != x.Reward || x.State != goal.Ended {
		t.Fatalf("a lost trouble pays nobody: %d of %d back", got, x.Reward)
	}
	if unrest := pending(g, world.ActGauge); len(unrest) != 1 || unrest[0].Tag != "unrest" || unrest[0].Units != 20 {
		t.Fatalf("a lost raid's unrest: %+v", unrest)
	}
	if len(factsOf(g, "trouble.lost")) != 1 || len(factsOf(g, "structure.damaged")) != 1 || !g.storyView().Busy(arc.Settlement, arc.SettlementRef(0)) {
		t.Fatal("a lost raid's facts and rest")
	}
	audit(t, g)
}

// TestTroubleHeldPaysItsDefenders: a shortage held by deliveries pays its
// whole escrow by contribution and eases scarcity.
func TestTroubleHeldPaysItsDefenders(t *testing.T) {
	g := guardGame(t)
	a := troubleAt(t, g, "shortage")
	hold := sideNamed(t, a, sideHold)
	x := g.GoalOf(hold.Goal)
	cs := dirChars(t, g, 2)
	before := coins(cs)
	for i, c := range cs {
		n := []int64{hold.Mark - hold.Mark/2, hold.Mark / 2}[i]
		if n == 0 {
			continue
		}
		dirGive(t, g, c, ledger.Provisions, n)
		dirBack(t, g, c, x.ID, ledger.Provisions, n)
	}
	dirTick(t, g)
	if a.Ended == 0 || a.Outcome != sideHold || g.storyAt(0).Held != 1 || len(factsOf(g, "trouble.held")) != 1 {
		t.Fatalf("held shortage: %+v", a)
	}
	var paid int64
	for i, c := range cs {
		paid += c.C.Coin - before[i]
	}
	if paid != x.Reward {
		t.Fatalf("defenders paid %d of %d", paid, x.Reward)
	}
	if eased := pending(g, world.ActGauge); len(eased) != 1 || eased[0].Tag != "scarcity" || eased[0].Units != -30 {
		t.Fatalf("a held shortage eases scarcity: %+v", eased)
	}
	audit(t, g)
}

// TestTroubleStakes: a lost shortage cuts the faction's prices at the
// place, panic stops its orders, sickness makes repairs dearer.
func TestTroubleStakes(t *testing.T) {
	bids := func(g *Game) map[string]int64 {
		out := map[string]int64{}
		for _, b := range g.Market.Books {
			for _, o := range b.Bids {
				if o.Faction != nil && b.Settlement == 0 {
					out[b.Material+"/"+o.Owner] = o.Price
				}
			}
		}
		return out
	}
	orders := func(t *testing.T, g *Game) map[string]int64 {
		t.Helper()
		if err := g.postFactionOrders(g.Tick()); err != nil {
			t.Fatal(err)
		}
		return bids(g)
	}
	g := guardGame(t)
	plain := orders(t, g)
	if len(plain) == 0 {
		t.Fatal("no faction bids at the first settlement")
	}
	lose(t, g, troubleAt(t, g, "shortage"))
	if g.priceShare(0, g.Tick()) != g.r.Story.PricesCut {
		t.Fatal("a lost shortage leaves prices whole")
	}
	for k, price := range orders(t, g) {
		if was, ok := plain[k]; !ok || price != max(fixed.PercentFloor(was, g.r.Story.PricesCut), 1) {
			t.Fatalf("%s bid %d under a shortage, %d before", k, price, was)
		}
	}

	g.Story.Arcs = nil
	lose(t, g, troubleAt(t, g, "panic"))
	if !g.ordersStopped(0, g.Tick()) {
		t.Fatal("a lost panic leaves the orders")
	}
	if got := orders(t, g); len(got) != 0 {
		t.Fatalf("panic stopped nothing: %v", got)
	}

	g.Story.Arcs = nil
	lose(t, g, troubleAt(t, g, "sickness"))
	if g.sickShare(0, g.Tick()) != g.r.Story.SickShare {
		t.Fatal("a lost sickness leaves rest and repairs as they were")
	}
	p := g.Places[0]
	row := g.r.structures[structureMarket]
	st := *p.Get(structureMarket)
	st.Condition--
	sick := g.repairCost(p, row, st, 1)
	g.Story.At[0].Sick = 0
	well := g.repairCost(p, row, st, 1)
	if want := settleScaled(well, g.r.Story.SickShare); !slices.Equal(sick, want) {
		t.Fatalf("a repair under sickness costs %+v, want %+v", sick, want)
	}
	audit(t, g)
}

func settleScaled(lines []sheets.CostLine, pct int64) []sheets.CostLine {
	return settle.Scaled(lines, pct)
}

// TestRaidSlainBeforeTheDayHolds: a raid's band slain on the tick before a
// day tick still holds the raid, though the day forgets the closed hunt.
func TestRaidSlainBeforeTheDayHolds(t *testing.T) {
	g := guardGame(t)
	lineOn(t, g, homeRegion(g), "threat-raid", 850)
	a := castTrouble(t, g, "raid", 0)
	c := dirChars(t, g, 1)[0]
	for g.Tick() < sheets.TicksPerDay-1 {
		dirTick(t, g)
	}
	i := slices.IndexFunc(g.Hunts, func(x *Hunt) bool { return x.H.ID == a.Hunt })
	if a.Hunt == "" || i < 0 || a.over() {
		t.Fatalf("the raid's hunt %q is not open a tick before the day", a.Hunt)
	}
	x := g.Hunts[i]
	x.H.Over, x.H.Slain = true, true
	if err := g.huntSlain(c, x, "slay", g.Tick()); err != nil {
		t.Fatal(err)
	}
	dirTick(t, g)
	if slices.ContainsFunc(g.Hunts, func(h *Hunt) bool { return h.H.ID == a.Hunt }) {
		t.Fatal("the day kept the closed hunt, so this proves nothing")
	}
	if a.Outcome != sideHold || g.storyAt(0).Held != 1 || len(factsOf(g, "trouble.held")) != 1 {
		t.Fatalf("a band slain before the day: %+v", a)
	}
	audit(t, g)
}

// TestDroppedTemplateLapses: a running arc whose template a later book
// dropped lapses at its due, its escrow refunded, and the world goes on.
func TestDroppedTemplateLapses(t *testing.T) {
	g := guardGame(t)
	tpl, _ := g.template("the-overrun")
	a, err := g.castFrom(tpl, overrunAt(g, 1), ByDirector, g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	var goals []*Goal
	for _, sr := range a.Stages[0].Sides {
		goals = append(goals, g.GoalOf(sr.Goal))
	}
	b := *g.r.Book
	b.Arcs = slices.DeleteFunc(slices.Clone(b.Arcs), func(r sheets.ArcRow) bool { return r.ID == "the-overrun" })
	r, err := NewRules(&b, keys.Throwaway("guards"))
	if err != nil {
		t.Fatal(err)
	}
	g.r = r
	a.Stages[0].Due = g.Tick() + 1
	dirTick(t, g)
	dirTick(t, g)
	if a.Outcome != outcomeLapsed || !a.Stages[0].Lapsed {
		t.Fatalf("the dropped arc: %+v", a)
	}
	for _, x := range goals {
		if x.Open() || g.Ledger.Of(goalPool(x.ID), ledger.Coin) != 0 {
			t.Fatalf("side %s is %s holding %d", x.ID, x.State, g.Ledger.Of(goalPool(x.ID), ledger.Coin))
		}
	}
	audit(t, g)
}

// TestUnpendTakesItsOwnKind: a return cast for a character who also owes
// an oath on the same settlement takes the return off the queue, not the
// oath.
func TestUnpendTakesItsOwnKind(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "both", "knife")
	g.pend(arc.Pending{Kind: arc.PendOath, Char: c.C.ID, Ref: arc.SettlementRef(0), Tick: g.Tick()})
	g.pend(arc.Pending{Kind: arc.PendReturn, Char: c.C.ID, Ref: arc.SettlementRef(0), Tick: g.Tick()})
	tpl, _ := g.template("the-return")
	kind, ok := arc.PendKind(tpl.Row.When)
	if !ok || kind != arc.PendReturn {
		t.Fatalf("the return reads %q", kind)
	}
	cand := arc.Candidate{Char: c.C.ID, Place: -1, Cast: arc.Sorted(arc.Cast{{Role: "character", Ref: char.Ref(c.C.ID)},
		{Role: "home", Ref: arc.SettlementRef(0)}, {Role: "elsewhere", Ref: arc.SettlementRef(1)}})}
	g.unpend(cand, kind)
	if len(g.Story.Pending) != 1 || g.Story.Pending[0].Kind != arc.PendOath {
		t.Fatalf("pending after the return: %+v", g.Story.Pending)
	}
}

// TestSideEscrowStaysInsideWhatIsLeft: sides held from a spent place and a
// fresh one take their escrow where budget remains, so together they never
// pass what was left.
func TestSideEscrowStaysInsideWhatIsLeft(t *testing.T) {
	g := guardGame(t)
	p := g.r.Story
	left := []int64{0, 1_000_000}
	from := []int{0, 1}
	whole := left[0] + left[1]
	held := make([]int64, len(left))
	var minted int64
	for range 3 {
		reward := arc.Reward(1_000_000, 1_000_000, p.SidePay, left[0]+left[1], p.SideBudgetShare)
		takeHeld(reward, from, left, held)
		minted += reward
	}
	if minted <= 0 || minted > whole || held[0] != 0 || held[1] != minted || left[1] != whole-minted {
		t.Fatalf("minted %d of %d, held %v, left %v", minted, whole, held, left)
	}
}

// TestCloseEndsWorldArcAtItsStage: the close lapses a world arc's running
// stage and ends it there, starting none of the stages after.
func TestCloseEndsWorldArcAtItsStage(t *testing.T) {
	g := guardGame(t)
	a := dirCast(t, g, "the-siege", siegeCast(t, g))
	if g.stages(a) != 3 || a.Stage != 0 {
		t.Fatalf("the siege runs %d stages, at %d", g.stages(a), a.Stage)
	}
	began := len(factsOf(g, "arc.stage-began"))
	if err := g.endDue(a, g.Tick(), true); err != nil {
		t.Fatal(err)
	}
	if a.Outcome != outcomeLapsed || len(a.Stages) != 1 || !a.Stages[0].Lapsed {
		t.Fatalf("the closed siege: %+v", a)
	}
	if got := len(factsOf(g, "arc.stage-began")); got != began || len(factsOf(g, "arc.ended")) != 1 {
		t.Fatalf("the close began %d stages", got-began)
	}
	audit(t, g)
}
