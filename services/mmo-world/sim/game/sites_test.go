package game

import (
	"encoding/json"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// otherSite is a second overland site, not h.
func otherSite(t *testing.T, g *Game, h hex.Hex) hex.Hex {
	t.Helper()
	for r := int64(1); r < delveSearch; r++ {
		for _, x := range hex.Ring(g.SettlementHex(0), r) {
			if x == h || g.r.Gen.Baseline(x).Site == "" || g.World.RegionAt(x) < 0 {
				continue
			}
			reachAt(t, g, x)
			if g.slot(x) != "" && !g.IsDungeon(x) && !g.IsSettlement(x) && len(g.Creatures(x)) > 0 {
				return x
			}
		}
	}
	t.Fatal("no second overland site")
	return hex.Hex{}
}

func TestCampStation(t *testing.T) {
	g := feedGame(t)
	h := siteTile(t, g)
	c := feedChars(t, g, 1, h)[0]
	if len(g.Stations(h)) != 0 {
		t.Fatalf("a bare site holds stations: %v", g.Stations(h))
	}
	won := &fight.Encounter{Result: fight.Won}
	for range line(g, emerge.Camp).Count {
		mustFeed(t, g.noteClearing(c, won, g.Tick()))
	}
	camp, ok := g.campAt(h)
	if !ok || camp.ID != g.Emergence.Clearing[h].Done {
		t.Fatalf("the camp line made no camp: %+v", camp)
	}
	want := campFallback
	if row, ok := sheets.Lookup(g.r.Book.Camps)[g.SiteKind(h)]; ok {
		want = row.Station
	}
	if got := g.Stations(h); !slices.Equal(got, []Station{{Kind: want, Tier: g.r.firstTier()}}) {
		t.Fatalf("the camp's stations: %v, want a tier-%d %s", got, g.r.firstTier(), want)
	}

	// A site kind with no row gets the bench, and its fee is the market's
	// sink: a camp has no treasury.
	at := otherSite(t, g, h)
	if _, err := g.promoteTrace(Promoting{Type: emerge.Camp, Region: -1, At: &at}); err != nil {
		t.Fatal(err)
	}
	bench := Station{Kind: campFallback, Tier: g.r.firstTier()}
	if got := g.Stations(at); !slices.Equal(got, []Station{bench}) {
		t.Fatalf("a camp with no site kind: %v", got)
	}
	c.C.At = at
	mat := g.r.Book.Materials[0].ID
	fee := g.feeFor(c, bench, "")
	dirGive(t, g, c, ledger.Material(mat), 2)
	dirGive(t, g, c, ledger.Coin, fee)
	fees := g.Ledger.Of(ledger.ToFees, ledger.Coin)
	rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: mat, Qty: 2}}}
	if _, err := g.Act(Command{Key: "camp-craft", Char: c.C.ID, Kind: Craft, Recipe: &rec}); err != nil {
		t.Fatal(err)
	}
	if fee <= 0 || g.Ledger.Of(ledger.ToFees, ledger.Coin)-fees != fee {
		t.Fatalf("the camp's fee: %d into the fees, want %d", g.Ledger.Of(ledger.ToFees, ledger.Coin)-fees, fee)
	}
	audit(t, g)

	// A settlement on the tile supersedes the camp.
	g.Places = append(g.Places, &Place{N: len(g.Places), Hex: at, Lattice: -1})
	if got := g.Stations(at); len(got) != 0 {
		t.Fatalf("a settlement's tile kept the camp's station: %v", got)
	}
	g.Places = g.Places[:len(g.Places)-1]

	// Off, nothing is a camp.
	g.Emergence = nil
	if len(g.Stations(h)) != 0 {
		t.Fatal("a camp without emergence")
	}
}

func TestHauntLeadsScavenger(t *testing.T) {
	g := feedGame(t)
	h := siteTile(t, g)
	frozen := func() string {
		t.Helper()
		ct, _ := g.Content(h)
		b, err := json.Marshal(ct)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	before, kinds := frozen(), g.Creatures(h)
	c := feedChars(t, g, 1, h)[0]
	down := &fight.Encounter{Result: fight.Lost}
	for range line(g, emerge.Haunt).Count {
		mustFeed(t, g.noteLoss(c, down, g.Tick()))
	}
	x, ok := g.hauntAt(h)
	if !ok || x.ID != g.Emergence.Loss[h].Done {
		t.Fatalf("the haunt line made no haunt: %+v", x)
	}
	tag := line(g, emerge.Haunt).Tag
	row, ok := sheets.Lookup(g.r.Book.Creatures)[x.Lead]
	if !ok || !slices.Contains(row.Tags, tag) {
		t.Fatalf("the haunt is led by %q, which carries no %s", x.Lead, tag)
	}
	// A scavenger already living there is picked over a stranger.
	native := slices.ContainsFunc(kinds, func(a string) bool { return slices.Contains(sheets.Lookup(g.r.Book.Creatures)[a].Tags, tag) })
	if native && !slices.Contains(kinds, x.Lead) {
		t.Fatalf("a scavenger lives among %v, but %s leads", kinds, x.Lead)
	}
	got := g.Creatures(h)
	rest := slices.DeleteFunc(slices.Clone(kinds), func(a string) bool { return a == x.Lead })
	if got[0] != x.Lead || !slices.Equal(got[1:], rest) {
		t.Fatalf("creatures %v, want %s leading %v", got, x.Lead, rest)
	}
	if frozen() != before {
		t.Fatal("the haunt edited the site's frozen content")
	}
	// What lives there now meets you in a haunted place.
	if err := g.begin(c, false, 0); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(c.Fight.E.Site, tagHaunted) {
		t.Fatalf("an encounter on a haunted site: place %v", c.Fight.E.Site)
	}
	// The draw is keyed by the tile, so the same site is led alike.
	if lead := g.scavenger(h); lead != x.Lead {
		t.Fatalf("the haunt's lead drew %s, then %s", x.Lead, lead)
	}
}
