package game

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/world"
)

// customReward is what the settlement goal the customs tests renew pays.
const customReward = 40

// renewed is a world whose first settlement's own goal has carried over
// three season closes, with the custom it made and the day of its third
// close.
func renewed(t *testing.T) (*Game, *emerge.CustomRec, int64) {
	t.Helper()
	g := feedGame(t)
	poster := mustCreate(t, g, "custom-poster", "knife")
	x := &Goal{Title: "Bring reedflax", Issuer: goal.Ref{Kind: goal.BySettlement, ID: goal.SettlementRef(0)}, Poster: poster.C.ID,
		Scope: goal.Settlement, Board: 0, Reward: customReward, Mode: goal.Pooled, Lifetime: goal.Season, Turnover: goal.Keep,
		Cond: goal.Condition{Verb: goal.Deliver, Kind: "reedflax", Count: 5, At: goal.SettlementRef(0)}, Posted: g.Tick(), State: goal.Live}
	g.openGoal(x)
	sig := signature(x)
	if l := g.Emergence.Lines[sig]; l == nil || l.Place != 0 {
		t.Fatalf("a settlement's goal keeps line %+v", l)
	}
	need := line(g, emerge.Custom).Count
	var closed int64
	for n := range need {
		c, _, _ := g.Season()
		closed = c.Start + c.Days
		advanceTo(t, g, closed, nil)
		s := g.Emergence.Sigs[sig]
		if s == nil || s.Streak != n+1 {
			t.Fatalf("after %d closes the signature runs %+v", n+1, s)
		}
		if made := len(g.Emergence.Customs); n+1 < need && made != 0 {
			t.Fatalf("a custom after %d seasons", n+1)
		}
	}
	if len(g.Emergence.Customs) != 1 || len(promotionsOf(g, emerge.Custom)) != 1 {
		t.Fatalf("after %d seasons the customs are %+v", need, g.Emergence.Customs)
	}
	rec := g.Emergence.Customs[0]
	p := g.Emergence.Promotion(rec.ID)
	if rec.Place != 0 || rec.Held != g.Emergence.Season-1 || p == nil || len(p.Places) != 1 || p.Places[0] != 0 || p.First != "" {
		t.Fatalf("the custom is %+v, its promotion %+v", rec, p)
	}
	return g, rec, closed
}

// customFacts are the custom facts written since a fact.
func customFacts(g *Game, from fact.ID) []fact.Fact {
	var out []fact.Fact
	for _, f := range g.Log.Since(from) {
		if f.Kind == factCustomHeld || f.Kind == factCustomSkipped {
			out = append(out, f)
		}
	}
	return out
}

// A settlement's goal carried over three seasons running becomes a custom
// at the third close, and the world posts it in the next season from the
// treasury: the original's target and count, pooled, for the season.
func TestCustomThreeSeasons(t *testing.T) {
	g, rec, closed := renewed(t)
	fund := ledger.Move("custom-fund", "test", g.Tick(), ledger.FromOperator, TreasuryPool(0), ledger.Coin, customReward)
	if err := g.post(fund); err != nil {
		t.Fatal(err)
	}
	treasury := g.Ledger.Of(TreasuryPool(0), ledger.Coin)
	from := fact.ID(g.Log.Len())
	advanceTo(t, g, closed+2, nil)
	fs := customFacts(g, from)
	if len(fs) != 1 || fs[0].Kind != factCustomHeld {
		t.Fatalf("the custom's facts are %+v", fs)
	}
	id, _ := fs[0].Get("goal")
	x := g.GoalOf(id.S)
	if x == nil || !customGoal(x) || x.State != goal.Live || x.Mode != goal.Pooled || x.Lifetime != goal.Season ||
		x.Cond.Kind != "reedflax" || x.Cond.Count != 5 || x.Reward != customReward || x.Board != 0 {
		t.Fatalf("the custom posted %+v", x)
	}
	if !slices.Contains(fs[0].Subjects, promotionRef(rec.ID)) || !slices.Contains(fs[0].Subjects, arc.SettlementRef(0)) {
		t.Fatalf("custom.held names %+v", fs[0].Subjects)
	}
	if g.Ledger.Of(TreasuryPool(0), ledger.Coin) != treasury-customReward || g.Ledger.Of(goalPool(x.ID), ledger.Coin) != customReward {
		t.Fatal("the custom's reward did not move from the treasury into its escrow")
	}
	if backer(x) != TreasuryPool(0) {
		t.Fatalf("what nobody claims of the custom goes back to %s", backer(x))
	}
	if rec.Held != g.Emergence.Season {
		t.Fatalf("the custom was held in season %d, now %d", rec.Held, g.Emergence.Season)
	}
	audit(t, g)

	// Posted once a season, and a custom's own goal renews nothing more.
	advanceTo(t, g, closed+g.storyDays()/2, nil)
	if fs := customFacts(g, from); len(fs) != 1 {
		t.Fatalf("the custom was held %d times in one season", len(fs))
	}
	if len(g.Emergence.Customs) != 1 {
		t.Fatalf("%d customs", len(g.Emergence.Customs))
	}
}

