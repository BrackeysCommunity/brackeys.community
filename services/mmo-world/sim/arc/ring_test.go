package arc

import (
	"testing"

	"jams.team/mmo-world/sim/hex"
)

var ringRow = row("the-waking-tower", ScopeWorld, "tower", "tile", "seat", "settlement")

// ringed is a fake with the ring's standing towers.
type ringed struct {
	*fake
	towers []hex.Hex
}

func (r ringed) Towers() []hex.Hex { return r.towers }

// ringWorld: two places, the second busier, and towers beside each.
func ringWorld() ringed {
	w := newFake(4)
	w.place(0, nearSettlement)
	w.place(3, nearSettlement).Users = 3
	return ringed{w, []hex.Hex{{Q: 2}, {Q: 29}, {Q: 36}}}
}

func TestRingWakesNearTheBusiestPlace(t *testing.T) {
	w := ringWorld()
	c := one(t, run(t, w, RingWhen, ringRow))
	bound(t, c, "tower", TileRef(hex.Hex{Q: 29}))
	bound(t, c, "seat", SettlementRef(1))
	if c.Pressure != 3 || c.Seat != w.places[1].Hex {
		t.Fatalf("pressure %d seat %v", c.Pressure, c.Seat)
	}

	// Nobody about: the first place's tower.
	w.places[1].Users = 0
	bound(t, one(t, run(t, w, RingWhen, ringRow)), "tower", TileRef(hex.Hex{Q: 2}))
}

func TestRingNeedsAShutCoreAndAStandingTower(t *testing.T) {
	w := ringWorld()
	w.open = true
	none(t, run(t, w, RingWhen, ringRow))

	w = ringWorld()
	w.towers = nil
	none(t, run(t, w, RingWhen, ringRow))

	w = ringWorld()
	none(t, run(t, plain{w}, RingWhen, ringRow))

	w = ringWorld()
	w.setBusy(ScopeWorld, TileRef(hex.Hex{Q: 29}))
	none(t, run(t, w, RingWhen, ringRow))
}
