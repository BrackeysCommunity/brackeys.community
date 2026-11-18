package fact

import (
	"crypto/sha256"
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/canon"
)

// Tail is a Log that keeps only the facts not yet handed to a store, and a
// running chain over every fact ever appended: each link is the SHA-256 of
// the last link and the fact's canonical form. Two logs with the same
// chain hold the same facts in the same order, so a digest can name the
// whole log without reading it. A snapshot holds Count and Chain only;
// its facts are in the store.
type Tail struct {
	Count ID        `json:"count"`
	Chain canon.Sum `json:"chain"`
	facts []Fact
}

func (t *Tail) Append(f Fact) (ID, error) {
	if err := Normalize(&f); err != nil {
		return 0, err
	}
	next := t.Count + 1
	for _, c := range f.Causes {
		if c < 1 || c >= next {
			return 0, fmt.Errorf("fact %s: cause %d is not in the log", f.Kind, c)
		}
	}
	f.ID = next
	b, err := canon.Marshal(f)
	if err != nil {
		return 0, err
	}
	h := sha256.New()
	h.Write(t.Chain[:])
	h.Write(b)
	copy(t.Chain[:], h.Sum(nil))
	t.facts = append(t.facts, f)
	t.Count = next
	return f.ID, nil
}

func (t *Tail) base() ID { return t.Count - ID(len(t.facts)) }

// Get finds an unflushed fact.
func (t *Tail) Get(id ID) (Fact, bool) {
	i := int(id - t.base() - 1)
	if i < 0 || i >= len(t.facts) {
		return Fact{}, false
	}
	return t.facts[i], true
}

// Since returns the unflushed facts after id.
func (t *Tail) Since(id ID) []Fact {
	i := max(int(id-t.base()), 0)
	if i >= len(t.facts) {
		return nil
	}
	return slices.Clone(t.facts[i:])
}

func (t *Tail) Len() int { return int(t.Count) }

// Flush hands over the unflushed facts and forgets them.
func (t *Tail) Flush() []Fact {
	out := t.facts
	t.facts = nil
	return out
}
