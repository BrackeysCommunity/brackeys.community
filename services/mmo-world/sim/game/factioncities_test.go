package game

import (
	"testing"

	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
)

// readyHolding makes faction fi's seat a holding that may become its city:
// defended, prosperous long enough and a faction stocked to build it. It
// returns the region.
func readyHolding(t *testing.T, g *Game, fi int) int {
	t.Helper()
	f := &g.World.Factions[fi]
	r := f.Seat
	if g.World.Regions[r].Holder != fi {
		t.Fatalf("faction %d does not hold its seat", fi)
	}
	g.World.Regions[r].Defence = g.fcp("faction-city-defence")
	f.Stock = g.fcp("faction-city-stock")
	setProsper(g, r, g.sp("city-prosperity-days"))
	return r
}

// TestFactionCityOncePerFaction: a holding held long enough, defended,
// prosperous and stocked opens its faction's one city on the region's
// highest free tile, with a market and the archetype's station at the
// city's tier, which a day later opens no second; the guild's exchange
// halves the fee there; the city survives syncPlaces; and when the holding
// falls the city closes as a ruin.
func TestFactionCityOncePerFaction(t *testing.T) {
	g := storyGame(t)
	fi := 0
	g.World.Factions[fi].Archetype = "guild"
	r := readyHolding(t, g, fi)
	days := g.fcp("faction-city-days")
	if err := g.factionCitiesDay(days - 1); err != nil || len(g.Story.Cities) != 0 {
		t.Fatalf("a holding too young opened a city: %v", err)
	}
	places := len(g.Places)
	if err := g.factionCitiesDay(days); err != nil {
		t.Fatal(err)
	}
	if len(g.Story.Cities) != 1 || len(g.Places) != places+1 || len(factsOf(g, "faction.city")) != 1 {
		t.Fatalf("%d faction cities, %d places", len(g.Story.Cities), len(g.Places))
	}
	fc := g.Story.Cities[0]
	p := g.Places[fc.Place]
	if fc.Faction != fi || fc.Region != r || p.Faction == nil || *p.Faction != fi || p.Lattice >= 0 || p.Guild != "" {
		t.Fatalf("the faction city is %+v at %+v", fc, p)
	}
	if g.World.RegionAt(p.Hex) != r {
		t.Fatal("the city stands outside its holding")
	}
	for _, h := range g.r.Gen.RegionTiles(g.World.Regions[r].Lattice) {
		if h != p.Hex && g.claimable(h, -1) && g.r.Gen.Baseline(h).Elevation > g.r.Gen.Baseline(p.Hex).Elevation {
			t.Fatalf("%s stands higher and free", h.Ref())
		}
	}
	row := g.factionCityRow("guild")
	if st := p.Get(row.Station); st == nil || st.Tier != g.r.Settle.CityStationCap || !p.Open(structureMarket) {
		t.Fatalf("the city's structures are %+v", p.Structures)
	}
	if g.StationName(fc.Place, row.Station) != row.Name || !g.isCity(fc.Place) {
		t.Fatal("the exchange is not named, or the city reads as none")
	}
	if err := g.factionCitiesDay(days + 1); err != nil || len(g.Story.Cities) != 1 {
		t.Fatalf("a faction opened a second city: %v", err)
	}
	if g.cityFeeCut(fc.Place) != row.Amount || g.cityFeeCut(0) != fixed.Hundredths {
		t.Fatalf("the exchange's fee is %d percent", g.cityFeeCut(fc.Place))
	}
	fee := g.r.Values.Fee(1000)
	if got := g.marketFee(fc.Place, 1000); got != fixed.PercentFloor(fee, row.Amount) || g.marketFee(0, 1000) != fee {
		t.Fatalf("a sale of 1000 pays %d at the exchange and %d elsewhere; the fee is %d", got, g.marketFee(0, 1000), fee)
	}
	g.syncPlaces()
	if len(g.Places) != places+1 || g.Places[fc.Place] != p {
		t.Fatal("syncPlaces dropped or moved the faction city")
	}
	g.World.Regions[r].Holder = -1
	if err := g.factionCitiesDay(days + 2); err != nil {
		t.Fatal(err)
	}
	if p.Ruined == 0 || g.isCity(fc.Place) || g.factionCity(fi) >= 0 || len(factsOf(g, "settlement.ruined")) != 1 {
		t.Fatal("the city stood after its holding fell")
	}
	if g.cityFeeCut(fc.Place) != fixed.Hundredths {
		t.Fatal("a ruined exchange still cuts the fee")
	}
	audit(t, g)
}

