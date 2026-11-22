package settle

import (
	"testing"

	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

var p = Params{ConditionMax: 100, TroubleDamage: 25, RaidDamage: 10, Neglect: 1, NeglectTicks: 7 * sheets.TicksPerDay,
	RepairShare: 1, ReopenShare: 25, StationTier: 2, FoundDistance: 6, CityStationCap: 3}

var forge = sheets.Structure{ID: "forge", Station: true, MaxTier: 3, Charter: true,
	Each: []sheets.CostLine{{Tag: "stone", Quantity: 300}, {Tag: "timber", Quantity: 200}}}
var wall = sheets.Structure{ID: "wall", MaxTier: 3, First: []sheets.CostLine{{Tag: "timber", Quantity: 400}}, Each: []sheets.CostLine{{Tag: "stone", Quantity: 600}}}

// TestRaiseStopsAtTheStationTier outside a city.
func TestRaiseStopsAtTheStationTier(t *testing.T) {
	s := &Settlement{}
	if !s.Raise(&forge, 0, p) || !s.Raise(&forge, 1, p) || s.Raise(&forge, 2, p) {
		t.Fatal("a forge rose past tier 2")
	}
	if !s.Raise(&wall, 0, p) || !s.Raise(&wall, 1, p) || !s.Raise(&wall, 2, p) || s.Get("wall").Tier != 3 {
		t.Fatal("a wall did not reach its own cap")
	}
}

// TestCapFor: a city's stations reach the city's cap, never past their
// row's; a structure that is not a station keeps its row's cap anywhere.
func TestCapFor(t *testing.T) {
	low := sheets.Structure{ID: "bench", Station: true, MaxTier: 2}
	for _, c := range []struct {
		row  *sheets.Structure
		city bool
		want int64
	}{
		{&forge, false, 2}, {&forge, true, 3}, {&low, true, 2}, {&wall, false, 3}, {&wall, true, 3},
	} {
		if got := CapFor(c.row, p, c.city); got != c.want {
			t.Errorf("%s in a city %v: cap %d, want %d", c.row.ID, c.city, got, c.want)
		}
	}
	if Cap(&forge, p) != CapFor(&forge, p, false) {
		t.Fatal("Cap is not the cap outside a city")
	}
	s := &Settlement{City: &City{}}
	for range 3 {
		if !s.Raise(&forge, 0, p) {
			t.Fatal("a city's forge stopped short of tier 3")
		}
	}
	if s.Raise(&forge, 0, p) || s.Get("forge").Tier != 3 {
		t.Fatal("a city's forge rose past the city's cap")
	}
	if _, _, ok := s.Next(&forge, p); ok {
		t.Fatal("a city offers a raise past its cap")
	}
	if tier, _, ok := (&Settlement{City: &City{}, Structures: []Structure{{Kind: "forge", Tier: 2}}}).Next(&forge, p); !ok || tier != 3 {
		t.Fatal("a city offers no tier 3")
	}
}

// TestNeglectAndRepair: a week unused, a point a day; repair costs a
// share of the worth, a closed one a quarter.
func TestNeglectAndRepair(t *testing.T) {
	s := &Settlement{}
	s.Raise(&wall, 0, p)
	s.Raise(&wall, 0, p)
	if len(s.Neglect(6*sheets.TicksPerDay, p)) != 0 || s.Get("wall").Condition != 100 {
		t.Fatal("neglect before a week")
	}
	s.Neglect(7*sheets.TicksPerDay, p)
	if s.Get("wall").Condition != 99 {
		t.Fatal("no neglect after a week")
	}
	cost := Repair(&wall, *s.Get("wall"), 1, p)
	if len(cost) != 2 || cost[0].Quantity != 4 || cost[1].Quantity != 6 {
		t.Fatalf("repair cost %+v", cost)
	}
	for !s.Damage("wall", p.TroubleDamage) {
	}
	if !s.Get("wall").Closed() || s.Open("wall") {
		t.Fatal("a wall at 0 is open")
	}
	if cost := Repair(&wall, *s.Get("wall"), 1, p); cost[0].Quantity != 100 {
		t.Fatalf("reopening cost %+v", cost)
	}
}

// TestFarEnough holds the founding distance.
func TestFarEnough(t *testing.T) {
	others := []hex.Hex{{Q: 0, R: 0}}
	if FarEnough(hex.Hex{Q: 5}, others, p) || !FarEnough(hex.Hex{Q: 6}, others, p) {
		t.Fatal("distance rule misread")
	}
}
