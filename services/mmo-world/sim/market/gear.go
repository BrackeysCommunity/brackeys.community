package market

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/item"
)

// Listing is one item offered at a fixed price (GDD 10.3): gear is listed,
// not booked, since every instance differs. The item sits in escrow.
type Listing struct {
	ID         string         `json:"id"`
	Settlement int            `json:"settlement"`
	Seller     string         `json:"seller"` // the account paid
	Item       *item.Instance `json:"item"`
	Price      int64          `json:"price"`
	Placed     int64          `json:"placed"`
	Expires    int64          `json:"expires"`
	Seq        int64          `json:"seq"`
	// Staged marks a staged item's listing: only at its origin, only to
	// players, and with no fee (GDD 10.8).
	Staged bool `json:"staged,omitempty"`
}

// Floor is what a buy order for gear requires of an item.
type Floor struct {
	Durability int64  `json:"durability,omitempty"`
	Trait      string `json:"trait,omitempty"`
	Level      int64  `json:"level,omitempty"`
}

// Want is a buy order for gear at a price, with a floor: one kind, or any
// kind of a slot. Its coin sits in escrow.
type Want struct {
	ID         string `json:"id"`
	Settlement int    `json:"settlement"`
	Buyer      string `json:"buyer"`
	Kind       string `json:"kind,omitempty"`
	Slot       string `json:"slot,omitempty"`
	Price      int64  `json:"price"`
	Floor      Floor  `json:"floor"`
	Placed     int64  `json:"placed"`
	Expires    int64  `json:"expires"`
	Seq        int64  `json:"seq"`
}

// Meets reports whether an item of a kind clears a floor.
func (f Floor) Meets(in *item.Instance, k *item.Kind) bool {
	return in.Durability >= f.Durability && in.Level >= f.Level && (f.Trait == "" || slices.Contains(k.Traits, f.Trait))
}

// Kinds finds an item's kind.
type Kinds func(id string) (*item.Kind, bool)

// Takes reports whether a want would buy a listing: same settlement, its
// kind or slot, a different owner, the floor cleared, and the price met.
func (w Want) Takes(l Listing, kinds Kinds) bool {
	if w.Settlement != l.Settlement || w.Buyer == l.Seller || w.Price < l.Price {
		return false
	}
	k, ok := kinds(l.Item.Kind)
	if !ok || (w.Kind != "" && w.Kind != k.ID) || (w.Slot != "" && w.Slot != k.Slot) {
		return false
	}
	return w.Floor.Meets(l.Item, k)
}

// Pair is the want that takes a listing, best price then time, among
// those ok lets through, or -1.
func Pair(wants []Want, l Listing, kinds Kinds, ok func(Want) bool) int {
	return bestBy(wants, func(w Want) bool { return w.Takes(l, kinds) && ok(w) }, func(a, b Want) int {
		return cmp.Or(cmp.Compare(b.Price, a.Price), cmp.Compare(a.Seq, b.Seq))
	})
}

// Cheapest is the cheapest listing a want takes, then the oldest, among
// those ok lets through, or -1.
func Cheapest(listings []Listing, w Want, kinds Kinds, ok func(Listing) bool) int {
	return bestBy(listings, func(l Listing) bool { return w.Takes(l, kinds) && ok(l) }, func(a, b Listing) int {
		return cmp.Or(cmp.Compare(a.Price, b.Price), cmp.Compare(a.Seq, b.Seq))
	})
}

// bestBy is the index of the first of xs that ok lets through and no other
// beats by order, or -1.
func bestBy[T any](xs []T, ok func(T) bool, order func(a, b T) int) int {
	best := -1
	for i, x := range xs {
		if ok(x) && (best < 0 || order(x, xs[best]) < 0) {
			best = i
		}
	}
	return best
}
