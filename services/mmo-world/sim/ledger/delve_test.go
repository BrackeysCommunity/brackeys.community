package ledger_test

import (
	"testing"

	"jams.team/mmo-world/sim/ledger"
)

// A hunt's spoils are minted once into its pool and split out of it to
// the last unit; a floor pool holds what fell and gives only what it
// holds.
func TestHuntAndFloorPools(t *testing.T) {
	b := &ledger.Book{}
	pool := ledger.HuntPool("hn-1")
	if err := b.Post(ledger.Move("hn-1/roll", "hunt.slain", 1, ledger.FromHunt, pool, ore, 7)); err != nil {
		t.Fatal(err)
	}
	split := ledger.Txn{Key: "hn-1/split", Kind: "hunt.split", Tick: 1,
		Legs: append(ledger.Pair(pool, ann, ore, 4), ledger.Pair(pool, bob, ore, 3)...)}
	if err := b.Post(split); err != nil {
		t.Fatal(err)
	}
	if b.Of(pool, ore) != 0 || b.Of(ann, ore) != 4 || b.Of(bob, ore) != 3 {
		t.Fatalf("balances %+v", b.Balances())
	}
	if err := b.Check(ledger.Move("coin", "hunt.slain", 1, ledger.FromHunt, pool, ledger.Coin, 1)); err == nil {
		t.Fatal("a hunt minted coin")
	}
	floor := ledger.FloorPool("3,-2", 4)
	if floor != "pool:floor:3,-2/4" {
		t.Fatalf("floor pool %s", floor)
	}
	if ref, n, ok := ledger.FloorOf(floor); !ok || ref != "3,-2" || n != 4 {
		t.Fatalf("read back %q %d %v", ref, n, ok)
	}
	if _, _, ok := ledger.FloorOf(ledger.TilePool("3,-2")); ok {
		t.Fatal("a tile pool read as a floor")
	}
	if err := b.Post(ledger.Move("fell", "dropped", 2, ann, floor, ore, 4)); err != nil {
		t.Fatal(err)
	}
	if err := b.Check(ledger.Move("find", "found", 3, floor, bob, ore, 5)); err == nil {
		t.Fatal("a floor gave more than fell there")
	}
}