// A treasury short of the custom's reward skips the season: a fact says by
// how much, and no goal is posted or coin moved.
func TestCustomSkipsShortTreasury(t *testing.T) {
	g, rec, closed := renewed(t)
	have := g.Ledger.Of(TreasuryPool(0), ledger.Coin)
	if have >= customReward {
		drain := ledger.Move("custom-drain", "test", g.Tick(), TreasuryPool(0), ledger.ToOperator, ledger.Coin, have-customReward+1)
		if err := g.post(drain); err != nil {
			t.Fatal(err)
		}
		have = customReward - 1
	}
	goals := len(g.Goals)
	from := fact.ID(g.Log.Len())
	advanceTo(t, g, closed+2, nil)
	fs := customFacts(g, from)
	if len(fs) != 1 || fs[0].Kind != factCustomSkipped {
		t.Fatalf("the custom's facts are %+v", fs)
	}
	if short, _ := fs[0].Get("short"); short.N != customReward-have {
		t.Fatalf("the skip says %d short, want %d", short.N, customReward-have)
	}
	for _, x := range g.Goals[goals:] {
		if customGoal(x) {
			t.Fatalf("a short treasury still posted %+v", x)
		}
	}
	if g.Ledger.Of(TreasuryPool(0), ledger.Coin) > have || rec.Held != g.Emergence.Season {
		t.Fatalf("the skip moved coin or did not hold the season: %+v", rec)
	}
	audit(t, g)
}

// won is an encounter won against an archetype on a tile, credited to the
// goals.
func won(t *testing.T, g *Game, h hex.Hex, arch, who string) {
	t.Helper()
	first := fact.ID(g.Log.Len())
	f, err := g.r.weights.New(g.Tick(), "encounter.won", world.RegionRef(g.World.RegionAt(h)), []fact.Ref{char.Ref(who)}, nil,
		append(fact.At(h), fact.S("archetype", arch), fact.S("tags", ""))...)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.Log.Append(f); err != nil {
		t.Fatal(err)
	}
	if err := g.creditGoals(first, fmt.Sprintf("won-%d", first)); err != nil {
		t.Fatal(err)
	}
}

// Two live First goals for different guilds racing to defeat the same
// thing in one region are indexed as a rival claim once each has its
// contributors, and not before; goals for one guild are no rivals, and a
// claim lasts while both goals stand.
func TestContestIndexed(t *testing.T) {
	g := feedGame(t)
	tiles := openTiles(t, g, 60)
	// A second guild's place beside the first, read only by the index.
	second := *g.Places[0]
	second.N, second.Hex, second.Lattice = len(g.Places), tiles[len(tiles)-1], -1
	g.Places = append(g.Places, &second)
	g.Places[0].Guild, second.Guild = "g-a", "g-b"
	arch := g.r.Book.Creatures[0].ID
	r := g.World.RegionAt(g.SettlementHex(0))
	var ha, hb hex.Hex
	found := false
	for i, x := range tiles {
		for _, y := range tiles[i+1:] {
			if !found && g.World.RegionAt(x) == r && g.World.RegionAt(y) == r && hex.Distance(x, y) > 2 {
				ha, hb, found = x, y, true
			}
		}
	}
	if !found {
		t.Fatal("no two tiles apart in the first settlement's region")
	}
	post := func(board int, h hex.Hex) *Goal {
		x := &Goal{Title: "First to it", Issuer: goal.Ref{Kind: goal.ByCharacter, ID: "c-x"}, Scope: goal.World, Board: board,
			Cond: goal.Condition{Verb: goal.Defeat, Kind: arch, Count: 5, Hex: &h, Within: 1},
			Mode: goal.First, Lifetime: goal.Season, Turnover: goal.Expire, Posted: g.Tick(), State: goal.Live}
		g.openGoal(x)
		return x
	}
	a, b, same := post(0, ha), post(second.N, hb), post(0, ha)
	need := int(g.r.Emerge.P.OpposedContributors)
	for i := range need {
		won(t, g, ha, arch, fmt.Sprintf("a-%d", i))
	}
	for i := range need - 1 {
		won(t, g, hb, arch, fmt.Sprintf("b-%d", i))
	}
	if n := len(g.contests()); n != 0 || len(a.Progress) != need || len(same.Progress) != need || len(b.Progress) != need-1 {
		t.Fatalf("%d contests with contributors %d, %d, %d", n, len(a.Progress), len(b.Progress), len(same.Progress))
	}
	won(t, g, hb, arch, fmt.Sprintf("b-%d", need-1))
	won(t, g, hb, arch, fmt.Sprintf("b-%d", need))
	got := g.contests()
	if len(got) != 2 {
		t.Fatalf("contests %+v, want a and the same guild's each against b", got)
	}
	for _, c := range got {
		pair := []string{c.A, c.B}
		if !slices.Contains(pair, b.ID) || c.Region != r || c.Tag != arch || c.SeatA == c.SeatB || cmpID(c.A, c.B) >= 0 {
			t.Fatalf("contest %+v", c)
		}
	}
	a.End("withdrawn")
	if got := g.contests(); len(got) != 1 || got[0].A != b.ID || got[0].B != same.ID {
		t.Fatalf("with a ended the contests are %+v", got)
	}
	if err := linesDay(g, g.World.Day, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if len(g.Emergence.Contests) != 1 {
		t.Fatalf("the day kept %d contests, want the live one", len(g.Emergence.Contests))
	}
}
