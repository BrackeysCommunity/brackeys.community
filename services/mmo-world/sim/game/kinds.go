package game

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/item"
)

// Kinds is every kind made in the world, frozen at its first craft, with
// how often each has been made and its plain name. It is the deriver's
// registry while the game is attached, so it is saved and replayed with
// the game (GDD 9.9).
type Kinds struct {
	List []*item.Kind `json:"list"` // sorted by id
	Made []KindCount  `json:"made"` // sorted by id
}

// KindCount is how many times a kind has been made, and what it is called.
type KindCount struct {
	ID    string `json:"id"`
	N     int64  `json:"n"`
	Name  string `json:"name,omitempty"`
	Named string `json:"named,omitempty"` // the character who named it
	// Given: the first maker gave it a name of their own over the plain one.
	Given bool `json:"given,omitempty"`
}

func (k *Kinds) kindAt(id string) (int, bool) {
	return slices.BinarySearchFunc(k.List, id, func(x *item.Kind, id string) int { return cmp.Compare(x.ID, id) })
}

func (k *Kinds) madeAt(id string) (int, bool) {
	return slices.BinarySearchFunc(k.Made, id, func(c KindCount, id string) int { return cmp.Compare(c.ID, id) })
}

func (k *Kinds) Kind(id string) (*item.Kind, bool) {
	i, ok := k.kindAt(id)
	if !ok {
		return nil, false
	}
	return k.List[i], true
}

func (k *Kinds) Freeze(x *item.Kind) *item.Kind {
	i, ok := k.kindAt(x.ID)
	if ok {
		return k.List[i]
	}
	k.List = slices.Insert(k.List, i, x)
	return x
}

func (k *Kinds) count(id string) *KindCount {
	i, ok := k.madeAt(id)
	if !ok {
		k.Made = slices.Insert(k.Made, i, KindCount{ID: id})
	}
	return &k.Made[i]
}

func (k *Kinds) Crafts(id string) int64 {
	i, ok := k.madeAt(id)
	if !ok {
		return 0
	}
	return k.Made[i].N
}

func (k *Kinds) AddCraft(id string) { k.count(id).N++ }

// Name is a kind's name, or "" before anyone names it.
func (k *Kinds) Name(id string) string {
	i, ok := k.madeAt(id)
	if !ok {
		return ""
	}
	return k.Made[i].Name
}

// SetName names a kind once.
func (k *Kinds) SetName(id, name, by string) bool {
	c := k.count(id)
	if c.Name != "" {
		return false
	}
	c.Name, c.Named = name, by
	return true
}

// Give is the first maker's own name for a kind, once.
func (k *Kinds) Give(id, name string) bool {
	i, ok := k.madeAt(id)
	if !ok || k.Made[i].Given {
		return false
	}
	k.Made[i].Name, k.Made[i].Given = name, true
	return true
}

// given reports whether a kind's first maker has given it a name.
func (k *Kinds) given(id string) bool {
	i, ok := k.madeAt(id)
	return ok && k.Made[i].Given
}