// TestFactionCityVendorsAndStations: a faction city's vendors trade only
// with those of standing with it; the compact's war-yard sells mounts for
// less, the clans' scrap yard gives more of a failed craft back, and the
// wardens' armoury waits for faction crafts.
func TestFactionCityVendorsAndStations(t *testing.T) {
	g := storyGame(t)
	fi := 0
	r := readyHolding(t, g, fi)
	open := func(archetype string) *Place {
		t.Helper()
		g.World.Factions[fi].Archetype = archetype
		h, ok := g.factionCityTile(r)
		if !ok {
			t.Fatal("no free tile in the holding")
		}
		if err := g.openFactionCity(fi, r, h, g.factionCityRow(archetype), g.Tick()); err != nil {
			t.Fatal(err)
		}
		return g.Places[len(g.Places)-1]
	}
	yard := open("compact")
	c := mustCreate(t, g, "vendor-test", "knife")
	c.C.At = yard.Hex
	dirGive(t, g, c, ledger.Coin, 500)
	var mount Offer
	row := g.factionCityRow("compact")
	for _, o := range g.Offers(yard.Hex) {
		if m := g.r.Mounts.Kind(o.Asset); m != nil {
			if o.Price != fixed.PercentFloor(g.mountPrice(m.Tier), fixed.Hundredths-row.Amount) {
				t.Fatalf("the war-yard asks %d for a mount", o.Price)
			}
			mount = o
		}
	}
	if mount.Asset == "" {
		t.Fatal("the war-yard sells no mount")
	}
	buy := Command{Key: "vendor-buy", Char: c.C.ID, Kind: Buy, Asset: mount.Asset}
	before := digestOf(t, g)
	if _, err := g.Act(buy); !refusedAs(err, NotHere) || digestOf(t, g) != before {
		t.Fatalf("a stranger bought a mount at the war-yard: %v", err)
	}
	c.C.Standing.Bump(standingKey(fi, yard.Hex), g.fcp("faction-city-standing"))
	if _, err := g.Act(buy); err != nil {
		t.Fatal(err)
	}
	if c.C.Coin != 500-mount.Price {
		t.Fatalf("the mount cost %d, not %d", 500-c.C.Coin, mount.Price)
	}
	scrap := open("clans")
	if g.salvageShare(scrap.N) != g.factionCityRow("clans").Amount || g.salvageShare(yard.N) != 0 {
		t.Fatal("the scrap yard's share")
	}
	m := g.r.Book.Materials[0].ID
	recipe := item.Recipe{Inputs: []item.Input{{Kind: m, Qty: 10}}}
	res := craft.Result{Failed: true}
	c.C.At = scrap.Hex
	g.scrapYard(c, recipe, Station{Kind: g.cityStation(scrap.N), Tier: 3}, &res)
	if want := g.r.Fight.D.Salvage(recipe.Inputs, g.salvageShare(scrap.N)); len(res.Salvage) == 0 || item.Total(res.Salvage) != item.Total(want) {
		t.Fatalf("a failed craft at the scrap yard gave back %v, not %v", res.Salvage, want)
	}
	armoury := open("wardens")
	if st := armoury.Get(g.cityStation(armoury.N)); st == nil || st.Tier != settle.CapFor(g.r.structures[st.Kind], g.r.Settle, true) {
		t.Fatal("the armoury does not stand at the city's tier")
	}
	if g.cityRow(armoury.N, "plate-tier") != nil {
		t.Fatal("the armoury's plate runs before faction crafts")
	}
	audit(t, g)
}
