package char_test

import (
	"encoding/json"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
)

func TestPractice(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	c := char.New("c", hex.Hex{})
	// 20 × next level: 20 uses to 1, 40 more to 2.
	if c.Practise("fight", 19, b.GrowthParams); c.Level("fight") != 0 {
		t.Fatal("levelled early")
	}
	if c.Practise("fight", 1, b.GrowthParams); c.Level("fight") != 1 {
		t.Fatal("did not reach 1")
	}
	if n := c.Practise("fight", 40, b.GrowthParams); n != 1 || c.Level("fight") != 2 {
		t.Fatal("did not reach 2")
	}
	c.Practise("fight", 1_000_000, b.GrowthParams)
	if c.Level("fight") != 20 {
		t.Fatalf("practice past 20: %d", c.Level("fight"))
	}
}

func TestRingsAndChecks(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	l := char.LimitsOf(b.GrowthParams)
	c := char.New("c", hex.Hex{})
	for i := range 50 {
		c.Walk(hex.Hex{Q: int64(i)}, l)
		c.Remember(fact.ID(i+1), l)
		c.Meet(char.Met{Who: string(rune('a' + i%20)), How: "met"}, l)
	}
	if len(c.Trail) != 12 || len(c.Journey) != 32 || len(c.Company) != 10 || c.Trail[11].Q != 49 {
		t.Fatalf("rings: %d tiles, %d facts, %d company", len(c.Trail), len(c.Journey), len(c.Company))
	}
	in := &item.Instance{ID: "key-1", Kind: "k-1"}
	c.Pack = append(c.Pack, in)
	if !c.HoldsKind("k-1") || !c.HoldsItem("key-1") || c.HoldsKind("k-2") {
		t.Fatal("held-item checks")
	}
	c.Set("wounded", 10)
	if !c.Has("wounded", 9) || c.Has("wounded", 10) {
		t.Fatal("condition expiry")
	}
	c.AdjustStanding("f", 500, -100, 100)
	if c.Standing.Get("f") != 100 {
		t.Fatal("standing bound")
	}
}

// A character outside a dungeon writes no floor, so a save from before
// floors digests as it did; partied is company like any other.
func TestFloorAndPartied(t *testing.T) {
	c := char.New("c", hex.Hex{})
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"floor"`) {
		t.Fatalf("an outside character writes a floor: %s", raw)
	}
	c.Floor = 3
	raw, _ = json.Marshal(c)
	var back char.Character
	if err := json.Unmarshal(raw, &back); err != nil || back.Floor != 3 {
		t.Fatalf("floor %d back, %v", back.Floor, err)
	}
	c.Meet(char.Met{Who: "d", How: char.MetPartied, Tick: 4}, char.Limits{Company: 10})
	if len(c.Company) != 1 || c.Company[0].How != "partied" {
		t.Fatalf("company %+v", c.Company)
	}
}
