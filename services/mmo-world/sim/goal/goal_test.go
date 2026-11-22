package goal

import (
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

func live(c Condition, mode string, reward int64) *Goal {
	return &Goal{ID: "q-1", Poster: "c-9", Scope: World, Cond: c, Mode: mode, Reward: reward, Cap: 2, State: Live}
}

func defeat(who string, id fact.ID, tags ...string) Event {
	return Event{Fact: id, Verb: Defeat, Who: who, Kind: "eel", Tags: tags, Places: []string{"region:r1"}, Units: 1}
}

// TestFirstPaysTheFirstToTheCount and cites the facts that met it.
func TestFirstPaysTheFirstToTheCount(t *testing.T) {
	g := live(Condition{Verb: Defeat, Tag: "plated", Count: 2, At: "region:r1"}, First, 50)
	if c := g.Credit(defeat("a", 1, "plated")); c != nil {
		t.Fatalf("paid after one kill: %+v", c)
	}
	if c := g.Credit(defeat("b", 2, "soft")); c != nil || g.Total() != 1 {
		t.Fatalf("an unplated kill counted: %+v", g.Progress)
	}
	c := g.Credit(defeat("a", 3, "plated"))
	if len(c) != 1 || c[0].Who != "a" || c[0].Coin != 50 || len(c[0].Facts) != 2 || g.State != Done {
		t.Fatalf("claims %+v, state %s", c, g.State)
	}
	if g.Credit(defeat("b", 4, "plated")) != nil {
		t.Fatal("a met goal paid again")
	}
}

// TestEachPaysEveryoneUpToItsCap and then closes.
func TestEachPaysEveryoneUpToItsCap(t *testing.T) {
	g := live(Condition{Verb: Reach, Count: 1, At: "tile:3,4"}, Each, 20)
	reach := func(who string, id fact.ID) []Claim {
		return g.Credit(Event{Fact: id, Verb: Reach, Who: who, Places: []string{"tile:3,4"}})
	}
	if c := reach("a", 1); len(c) != 1 || g.State != Live {
		t.Fatalf("first claimant %+v %s", c, g.State)
	}
	if c := reach("a", 2); c != nil {
		t.Fatal("one claimant paid twice")
	}
	if c := reach("b", 3); len(c) != 1 || g.State != Done || len(g.Claims) != 2 {
		t.Fatalf("second claimant %+v %s %d", c, g.State, len(g.Claims))
	}
}

// TestPooledSplitsByContribution, the remainder to the largest.
func TestPooledSplitsByContribution(t *testing.T) {
	g := live(Condition{Verb: Deliver, Tag: "timber", Count: 10, At: "settlement:0"}, Pooled, 100)
	put := func(who string, n int64, id fact.ID) []Claim {
		return g.Credit(Event{Fact: id, Verb: Deliver, Who: who, Tags: []string{"timber"}, Places: []string{"settlement:0"}, Units: n, Goal: "q-1"})
	}
	put("a", 3, 1)
	if put("b", 2, 2) != nil {
		t.Fatal("paid before the counter filled")
	}
	c := put("c", 9, 3)
	if g.Total() != 10 || len(c) != 3 {
		t.Fatalf("total %d claims %+v", g.Total(), c)
	}
	var sum int64
	got := map[string]int64{}
	for _, x := range c {
		sum += x.Coin
		got[x.Who] = x.Coin
	}
	if sum != 100 || got["a"] != 30 || got["b"] != 20 || got["c"] != 50 {
		t.Fatalf("split %v", got)
	}
	if put("d", 1, 4) != nil {
		t.Fatal("a delivery bound to another goal or after the close counted")
	}
}

func TestEvenSharesSplitsEqually(t *testing.T) {
	g := live(Condition{Verb: Deliver, Count: 4}, Pooled, 10)
	g.Even = true
	g.Credit(Event{Fact: 1, Verb: Deliver, Who: "a", Units: 3})
	c := g.Credit(Event{Fact: 2, Verb: Deliver, Who: "b", Units: 1})
	if len(c) != 2 || c[0].Coin+c[1].Coin != 10 || abs(c[0].Coin-c[1].Coin) > 1 {
		t.Fatalf("even split %+v", c)
	}
}

func abs(n int64) int64 { return max(n, -n) }

// TestHoldCountsDaysRunning and starts again when the line breaks.
func TestHoldCountsDaysRunning(t *testing.T) {
	g := live(Condition{Verb: Hold, Gauge: "threat", Line: 700, Below: true, Count: 3, At: "region:r1"}, First, 40)
	g.Issuer.Kind = ByCharacter
	day := func(d, v int64) []Claim {
		return g.Credit(Event{Fact: fact.ID(d), Verb: Hold, Gauge: "threat", Value: v, Units: d, Places: []string{"region:r1"}, Goal: "q-1"})
	}
	day(1, 600)
	day(2, 650)
	day(3, 720)
	if g.Streak != 0 {
		t.Fatalf("a day over the line kept the streak at %d", g.Streak)
	}
	day(4, 600)
	day(5, 600)
	if day(5, 600) != nil {
		t.Fatal("one day read twice")
	}
	// Nobody fought for it: it is met and pays nobody, pledges included.
	if c := day(6, 600); len(c) != 0 || len(g.Claims) != 0 || g.State != Done {
		t.Fatalf("held three days with nobody fighting: %+v %s", c, g.State)
	}
}

// A party's Hold counts its days, which no character does, and pays the
// members who fought there.
func TestAPartyHoldCountsItsDays(t *testing.T) {
	g := live(Condition{Verb: Hold, Gauge: "threat", Line: 700, Below: true, Count: 2, At: "region:r1"}, Pooled, 40)
	g.Issuer.Kind, g.Scope, g.Members = ByParty, Party, []string{"c-9", "a"}
	g.Credit(defeat("a", 1))
	g.Credit(defeat("stranger", 2))
	day := func(d int64) []Claim {
		return g.Credit(Event{Fact: fact.ID(10 + d), Verb: Hold, Gauge: "threat", Value: 100, Units: d, Places: []string{"region:r1"}, Goal: "q-1"})
	}
	day(1)
	if c := day(2); len(c) != 1 || c[0].Who != "a" || c[0].Coin != 40 || g.State != Done {
		t.Fatalf("a party's Hold after its two days: %+v %s, streak %d", c, g.State, g.Streak)
	}
}

// TestVowBreaksOnTheThingHeldOff and is kept otherwise.
func TestVowBreaksOnTheThingHeldOff(t *testing.T) {
	g := &Goal{ID: "q-2", Poster: "a", Members: []string{"a"}, Scope: Personal, State: Live, Mode: First, Cond: Condition{Verb: Hold, Tag: "blade"}}
	g.Credit(Event{Verb: Equip, Who: "b", Tags: []string{"blade"}})
	g.Credit(Event{Verb: Equip, Who: "a", Tags: []string{"plate"}})
	if !g.Kept() {
		t.Fatal("a vow broke on someone else's blade or on plate")
	}
	g.Credit(Event{Verb: Equip, Who: "a", Tags: []string{"blade"}})
	if g.Kept() {
		t.Fatal("equipping a blade kept the vow")
	}
}

// TestMetReadsFactsThroughSee: the contract's Met over facts.
func TestMetReadsFactsThroughSee(t *testing.T) {
	facts := []fact.Fact{{ID: 1, Kind: "x"}, {ID: 2, Kind: "x"}}
	see := func(f fact.Fact) (Event, bool) { return defeat("a", f.ID, "plated"), true }
	if !Met(Condition{Verb: Defeat, Count: 2}, facts, see) || Met(Condition{Verb: Defeat, Count: 3}, facts, see) {
		t.Fatal("Met miscounted")
	}
}

// TestWithinReadsDistance from a tile.
func TestWithinReadsDistance(t *testing.T) {
	h := hex.Hex{}
	c := Condition{Verb: Discover, Field: "ore", AtLeast: 70, Hex: &h, Within: 12, Count: 1}
	near := Event{Verb: Discover, Hex: hex.Hex{Q: 5}, Fields: map[string]int64{"ore": 80}}
	far := Event{Verb: Discover, Hex: hex.Hex{Q: 13}, Fields: map[string]int64{"ore": 90}}
	poor := Event{Verb: Discover, Hex: hex.Hex{Q: 2}, Fields: map[string]int64{"ore": 30}}
	if !c.Matches(near) || c.Matches(far) || c.Matches(poor) {
		t.Fatal("Discover within 12 tiles of ore 70 misread")
	}
}

// TestTurnover at a season's close.
func TestTurnover(t *testing.T) {
	base := func(turn string) *Goal {
		g := live(Condition{Verb: Deliver, Count: 100, At: "settlement:9"}, Pooled, 10)
		g.Lifetime, g.Turnover = Season, turn
		g.Credit(Event{Fact: 1, Verb: Deliver, Who: "a", Units: 40, Places: []string{"settlement:9"}})
		return g
	}
	if !base(Expire).Turn(2, 90, 100, nil) {
		t.Fatal("an expiring goal did not end")
	}
	for _, life := range []string{Season, Standing} {
		p := base(Keep)
		p.State, p.Lifetime = Proposed, life
		if !p.Turn(2, 90, 100, nil) {
			t.Fatalf("a %s proposal short of its need outlived the season", life)
		}
	}
	r := base(Reset)
	r.Turn(2, 90, 100, nil)
	k := base(Keep)
	k.Turn(2, 90, 100, nil)
	e := base(Evolve)
	e.Turn(2, 90, 150, func(string) string { return "settlement:0" })
	if r.Total() != 0 || k.Total() != 40 || e.Cond.Count != 150 || e.Cond.At != "settlement:0" || e.Season != 2 {
		t.Fatalf("reset %d, carry %d, evolve %+v", r.Total(), k.Total(), e.Cond)
	}
}

// TestValidHoldsTheLimits of GDD 11.5.
func TestValidHoldsTheLimits(t *testing.T) {
	l := Limits{RewardLeast: 10, EachCap: 50, PartyMost: 6, TitleLen: 60, NoteLen: 300, EphemeralLeast: 6, EphemeralMost: 432}
	ok := &Goal{Title: "t", Cond: Condition{Verb: Defeat, Count: 1}, Mode: First, Lifetime: Standing, Turnover: Keep, Reward: 10}
	if err := Valid(ok, 0, l); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*Goal){
		"small reward": func(g *Goal) { g.Reward = 5 },
		"no verb":      func(g *Goal) { g.Cond.Verb = "harm" },
		"each no cap":  func(g *Goal) { g.Mode = Each },
		"long ephemeral": func(g *Goal) {
			g.Lifetime, g.Expires = Ephemeral, 1000
		},
		"deliver nowhere": func(g *Goal) { g.Cond.Verb = Deliver },
		"a deliver by trait": func(g *Goal) {
			g.Cond = Condition{Verb: Deliver, Count: 1, At: "settlement:0", Trait: "keen"}
		},
		"a deliver within a distance": func(g *Goal) {
			g.Cond = Condition{Verb: Deliver, Count: 1, At: "settlement:0", Hex: &hex.Hex{}, Within: 3}
		},
		"a reach of a kind": func(g *Goal) { g.Cond = Condition{Verb: Reach, Count: 1, At: "settlement:0", Kind: "eel"} },
		"a gauge hold by tag": func(g *Goal) {
			g.Cond = Condition{Verb: Hold, Gauge: "threat", Count: 1, At: "region:r1", Tag: "blade"}
		},
		"a defeat of someone": func(g *Goal) { g.Cond.Who = "c-1" },
		"no title":            func(g *Goal) { g.Title = "" },
	} {
		g := *ok
		change(&g)
		if Valid(&g, 0, l) == nil {
			t.Errorf("%s was valid", name)
		}
	}
}

