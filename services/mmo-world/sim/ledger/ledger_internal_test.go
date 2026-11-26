package ledger

import (
	"encoding/json"
	"slices"
	"strconv"
	"testing"
)

// sorted is the book as one sorted slice, the layout Book replaced.
type sorted []Balance

func (s *sorted) add(account, asset string, units int64) {
	i, ok := slices.BinarySearchFunc(*s, pair{account, asset}, cmpBalance)
	if !ok {
		*s = slices.Insert(*s, i, Balance{Account: account, Asset: asset})
	}
	(*s)[i].Units += units
	if (*s)[i].Units == 0 {
		*s = slices.Delete(*s, i, i+1)
	}
}

func TestBookMatchesOneSortedSlice(t *testing.T) {
	var b Book
	var want sorted
	if b.Balances() != nil || b.Held("a") != nil {
		t.Fatal("a fresh book is not nil")
	}
	x := uint64(1)
	for n := range 20000 {
		x = x*6364136223846793005 + 1442695040888963407
		acc := "pool:" + strconv.Itoa(int(x>>33%40))
		asset := "item:" + strconv.Itoa(int(x>>45%12))
		units := int64(x>>55%5) - 2
		b.add(acc, asset, units)
		want.add(acc, asset, units)
		if n%997 == 0 || n == 19999 {
			got := b.Balances()
			if !slices.Equal(got, want) || (got == nil) != (want == nil) {
				t.Fatalf("after %d: %v, want %v", n, got, want)
			}
			if b.Held("none") == nil {
				t.Fatal("Held is nil once a balance existed")
			}
			for _, w := range want {
				if b.Of(w.Account, w.Asset) != w.Units {
					t.Fatalf("Of(%s, %s)", w.Account, w.Asset)
				}
			}
		}
	}
	for _, w := range slices.Clone(want) {
		b.add(w.Account, w.Asset, -w.Units)
	}
	if got := b.Balances(); got == nil || len(got) != 0 || len(b.order) != 0 {
		t.Fatalf("emptied book: %v, %d accounts", got, len(b.order))
	}
	j, err := json.Marshal(b)
	if err != nil || string(j) != `{"balances":[],"posted":0}` {
		t.Fatalf("emptied book as JSON: %s, %v", j, err)
	}
	var back Book
	if err := json.Unmarshal(j, &back); err != nil || back.Balances() == nil {
		t.Fatalf("emptied book read back: %v, %v", back.Balances(), err)
	}
}
