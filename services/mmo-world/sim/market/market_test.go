package market

import "testing"

func order(id string, s Side, price, qty, seq int64) Order {
	return Order{ID: id, Owner: id, Side: s, Price: price, Qty: qty, Seq: seq, Expires: 100}
}

func TestMatchPriceThenTime(t *testing.T) {
	b := &Book{}
	b.Add(order("b1", Bid, 10, 5, 1))
	b.Add(order("b2", Bid, 12, 3, 2))
	b.Add(order("b3", Bid, 12, 4, 3))
	b.Add(order("a1", Ask, 11, 9, 4))
	fills := Match(b, 7, nil)
	if len(fills) != 2 {
		t.Fatalf("fills %+v", fills)
	}
	// b2 (best, earlier) then b3; both rested first, so their price holds.
	if fills[0].Bid.ID != "b2" || fills[0].Qty != 3 || fills[0].Price != 12 {
		t.Fatalf("first fill %+v", fills[0])
	}
	if fills[1].Bid.ID != "b3" || fills[1].Qty != 4 {
		t.Fatalf("second fill %+v", fills[1])
	}
	// b1 at 10 is below the ask: the rest of a1 rests.
	if len(b.Bids) != 1 || len(b.Asks) != 1 || b.Asks[0].Qty != 2 {
		t.Fatalf("book %+v", b)
	}
}

func TestMatchPartialAndRest(t *testing.T) {
	b := &Book{}
	b.Add(order("a1", Ask, 8, 2, 1))
	b.Add(order("a2", Ask, 9, 5, 2))
	b.Add(order("b1", Bid, 9, 4, 3))
	fills := Match(b, 1, nil)
	if len(fills) != 2 || fills[0].Price != 8 || fills[0].Qty != 2 || fills[1].Price != 9 || fills[1].Qty != 2 {
		t.Fatalf("fills %+v", fills)
	}
	if len(b.Bids) != 0 || len(b.Asks) != 1 || b.Asks[0].Qty != 3 {
		t.Fatalf("book %+v", b)
	}
}

func TestMatchSkip(t *testing.T) {
	b := &Book{}
	b.Add(order("x", Bid, 9, 4, 1))
	b.Add(Order{ID: "y", Owner: "x", Side: Ask, Price: 5, Qty: 1, Seq: 2})
	if fills := Match(b, 1, func(bid, ask Order) bool { return bid.Owner == ask.Owner }); len(fills) != 0 {
		t.Fatalf("an owner matched itself: %+v", fills)
	}
}

func TestExpireAndHistory(t *testing.T) {
	b := &Book{}
	b.Add(order("a", Ask, 8, 2, 1))
	b.Add(Order{ID: "z", Side: Bid, Price: 8, Qty: 1, Seq: 2, Expires: 5})
	for _, f := range Match(b, 3, nil) {
		b.Record(f)
	}
	b.CloseDay(0, 10, 2, 0)
	if p, at := b.PriceAt(4); p != 8 || at != 3 {
		t.Fatalf("price at 4: %d at %d", p, at)
	}
	if out := b.Expire(200); len(out) != 1 || out[0].ID != "a" {
		t.Fatalf("expired %+v", out)
	}
}