// TestPooledHoldPaysWhoFoughtThere: kills in the region while it holds
// share the reward.
func TestPooledHoldPaysWhoFoughtThere(t *testing.T) {
	g := live(Condition{Verb: Hold, Gauge: "threat", Line: 700, Below: true, Count: 1, At: "region:r1"}, Pooled, 30)
	g.Issuer.Kind = BySettlement
	g.Credit(defeat("a", 1))
	g.Credit(defeat("a", 2))
	g.Credit(defeat("b", 3))
	c := g.Credit(Event{Fact: 4, Verb: Hold, Gauge: "threat", Value: 100, Units: 1, Places: []string{"region:r1"}, Goal: "q-1"})
	if len(c) != 2 || c[0].Coin+c[1].Coin != 30 {
		t.Fatalf("claims %+v", c)
	}
}

// An evolved amount never falls to or below what is already counted, so
// the goal can still be met and pays no more than its reward.
func TestEvolveKeepsTheCountAboveWhatIsCounted(t *testing.T) {
	g := live(Condition{Verb: Deliver, Count: 100}, Pooled, 90)
	g.Lifetime, g.Turnover = Season, Evolve
	put := func(who string, n int64, id fact.ID) []Claim {
		return g.Credit(Event{Fact: id, Verb: Deliver, Who: who, Units: n})
	}
	put("a", 40, 1)
	put("b", 20, 2)
	g.Turn(1, 12, 50, nil)
	if g.Cond.Count != 61 {
		t.Fatalf("halved under 60 counted, the count is %d, want 61", g.Cond.Count)
	}
	c := put("c", 5, 3)
	var paid int64
	for _, cl := range c {
		paid += cl.Coin
		if cl.Coin < 0 || cl.Units < 0 {
			t.Fatalf("a negative share: %+v", c)
		}
	}
	if g.State != Done || paid != 90 || g.Progress.Get("c") != 1 {
		t.Fatalf("state %s, paid %d of 90, progress %v", g.State, paid, g.Progress)
	}

	f := live(Condition{Verb: Defeat, Count: 10}, First, 50)
	f.Lifetime, f.Turnover = Season, Evolve
	for i := range 6 {
		f.Credit(Event{Fact: fact.ID(i + 1), Verb: Defeat, Who: "a", Units: 1})
	}
	f.Turn(1, 12, 30, nil)
	if f.Cond.Count != 7 || len(f.Credit(Event{Fact: 9, Verb: Defeat, Who: "a", Units: 1})) != 1 {
		t.Fatalf("a first-mode goal evolved to %d with 6 counted, state %s", f.Cond.Count, f.State)
	}
}

