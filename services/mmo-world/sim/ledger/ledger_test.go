package ledger_test

import (
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/ledger"
)

var (
	ann = ledger.Char("ann")
	bob = ledger.Char("bob")
	ore = ledger.Material("ore")
)

// funded is a book where ann holds 5 coin and 3 ore.
func funded(t *testing.T) *ledger.Book {
	t.Helper()
	b := &ledger.Book{}
	for _, tx := range []ledger.Txn{
		ledger.Move("fund-coin", "correction", 0, ledger.FromOperator, ann, ledger.Coin, 5),
		ledger.Move("fund-ore", "gather", 0, ledger.FromGather, ann, ore, 3),
	} {
		if err := b.Post(tx); err != nil {
			t.Fatal(err)
		}
	}
	return b
}

func TestCheckRefuses(t *testing.T) {
	for _, c := range []struct {
		name string
		tx   ledger.Txn
		want string
	}{
		{"no key", ledger.Move("", "x", 0, ann, bob, ledger.Coin, 1), "no key"},
		{"no legs", ledger.Txn{Key: "k", Kind: "x"}, "no legs"},
		{"zero leg", ledger.Txn{Key: "k", Legs: []ledger.Leg{{ann, ledger.Coin, 0}}}, "zero"},
		{"unbalanced", ledger.Txn{Key: "k", Legs: []ledger.Leg{{ann, ledger.Coin, -2}, {bob, ledger.Coin, 1}}}, "does not balance"},
		{"overdrawn holder", ledger.Move("k", "x", 0, ann, bob, ledger.Coin, 6), "would hold"},
		{"overdrawn twice", ledger.Txn{Key: "k", Legs: []ledger.Leg{{ann, ore, -2}, {ann, ore, -2}, {bob, ore, 4}}}, "would hold"},
		{"source takes", ledger.Move("k", "x", 0, ann, ledger.FromGather, ore, 1), "cannot take"},
		{"sink gives", ledger.Move("k", "x", 0, ledger.ToLost, ann, ore, 1), "cannot give"},
		{"unknown account", ledger.Move("k", "x", 0, ann, "bank:x", ore, 1), "unknown account"},
		{"coin from the wrong source", ledger.Move("k", "x", 0, ledger.FromHaul, ann, ledger.Coin, 1), "coin enters only"},
	} {
		t.Run(c.name, func(t *testing.T) {
			b := funded(t)
			before := slices.Clone(b.Balances())
			err := b.Post(c.tx)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("got %v, want an error containing %q", err, c.want)
			}
			if !slices.Equal(b.Balances(), before) || b.Posted != 2 {
				t.Fatal("a refused transaction changed the book")
			}
		})
	}
}

func TestPostMultiLeg(t *testing.T) {
	b := funded(t)
	tx := ledger.Txn{Key: "split", Kind: "x", Legs: []ledger.Leg{
		{ann, ore, -1}, {ann, ore, -2}, {bob, ore, 2}, {ledger.ToLost, ore, 1},
		{ann, ledger.Coin, -5}, {bob, ledger.Coin, 5},
	}}
	if err := b.Post(tx); err != nil {
		t.Fatal(err)
	}
	if b.Of(ann, ore) != 0 || b.Of(bob, ore) != 2 || b.Of(ledger.ToLost, ore) != 1 || b.Of(bob, ledger.Coin) != 5 {
		t.Fatalf("balances after a split: %+v", b.Balances())
	}
	if held := b.Held(ann); len(held) != 0 {
		t.Fatalf("ann emptied still holds %+v", held)
	}
	if got := b.Flush(); len(got) != 3 || got[2].Key != "split" || b.Flush() != nil {
		t.Fatalf("flush handed over %+v", got)
	}
}

func TestOfAndHeld(t *testing.T) {
	b := funded(t)
	if b.Of(bob, ledger.Coin) != 0 || b.Of(ann, ledger.Provisions) != 0 || b.Of("char:nobody", ore) != 0 {
		t.Fatal("a missing pair has a balance")
	}
	held := b.Held(ann)
	if len(held) != 2 || held[0].Asset != ledger.Coin || held[1].Asset != ore {
		t.Fatalf("ann holds %+v", held)
	}
	held[0].Units = 99
	if b.Of(ann, ledger.Coin) != 5 {
		t.Fatal("Held hands out the book's own balances")
	}
	if len(b.Held(bob)) != 0 || len(b.Held("char:a")) != 0 {
		t.Fatal("an account with nothing holds something")
	}
}

func TestRebuild(t *testing.T) {
	b := funded(t)
	r := ledger.Rebuild(slices.Clone(b.Balances()), b.Posted)
	if !slices.Equal(r.Balances(), b.Balances()) || r.Posted != b.Posted {
		t.Fatalf("rebuilt %+v, want %+v", r, *b)
	}
}

func TestAudit(t *testing.T) {
	b := funded(t)
	held := []ledger.Balance{{ann, ledger.Coin, 5}, {ann, ore, 3}}
	if bad := ledger.Audit(b.Balances(), held); len(bad) != 0 {
		t.Fatal(bad)
	}
	for _, c := range []struct {
		name   string
		ledger []ledger.Balance
		held   []ledger.Balance
		want   string
	}{
		{"asset does not sum", append(slices.Clone(b.Balances()), ledger.Balance{bob, ore, 1}), held, "sums to"},
		{"state holds less", b.Balances(), held[:1], "state 0"},
		{"state holds other", b.Balances(), []ledger.Balance{{ann, ledger.Coin, 4}, {ann, ore, 3}}, "ledger 5 coin, state 4"},
		{"state holds what the ledger does not", b.Balances(), append(slices.Clone(held), ledger.Balance{bob, ore, 2}), "ledger 0"},
	} {
		t.Run(c.name, func(t *testing.T) {
			bad := ledger.Audit(c.ledger, c.held)
			if !slices.ContainsFunc(bad, func(s string) bool { return strings.Contains(s, c.want) }) {
				t.Fatalf("audit found %q, want one containing %q", bad, c.want)
			}
		})
	}
}

func TestSubKey(t *testing.T) {
	if got := ledger.SubKey("i-1", "haul", "0"); got != "i-1/haul/0" {
		t.Fatal(got)
	}
}
