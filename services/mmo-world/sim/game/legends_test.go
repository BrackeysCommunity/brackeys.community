package game

import (
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// noted writes a fact with data on a tile and passes it through the
// traces' seam, as a command's news is.
func noted(t *testing.T, g *Game, kind string, h hex.Hex, subjects []fact.Ref, data ...fact.Datum) fact.Fact {
	t.Helper()
	region := ""
	if r := g.World.RegionAt(h); r >= 0 {
		region = world.RegionRef(r)
	}
	f, err := g.r.weights.New(g.Tick(), kind, region, subjects, nil, append(fact.At(h), data...)...)
	if err != nil {
		t.Fatal(err)
	}
	if f.ID, err = g.Log.Append(f); err != nil {
		t.Fatal(err)
	}
	got, _ := g.Log.Get(f.ID)
	g.keepNews([]fact.Fact{got})
	mustFeed(t, g.takeTraceErr())
	return got
}

// lost is an encounter lost (or left) against an archetype on a tile.
func lost(t *testing.T, g *Game, kind string, h hex.Hex, a sheets.Creature, who ...string) {
	t.Helper()
	var subjects []fact.Ref
	for _, w := range who {
		subjects = append(subjects, char.Ref(w))
	}
	subjects = append(subjects, fact.Ref{Kind: "archetype", ID: a.ID})
	noted(t, g, kind, h, subjects, fact.S("archetype", a.ID), fact.S("tags", strings.Join(a.Tags, ",")))
}

// advanceTo plays the world to a world day, calling each before every tick.
func advanceTo(t *testing.T, g *Game, day int64, each func()) {
	t.Helper()
	for g.World.Day < day {
		if each != nil {
			each()
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
}

// lineBy is this season's line whose signature starts with prefix.
func lineBy(g *Game, prefix string) *emerge.Line {
	for _, sig := range slices.Sorted(maps.Keys(g.Emergence.Lines)) {
		if strings.HasPrefix(sig, prefix) {
			return g.Emergence.Lines[sig]
		}
	}
	return nil
}

// otherRegion is a region other than r whose centre lies in it.
func otherRegion(t *testing.T, g *Game, r int) int {
	t.Helper()
	for i := range g.World.Regions {
		if i != r && g.World.RegionAt(g.regionHex(i)) == i {
			return i
		}
	}
	t.Fatal("no second region")
	return -1
}

// A faction's bounty re-posted all season and never met, with 25 attempts
// against what it hunts, becomes a legend at the close; a standing line
// one attempt short does not, and a character's repeat on one day counts
// once.
func TestLegendFromBounty(t *testing.T) {
	g := feedGame(t)
	poster := mustCreate(t, g, "legend-poster", "knife")
	ti := g.World.GaugeIndex("threat")
	hot := func() {
		for i := range g.World.Regions {
			g.World.Regions[i].Gauge[ti] = g.gp("bounty-threat") + 1
		}
	}
	c, _, _ := g.Season()
	closeDay := c.Start + c.Days
	advanceTo(t, g, 2, hot)
	bl := lineBy(g, goal.ByFaction+sigSep)
	if bl == nil || bl.Archetype != "" || bl.Place != -1 {
		t.Fatalf("the bounty keeps line %+v", bl)
	}
	need := line(g, emerge.Legend).Count
	beasts := g.r.Book.Creatures
	for i := range need {
		kind := factEncounterLost
		if i%2 == 1 {
			kind = factEncounterLeft
		}
		lost(t, g, kind, bl.At, beasts[0], fmt.Sprintf("x-%d", i))
	}
	if bl.Archetype != beasts[0].ID || int64(len(bl.Attempts.IDs)) != need {
		t.Fatalf("the bounty's line reads %+v", bl)
	}

	r2 := otherRegion(t, g, bl.Region)
	h2 := g.regionHex(r2)
	x := &Goal{Title: "Bring it down", Issuer: goal.Ref{Kind: goal.ByCharacter, ID: poster.C.ID}, Poster: poster.C.ID, Scope: goal.World,
		Cond: goal.Condition{Verb: goal.Defeat, Kind: beasts[1].ID, Count: 1, At: goal.RegionRef(world.RegionRef(r2))},
		Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep, Posted: g.Tick(), State: goal.Live}
	g.openGoal(x)
	sl := g.Emergence.Lines[signature(x)]
	if sl == nil || !sl.Standing || sl.Archetype != beasts[1].ID {
		t.Fatalf("a standing goal keeps line %+v", sl)
	}
	for i := range need - 1 {
		lost(t, g, factEncounterLost, h2, beasts[1], fmt.Sprintf("y-%d", i))
	}
	lost(t, g, factEncounterLost, h2, beasts[1], "y-0")
	lost(t, g, factEncounterLost, h2, beasts[0], "y-other")
	if int64(len(sl.Attempts.IDs)) != need-1 {
		t.Fatalf("the standing line counts %d attempts, want %d", len(sl.Attempts.IDs), need-1)
	}

	advanceTo(t, g, closeDay-1, hot)
	if days := g.Emergence.Lines[bl.Sig].Days; days != closeDay-1 {
		t.Fatalf("the bounty stood posted %d of the season's first %d days", days, closeDay-1)
	}
	advanceTo(t, g, closeDay, hot)
	legends := promotionsOf(g, emerge.Legend)
	if len(legends) != 1 {
		t.Fatalf("%d legends, want the bounty's alone: %+v", len(legends), legends)
	}
	p := legends[0]
	want := fact.Ref{Kind: kindCreature, ID: beasts[0].ID}
	if p.Of != want.String() || p.Region != bl.Region || p.First != "" || p.Season != c.N {
		t.Fatalf("the legend is %+v", p)
	}
	if name := g.r.Name("creatures.archetypes:" + beasts[0].ID); name == "" || !strings.HasPrefix(p.Name, name) {
		t.Fatalf("the legend is named %q", p.Name)
	}
	rec := g.legendOf(want, bl.Region)
	if rec == nil || rec.ID != p.ID || rec.At != bl.At || !slices.ContainsFunc(g.r.Book.LegendTraits, func(l sheets.LegendTrait) bool { return l.ID == rec.Trait }) {
		t.Fatalf("the legend's record is %+v", rec)
	}
	f, _ := g.Log.Get(p.Fact)
	if ty, _ := f.Get("type"); f.Kind != factPromotion || ty.S != string(emerge.Legend) {
		t.Fatalf("the legend's fact is %+v", f)
	}
}

// heavy names an item and its holder in a heavy fact.
func heavy(t *testing.T, g *Game, c *Char, item string) {
	t.Helper()
	noted(t, g, "hunt.slain", c.C.At, []fact.Ref{char.Ref(c.C.ID), {Kind: renownItem, ID: item}})
}

// An item named by five heavy facts in a season becomes a legend, its
// holder the first and its name the item's; the trait rides on its record.
func TestLegendFromItem(t *testing.T) {
	g := feedGame(t)
	c := mustCreate(t, g, "legend-holder", "knife")
	in := c.C.In(char.Hand, 0)
	if in == nil {
		t.Fatal("the knife start holds nothing in hand")
	}
	need := line(g, emerge.Legend).Heavy
	for range need - 1 {
		heavy(t, g, c, in.ID)
	}
	if n := len(promotionsOf(g, emerge.Legend)); n != 0 {
		t.Fatalf("%d legends one heavy fact short", n)
	}
	heavy(t, g, c, in.ID)
	heavy(t, g, c, in.ID)
	legends := promotionsOf(g, emerge.Legend)
	if len(legends) != 1 {
		t.Fatalf("%d legends, want one", len(legends))
	}
	p := legends[0]
	ref := fact.Ref{Kind: renownItem, ID: in.ID}
	if p.Of != ref.String() || p.First != c.C.ID || !strings.HasPrefix(p.Name, g.KindName(in.Kind)) {
		t.Fatalf("the item legend is %+v", p)
	}
	if s := g.Emergence.Renown[ref.String()]; s == nil || s.Done != p.ID {
		t.Fatalf("the item's renown is %+v", s)
	}
	rec := g.Emergence.Legends[len(g.Emergence.Legends)-1]
	if rec.ID != p.ID || rec.Of != ref || rec.Trait == "" {
		t.Fatalf("the item legend's record is %+v", rec)
	}
	if in.Legend == "" || in.Legend != g.traitTag(rec.Trait) || slices.Contains(in.Picks, string(in.Legend)) {
		t.Fatalf("the item carries legend tag %q, picks %v, for trait %s", in.Legend, in.Picks, rec.Trait)
	}
}

// A rename is the first's, once, within its days, and screened; each
// refusal changes nothing.
func TestPromoteNameRefusals(t *testing.T) {
	g := feedGame(t)
	c := mustCreate(t, g, "namer", "knife")
	other := mustCreate(t, g, "not-namer", "knife")
	in := c.C.In(char.Hand, 0)
	for range line(g, emerge.Legend).Heavy {
		heavy(t, g, c, in.ID)
	}
	legend := promotionsOf(g, emerge.Legend)[0]
	class, err := g.promoteTrace(Promoting{Type: emerge.Class, Region: -1, Of: "router", First: c.C.ID})
	if err != nil {
		t.Fatal(err)
	}
	long := strings.Repeat("n", int(g.gp("title-length"))+1)
	refused := func(who *Char, id, name, code string) {
		t.Helper()
		before, _ := g.Digest()
		var r *Refused
		if err := g.promoteName(who, Command{Kind: PromoteName, Option: id, Note: name}); !errors.As(err, &r) || r.Code != code {
			t.Fatalf("renaming %s as %q by %s: %v, want %s", id, name, who.C.ID, r, code)
		}
		if after, _ := g.Digest(); after != before {
			t.Fatalf("a %s refusal changed the game", code)
		}
	}
	refused(c, "legend:999", "Old Tusk", NoSuchRow)
	refused(c, class.ID, "Old Tusk", NoSuchRow)
	refused(other, legend.ID, "Old Tusk", NotFirst)
	refused(c, legend.ID, "  ", BadName)
	refused(c, legend.ID, long, BadName)
	refused(c, legend.ID, "the "+g.r.Book.Words[0].ID+"s", BadName)

	if err := g.promoteName(c, Command{Kind: PromoteName, Option: legend.ID, Note: " Old Tusk "}); err != nil {
		t.Fatal(err)
	}
	p := g.Emergence.Promotion(legend.ID)
	if p.Named != "Old Tusk" || p.Shown() != "Old Tusk" {
		t.Fatalf("the rename left %+v", p)
	}
	f, _ := g.Log.Get(fact.ID(g.Log.Len()))
	if was, _ := f.Get("was"); f.Kind != factPromotionRenamed || was.S != legend.Name || f.Subjects[0] != promotionRef(legend.ID) {
		t.Fatalf("the rename's fact is %+v", f)
	}
	refused(c, legend.ID, "Older Tusk", Named)

	var styles []*emerge.Promotion
	for range 2 {
		p, err := g.promoteTrace(Promoting{Type: emerge.Style, Region: -1, Of: "edge+keen", First: c.C.ID})
		if err != nil {
			t.Fatal(err)
		}
		styles = append(styles, p)
	}
	for g.Tick() < styles[0].Tick+g.r.Emerge.P.RenameDays*sheets.TicksPerDay-1 {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := g.Act(Command{Key: "rename-last", Kind: PromoteName, Char: c.C.ID, Option: styles[0].ID, Note: "Last Light"}); err != nil {
		t.Fatalf("a rename on the last tick of its days: %v", err)
	}
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	refused(c, styles[1].ID, "Last Light", NameClosed)
}

// TestLegendsGoalOnly: an item legend has no creature to hunt, so it is not
// offered and takes no legends-kept slot.
func TestLegendsGoalOnly(t *testing.T) {
	g := mmGame(t)
	goalL := mmLegendState(t, g)
	item := func() *emerge.LegendRec {
		l := mmLegendState(t, g)
		l.Of = fact.Ref{Kind: renownItem, ID: "item-" + l.ID}
		return l
	}
	item()
	v := emergentView{g.storyView()}
	if ls := v.Legends(); len(ls) != 1 || ls[0].ID != goalL.ID {
		t.Fatalf("with an item legend newer than a goal legend, offered %+v", ls)
	}
	for range g.r.Emerge.P.LegendsKept {
		item()
	}
	if ls := v.Legends(); len(ls) != 1 || ls[0].ID != goalL.ID {
		t.Fatalf("item legends filling legends-kept crowd out the goal legend: %+v", ls)
	}
	if _, ok := g.legendTag(goalL.Region, goalL.Of.ID); !ok {
		t.Fatal("the goal legend's archetype carries no tag")
	}
}
