package market

import (
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

// Pair is the want that takes a listing, best price then time, or -1.
func Pair(wants []Want, l Listing, kinds Kinds) int {
	best := -1
	for i, w := range wants {
		if !w.Takes(l, kinds) {
			continue
		}
		if best < 0 || w.Price > wants[best].Price || (w.Price == wants[best].Price && w.Seq < wants[best].Seq) {
			best = i
		}
	}
	return best
}

// Cheapest is the cheapest listing a want takes, then the oldest, or -1.
func Cheapest(listings []Listing, w Want, kinds Kinds) int {
	best := -1
	for i, l := range listings {
		if !w.Takes(l, kinds) {
			continue
		}
		if best < 0 || l.Price < listings[best].Price || (l.Price == listings[best].Price && l.Seq < listings[best].Seq) {
			best = i
		}
	}
	return best
}
