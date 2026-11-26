package agent

import (
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

func mixBook() *sheets.Book {
	return &sheets.Book{TheftParams: []sheets.Param{{ID: "hot-days", Value: fixed.FromInt(3)}}}
}

func TestMixWeights(t *testing.T) {
	var m Mix
	if !m.Zero() || m.String() != "none" {
		t.Fatalf("the zero mix: zero %v, %q", m.Zero(), m.String())
	}
	m[1], m[3] = 2, 3
	if m.Zero() || m.Sum() != 5 || m.Weight(GuildWorks) != 3 || m.Weight("nothing") != 0 {
		t.Fatalf("mix %v: sum %d, guild works %d", m, m.Sum(), m.Weight(GuildWorks))
	}
	for roll, want := range []int{1, 1, 3, 3, 3} {
		if got := m.pick(int64(roll)); got != want {
			t.Errorf("roll %d fell on %s, want %s", roll, Activities[got], Activities[want])
		}
	}
	if m.String() != "buy-craft-sell 2, guild-works 3" {
		t.Errorf("mix reads %q", m.String())
	}
}

// TestMixedDrawsADay: the activity is drawn once a world day, and a new
// day's draw waits until the player stands free in a market.
func TestMixedDrawsADay(t *testing.T) {
	var m Mix
	for i := range m {
		m[i] = 1
	}
	x := NewMixed(mixBook(), &Earner{Role: Gatherer}, m)
	d := &Dice{d: drawerFor("mix-test"), player: "p"}
	o := api.Options{CharacterID: "c-1", Purse: api.Purse{Market: true}}
	s, first := x.current(o, d)
	if s.day != 1 {
		t.Fatalf("drawn for day %d, want 1", s.day)
	}
	for tick := range int64(sheets.TicksPerDay) {
		o.Tick, d.tick = tick, tick
		if _, act := x.current(o, d); act != first {
			t.Fatalf("tick %d switched to %s from %s within the day", tick, act, first)
		}
	}
	o.Tick, o.Purse.Market = sheets.TicksPerDay, false
	if s, _ := x.current(o, d); s.day != 1 {
		t.Fatal("a new day's draw was made away from a market")
	}
	o.Purse.Market = true
	if s, _ := x.current(o, d); s.day != 2 {
		t.Fatal("no new draw in a market on a new day")
	}
}

// TestMixedArbitrage: it buys under another market's last-seen bid,
// carries the haul there and sells it.
func TestMixedArbitrage(t *testing.T) {
	var m Mix
	m[2] = 1
	x := NewMixed(mixBook(), &Earner{Role: Hauler}, m)
	d := &Dice{d: drawerFor("mix-test"), player: "p"}
	here, there := api.Hex{Q: 0, R: 0}, api.Hex{Q: 6, R: 0}
	s := x.stateOf("c-1")
	s.prices[there] = []api.Quote{{Material: "timber", Bid: 20, Ask: 30, Value: 12}}
	o := api.Options{CharacterID: "c-1", At: here, Moves: []api.Move{{Dir: 0, To: api.Hex{Q: 1, R: 0}, Open: true}},
		Purse: api.Purse{Market: true, Coin: 50, Markets: []api.Hex{here, there}, Load: api.Load{Capacity: 100},
			Quotes: []api.Quote{{Material: "timber", Bid: 5, Ask: 10, Value: 12}}}}
	req, ok := x.Choose(o, d)
	if !ok || req.Kind != api.ActTake || req.Material != "timber" || req.Price != 10 || req.Units != 5 {
		t.Fatalf("in the cheap market it chose %+v", req)
	}
	o.Purse.Coin, o.Purse.Goods = 0, []api.Goods{{Material: "timber", Units: 5}}
	if req, ok = x.Choose(o, d); !ok || req.Kind != api.ActTravel || *req.To != there {
		t.Fatalf("holding the haul it chose %+v", req)
	}
	if req, ok = x.Choose(o, d); !ok || req.Kind != api.ActStep {
		t.Fatalf("the route refused, it chose %+v rather than walking", req)
	}
	o.At, o.Purse.Quotes = there, []api.Quote{{Material: "timber", Bid: 20, Ask: 30, Value: 12}}
	if req, ok = x.Choose(o, d); !ok || req.Kind != api.ActSell || req.Units != 5 {
		t.Fatalf("at the dear market it chose %+v", req)
	}
	if x.Played("c-1")[2] != 4 {
		t.Fatalf("turns played %v", x.Played("c-1"))
	}
}

func TestHouseKeeperSavesOnce(t *testing.T) {
	h := &HouseKeeper{Settings: api.HouseSettings{StaffRoles: []string{"r"}}}
	o := api.Options{CharacterID: "c-1"}
	req, ok := h.Choose(o, nil)
	if !ok || req.Kind != api.ActHouseSettings || req.Settings == nil || req.Settings.StaffRoles[0] != "r" {
		t.Fatalf("first turn %+v", req)
	}
	if _, ok := h.Choose(o, nil); ok {
		t.Fatal("it saved its settings twice")
	}
}