// A Haul has one stock, so it is never an Each goal, and a vow to hold
// off a thing holds no coin.
func TestValidRefusesAnEachHaulAndAPaidVow(t *testing.T) {
	l := Limits{RewardLeast: 10, EachCap: 50, PartyMost: 4, TitleLen: 60, NoteLen: 300, EphemeralLeast: 6, EphemeralMost: 432}
	haul := &Goal{Title: "Timber east", Cond: Condition{Verb: Haul, Count: 5, At: "settlement:1", From: "settlement:0"}, Reward: 10, Mode: Each, Cap: 3,
		Lifetime: Standing, Turnover: Keep}
	if Valid(haul, 0, l) == nil {
		t.Fatal("an Each Haul is valid")
	}
	haul.Mode = First
	if err := Valid(haul, 0, l); err != nil {
		t.Fatalf("a first Haul: %v", err)
	}
	vow := &Goal{Title: "No blade", Cond: Condition{Verb: Hold, Tag: "blade"}, Reward: 10, Mode: First, Lifetime: Season, Turnover: Expire}
	if Valid(vow, 0, l) == nil {
		t.Fatal("a vow to hold off a thing took a reward")
	}
	huge := &Goal{Title: "Too much", Cond: Condition{Verb: Defeat, Count: 1}, Reward: 1 << 62, Mode: Each, Cap: 4, Lifetime: Standing, Turnover: Keep}
	if Valid(huge, 0, l) == nil {
		t.Fatal("a reward that wraps its escrow is valid")
	}
}

// TestValidBack: a side is the story's, posted by a faction or the world
// with its side named, and lives as long as its stage; a character's post
// of one is refused.
func TestValidBack(t *testing.T) {
	l := Limits{RewardLeast: 10, EachCap: 50, PartyMost: 4, TitleLen: 60, NoteLen: 300, EphemeralLeast: 6, EphemeralMost: 432}
	side := func(issuer, s string) *Goal {
		return &Goal{Title: "Supply the garrison", Issuer: Ref{Kind: issuer, ID: "0"}, Scope: World, Mode: Pooled, Reward: 100,
			Cond:     Condition{Verb: Back, Side: s, Count: 50, At: "settlement:0"},
			Lifetime: Ephemeral, Expires: 1729, Turnover: Expire}
	}
	for _, issuer := range []string{ByFaction, ByWorld} {
		if err := Valid(side(issuer, "arc-1/0/garrison"), 0, l); err != nil {
			t.Errorf("a %s side: %v", issuer, err)
		}
	}
	for name, g := range map[string]*Goal{
		"a character's side":  side(ByCharacter, "arc-1/0/garrison"),
		"a party's side":      side(ByParty, "arc-1/0/garrison"),
		"a settlement's side": side(BySettlement, "arc-1/0/garrison"),
		"a muster's side":     side(ByAdmin, "arc-1/0/garrison"),
		"no side":             side(ByFaction, ""),
	} {
		if Valid(g, 0, l) == nil {
			t.Errorf("%s was valid", name)
		}
	}
	over := side(ByFaction, "arc-1/0/garrison")
	if Valid(over, over.Expires, l) == nil {
		t.Error("a side past its stage was valid")
	}
	if Valid(&Goal{Title: "Hold", Cond: Condition{Verb: Defeat, Count: 1, Side: "arc-1/0/a"}, Mode: First, Reward: 10,
		Lifetime: Standing, Turnover: Keep, Issuer: Ref{Kind: ByFaction}}, 0, l) == nil {
		t.Error("a side on a verb that is not Back was valid")
	}
}
